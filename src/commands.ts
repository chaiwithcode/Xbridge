//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { XcodeKitManager } from "./manager";
import { ConfigService } from "./core/config";
import { SimctlService, Simulator } from "./services/simctl";
import { XcodebuildService } from "./services/xcodebuild";
import { log } from "./core/log";
import { Process, run } from "./core/process";
import { SchemeTreeProvider } from "./views/schemeTree";
import { SimulatorTreeProvider } from "./views/simulatorTree";
import { StatusBar } from "./statusBar";

interface Deps {
  manager: XcodeKitManager;
  config: ConfigService;
  simctl: SimctlService;
  xcodebuild: XcodebuildService;
  schemeTree: SchemeTreeProvider;
  simulatorTree: SimulatorTreeProvider;
  statusBar: StatusBar;
}

interface PickItem extends vscode.QuickPickItem {
  value?: string;
  udid?: string;
}

/** A tree row that carries a simulator, as passed to context-menu commands. */
interface SimulatorContext {
  simulator?: Simulator;
}

/**
 * Shows a QuickPick immediately (with a spinner) and fills it once `loader`
 * resolves, so the popup never blocks on slow `xcodebuild`/`simctl` calls.
 */
function pickAsync(
  placeHolder: string,
  loader: () => Promise<PickItem[]>,
  opts?: { matchOnDescription?: boolean; matchOnDetail?: boolean }
): Promise<PickItem | undefined> {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick<PickItem>();
    qp.placeholder = placeHolder;
    qp.busy = true;
    qp.matchOnDescription = opts?.matchOnDescription ?? false;
    qp.matchOnDetail = opts?.matchOnDetail ?? false;
    let done = false;
    qp.onDidAccept(() => {
      done = true;
      resolve(qp.selectedItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      if (!done) {
        resolve(undefined);
      }
      qp.dispose();
    });
    qp.show();
    loader()
      .then((items) => {
        qp.items = items;
        qp.busy = false;
      })
      .catch(() => {
        qp.items = [];
        qp.busy = false;
      });
  });
}

/** Running action process token, so it can be canceled by Stop. */
let activeCancellation: vscode.CancellationTokenSource | undefined;

/** Notified whenever an action starts or finishes, to update UI state. */
let onRunningChanged: (running: boolean) => void = () => undefined;

/** In-flight screen recordings, keyed by simulator UDID. */
const recordings = new Map<
  string,
  { process: Process; file: string; stopping: boolean }
>();

class ActionBusyError extends Error {
  constructor() {
    super("Another XcodeKit action is already running. Stop it before starting a new one.");
  }
}

async function withActionProgress<T>(
  title: string,
  task: (token: vscode.CancellationToken) => Promise<T>,
  onCancel?: () => void
): Promise<T> {
  if (activeCancellation) {
    throw new ActionBusyError();
  }
  activeCancellation = new vscode.CancellationTokenSource();
  const cts = activeCancellation;
  onRunningChanged(true);
  try {
    return await vscode.window.withProgress(
      // Window progress keeps long builds out of the way; Stop lives in the
      // status bar and the view title instead of a notification popup.
      { location: vscode.ProgressLocation.Window, title },
      async () => task(cts.token)
    );
  } finally {
    if (cts.token.isCancellationRequested) {
      onCancel?.();
    }
    if (activeCancellation === cts) {
      activeCancellation = undefined;
    }
    cts.dispose();
    onRunningChanged(false);
  }
}

async function withDeviceProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title },
    task
  );
}

/** Reveals a file in Finder. */
async function revealInFinder(filePath: string): Promise<void> {
  await run("open", ["-R", filePath]);
}

function timestamped(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(os.tmpdir(), `${prefix}-${stamp}.${extension}`);
}

export function registerCommands(context: vscode.ExtensionContext, deps: Deps): void {
  const { manager, config, simctl, xcodebuild, schemeTree, simulatorTree, statusBar } = deps;

  // Keep the toolbar/context in sync while an action runs.
  onRunningChanged = (running: boolean) => {
    statusBar.setRunning(running);
    void vscode.commands.executeCommand("setContext", "xcodekit.running", running);
  };

  /** Re-renders the UI from cached metadata. */
  const rerender = async () => {
    schemeTree.rerender();
    simulatorTree.rerender();
    await statusBar.refresh();
  };

  /** Discards cached metadata and re-reads it from Xcode. */
  const reload = async () => {
    xcodebuild.invalidate();
    simctl.invalidate();
    schemeTree.refresh();
    simulatorTree.refresh();
    await statusBar.refresh();
  };

  const register = (id: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));

  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ActionBusyError) {
      vscode.window.showWarningMessage(`XcodeKit: ${message}`);
      return;
    }
    statusBar.showError(message);
    vscode.window.showErrorMessage(`XcodeKit: ${message}`);
  };

  /** Resolves the simulator a device command should act on. */
  const targetSimulator = async (item?: SimulatorContext): Promise<Simulator | undefined> => {
    if (item?.simulator) {
      return item.simulator;
    }
    const udid = config.destination;
    if (!udid) {
      vscode.window.showWarningMessage("XcodeKit: No simulator selected.");
      return undefined;
    }
    return simctl.find(udid);
  };

  /** Resolves the bundle identifier of the active scheme's product. */
  const resolveBundleId = async (): Promise<string | undefined> => {
    const scheme = await xcodebuild.resolveScheme();
    const settings = await xcodebuild.getBuildSettings(scheme);
    return settings.productBundleIdentifier;
  };

  // ---------------------------------------------------------------- build

  register("xcodekit.build", () =>
    withActionProgress(
      "XcodeKit: Building…",
      async (token) => {
        statusBar.startActivity("Build");
        const result = await manager.build({}, (c) => statusBar.observeLog(c), token);
        statusBar.showResult({
          action: "Build",
          succeeded: result.succeeded,
          errors: result.parsed.errors.length,
          warnings: result.parsed.warnings.length,
        });
        if (result.succeeded) {
          vscode.window.setStatusBarMessage("$(pass-filled) XcodeKit: Build succeeded", 4000);
        } else {
          vscode.window
            .showErrorMessage(
              `XcodeKit: Build failed with ${result.parsed.errors.length} error(s).`,
              "Show Issues",
              "Show Output"
            )
            .then((choice) => {
              if (choice === "Show Issues") {
                void vscode.commands.executeCommand("xcodekit.showIssues");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xcodekit.clean", () =>
    withActionProgress(
      "XcodeKit: Cleaning…",
      async (token) => {
        statusBar.startActivity("Clean");
        const result = await manager.clean(undefined, (c) => statusBar.observeLog(c), token);
        statusBar.showResult({
          action: "Clean",
          succeeded: result.succeeded,
          errors: result.parsed.errors.length,
          warnings: result.parsed.warnings.length,
        });
        if (result.succeeded) {
          vscode.window.setStatusBarMessage("$(pass-filled) XcodeKit: Clean finished", 4000);
        } else {
          vscode.window
            .showErrorMessage("XcodeKit: Clean failed.", "Show Output")
            .then((choice) => choice && log.build.show());
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xcodekit.run", () =>
    withActionProgress(
      "XcodeKit: Building & running…",
      async (token) => {
        statusBar.startActivity("Run");
        const result = await manager.run({}, (c) => statusBar.observeLog(c), token);
        statusBar.showResult({
          action: "Run",
          succeeded: result.succeeded,
          errors: result.parsed.errors.length,
          warnings: result.parsed.warnings.length,
        });
        if (!result.succeeded) {
          vscode.window
            .showErrorMessage(`XcodeKit: ${result.summary.split("\n")[0]}`, "Show Issues")
            .then((c) => c && vscode.commands.executeCommand("xcodekit.showIssues"));
        }
        await reload();
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xcodekit.stop", async () => {
    activeCancellation?.cancel();
    await manager.stopApp();
    vscode.window.setStatusBarMessage("XcodeKit: Stopped", 3000);
  });

  register("xcodekit.stopApp", async () => {
    const app = manager.runningApp;
    if (!app) {
      vscode.window.showInformationMessage("XcodeKit: No app is running.");
      return;
    }
    await manager.stopApp().catch(fail);
  });

  register("xcodekit.test", () =>
    withActionProgress(
      "XcodeKit: Building & testing…",
      async (token) => {
        statusBar.startActivity("Test");
        const result = await manager.test(
          { testIdentifier: config.testTarget, testPlan: config.testPlan },
          (c) => statusBar.observeLog(c),
          token
        );
        statusBar.showResult({
          action: "Test",
          succeeded: result.succeeded,
          errors: result.parsed.errors.length,
          warnings: result.parsed.warnings.length,
          testSummary: result.parsed.testSummary,
        });
        if (result.succeeded) {
          vscode.window.setStatusBarMessage(
            `$(pass-filled) XcodeKit: ${result.parsed.testSummary ?? "Tests passed"}`,
            5000
          );
        } else {
          vscode.window
            .showErrorMessage(`XcodeKit: ${result.summary.split("\n")[0]}`, "Show Issues")
            .then((c) => c && vscode.commands.executeCommand("xcodekit.showIssues"));
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  // ---------------------------------------------------------------- issues

  register("xcodekit.showIssues", async () => {
    const parsed = manager.lastResult?.parsed;
    const issues = [
      ...(parsed?.errors ?? []).map((i) => ({ ...i, icon: "error" as const })),
      ...(parsed?.testFailures ?? []).map((f) => ({
        type: "error" as const,
        file: f.file,
        line: f.line,
        message: f.testCase ? `${f.testCase}: ${f.message}` : f.message,
        icon: "beaker-stop" as const,
      })),
      ...(parsed?.warnings ?? []).map((i) => ({ ...i, icon: "warning" as const })),
    ];
    if (issues.length === 0) {
      vscode.window.showInformationMessage("XcodeKit: No issues from the last build.");
      log.build.show();
      return;
    }
    const pick = await vscode.window.showQuickPick(
      issues.map((issue, index) => ({
        label: `$(${issue.icon}) ${issue.message}`,
        description: issue.file ? `${path.basename(issue.file)}:${issue.line ?? "?"}` : undefined,
        detail: issue.file,
        index,
      })),
      { placeHolder: "Issues from the last build", matchOnDescription: true, matchOnDetail: true }
    );
    if (!pick) {
      return;
    }
    const issue = issues[pick.index];
    if (!issue.file) {
      log.build.show();
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(issue.file));
    const position = new vscode.Position(Math.max(0, (issue.line ?? 1) - 1), 0);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(position, position) });
  });

  // ---------------------------------------------------------------- pickers

  register("xcodekit.selectScheme", async (preselected?: string) => {
    let scheme = preselected;
    if (!scheme) {
      const pick = await pickAsync("Select a scheme", async () => {
        const { schemes } = await xcodebuild
          .listSchemes()
          .catch(() => ({ schemes: [] as string[] }));
        return schemes.map((s) => ({ label: `$(target) ${s}`, value: s }));
      });
      scheme = pick?.value;
    }
    if (scheme) {
      await config.setScheme(scheme);
      await rerender();
    }
  });

  register("xcodekit.selectConfiguration", async () => {
    const pick = await pickAsync("Select a build configuration", async () => {
      const { configurations } = await xcodebuild
        .listSchemes()
        .catch(() => ({ configurations: ["Debug", "Release"] }));
      return configurations.map((c) => ({ label: `$(settings-gear) ${c}`, value: c }));
    });
    if (pick?.value) {
      await config.setConfiguration(pick.value);
      await rerender();
    }
  });

  register("xcodekit.selectTestPlan", async (preselected?: string) => {
    if (preselected !== undefined) {
      await config.setTestPlan(preselected || undefined);
      await rerender();
      return;
    }
    const pick = await pickAsync("Select a test plan", async () => {
      const plans = await xcodebuild.listTestPlans().catch(() => [] as string[]);
      const items: PickItem[] = [
        { label: "$(circle-slash) None", description: "Use the scheme's default", value: "" },
      ];
      if (plans.length) {
        items.push({ label: "Test Plans", kind: vscode.QuickPickItemKind.Separator });
        for (const p of plans) {
          items.push({ label: `$(checklist) ${p}`, value: p });
        }
      }
      return items;
    });
    if (pick) {
      await config.setTestPlan(pick.value || undefined);
      await rerender();
    }
  });

  register("xcodekit.selectTestTarget", async (preselected?: string) => {
    if (preselected !== undefined) {
      await config.setTestTarget(preselected || undefined);
      await rerender();
      return;
    }
    const pick = await pickAsync("Select a test target", async () => {
      const targets = await xcodebuild
        .listTestTargets()
        .catch(() => ({ all: [] as string[], unit: [] as string[], ui: [] as string[] }));
      const items: PickItem[] = [
        { label: "$(beaker) All Tests", description: "Run every test in the scheme", value: "" },
      ];
      if (targets.unit.length) {
        items.push({ label: "Unit Tests", kind: vscode.QuickPickItemKind.Separator });
        for (const t of targets.unit) {
          items.push({ label: `$(beaker) ${t}`, value: t });
        }
      }
      if (targets.ui.length) {
        items.push({ label: "UI Tests", kind: vscode.QuickPickItemKind.Separator });
        for (const t of targets.ui) {
          items.push({ label: `$(device-mobile) ${t}`, value: t });
        }
      }
      return items;
    });
    if (pick) {
      await config.setTestTarget(pick.value || undefined);
      await rerender();
    }
  });

  register("xcodekit.selectDestination", async () => {
    const active = config.destination;
    const pick = await pickAsync(
      "Select a destination (simulator)",
      async () => {
        const sims = await simctl.list(true).catch(() => []);
        const items: PickItem[] = [];
        const booted = sims.filter((s) => s.state === "Booted");
        if (booted.length > 0) {
          items.push({ label: "Booted", kind: vscode.QuickPickItemKind.Separator });
          for (const s of booted) {
            items.push({
              label: `$(vm-running) ${s.name}`,
              description: `${s.runtime}${s.udid === active ? "  •  active" : ""}`,
              detail: s.udid,
              udid: s.udid,
            });
          }
        }
        const runtimes = [...new Set(sims.map((s) => s.runtime))];
        for (const rt of runtimes) {
          const group = sims.filter((s) => s.runtime === rt && s.state !== "Booted");
          if (group.length === 0) {
            continue;
          }
          items.push({ label: rt, kind: vscode.QuickPickItemKind.Separator });
          for (const s of group) {
            items.push({
              label: `$(device-mobile) ${s.name}`,
              description: s.udid === active ? "active" : undefined,
              detail: s.udid,
              udid: s.udid,
            });
          }
        }
        return items;
      },
      { matchOnDescription: true, matchOnDetail: true }
    );
    if (pick?.udid) {
      await config.setDestination(pick.udid);
      await rerender();
    }
  });

  /** Invoked by clicking a simulator row, so it becomes the run destination. */
  register("xcodekit.setDestination", async (arg?: string | SimulatorContext) => {
    const udid = typeof arg === "string" ? arg : arg?.simulator?.udid;
    if (!udid) {
      return;
    }
    await config.setDestination(udid);
    await rerender();
  });

  // ---------------------------------------------------------------- devices

  register("xcodekit.bootSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress(`XcodeKit: Booting ${sim.name}…`, async () => {
      await simctl.boot(sim.udid);
      await simctl.openApp();
    }).catch(fail);
    await reload();
  });

  register("xcodekit.shutdownSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await simctl.shutdown(sim.udid).catch(fail);
    await reload();
  });

  register("xcodekit.eraseSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Erase all content and settings for ${sim.name}?`,
      { modal: true, detail: "This permanently deletes all apps and data on this simulator." },
      "Erase"
    );
    if (confirm === "Erase") {
      await withDeviceProgress(`XcodeKit: Erasing ${sim.name}…`, () => simctl.erase(sim.udid)).catch(fail);
      await reload();
    }
  });

  register("xcodekit.copySimulatorUdid", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await vscode.env.clipboard.writeText(sim.udid);
    vscode.window.setStatusBarMessage(`XcodeKit: Copied UDID for ${sim.name}`, 3000);
  });

  register("xcodekit.openUrlOnSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    const url = await vscode.window.showInputBox({
      title: `Open URL on ${sim.name}`,
      prompt: "Enter a URL or deep link",
      placeHolder: "myapp://profile/42",
      validateInput: (value) =>
        value.trim().length === 0 ? "Enter a URL or custom-scheme deep link" : undefined,
    });
    if (!url) {
      return;
    }
    await withDeviceProgress(`XcodeKit: Opening link on ${sim.name}…`, async () => {
      await simctl.boot(sim.udid);
      await simctl.openUrl(sim.udid, url.trim());
    }).catch(fail);
  });

  register("xcodekit.screenshotSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XcodeKit: Boot ${sim.name} before taking a screenshot.`);
      return;
    }
    const file = timestamped(sim.name.replace(/\s+/g, "-"), "png");
    try {
      await withDeviceProgress("XcodeKit: Capturing screenshot…", () =>
        simctl.screenshot(sim.udid, file)
      );
    } catch (err) {
      fail(err);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
    vscode.window
      .showInformationMessage("XcodeKit: Screenshot captured.", "Reveal in Finder")
      .then((c) => c && revealInFinder(file));
  });

  register("xcodekit.toggleRecording", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    const existing = recordings.get(sim.udid);
    if (existing) {
      // SIGINT lets simctl write the movie atoms before exiting.
      existing.stopping = true;
      existing.process.cancel("SIGINT");
      await existing.process.promise.catch(() => undefined);
      recordings.delete(sim.udid);
      simulatorTree.setRecording(sim.udid, false);
      vscode.window
        .showInformationMessage("XcodeKit: Recording saved.", "Reveal in Finder")
        .then((c) => c && revealInFinder(existing.file));
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XcodeKit: Boot ${sim.name} before recording.`);
      return;
    }
    const file = timestamped(sim.name.replace(/\s+/g, "-"), "mp4");
    const process = simctl.startRecording(sim.udid, file);
    recordings.set(sim.udid, { process, file, stopping: false });
    simulatorTree.setRecording(sim.udid, true);
    vscode.window.setStatusBarMessage(`$(record) XcodeKit: Recording ${sim.name}…`, 4000);
    void process.promise
      .catch((err) => log.error("Screen recording process failed", err))
      .finally(() => {
        const current = recordings.get(sim.udid);
        if (current?.process !== process) {
          return;
        }
        recordings.delete(sim.udid);
        simulatorTree.setRecording(sim.udid, false);
        if (!current.stopping) {
          vscode.window.showWarningMessage(
            `XcodeKit: Screen recording on ${sim.name} stopped unexpectedly.`
          );
        }
      });
  });

  register("xcodekit.toggleAppearance", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XcodeKit: Boot ${sim.name} to change its appearance.`);
      return;
    }
    try {
      const current = await simctl.getAppearance(sim.udid);
      const next = current === "dark" ? "light" : "dark";
      await simctl.setAppearance(sim.udid, next);
      vscode.window.setStatusBarMessage(`XcodeKit: ${sim.name} switched to ${next} mode`, 3000);
    } catch (e) {
      fail(e);
    }
  });

  register("xcodekit.openAppContainer", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress("XcodeKit: Locating app container…", async () => {
      const bundleId = manager.runningApp?.bundleId ?? (await resolveBundleId());
      if (!bundleId) {
        throw new Error("Could not resolve the app's bundle identifier.");
      }
      const container = await simctl.appContainer(sim.udid, bundleId);
      await run("open", [container]);
    }).catch(fail);
  });

  register("xcodekit.uninstallApp", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress("XcodeKit: Uninstalling app…", async () => {
      const bundleId = manager.runningApp?.bundleId ?? (await resolveBundleId());
      if (!bundleId) {
        throw new Error("Could not resolve the app's bundle identifier.");
      }
      await simctl.uninstall(sim.udid, bundleId);
      vscode.window.setStatusBarMessage(`XcodeKit: Uninstalled ${bundleId}`, 3000);
    }).catch(fail);
  });

  // ---------------------------------------------------------------- misc

  register("xcodekit.openSimulatorApp", () => simctl.openApp());
  register("xcodekit.refreshSimulators", () => simulatorTree.refresh());
  register("xcodekit.refreshSchemes", () => void reload());
  register("xcodekit.showOutput", () => log.build.show());
  register("xcodekit.showAppLog", () => log.app.show());
  register("xcodekit.openWalkthrough", () =>
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      `${context.extension.id}#xcodekit.welcome`,
      false
    )
  );

  // Xcode-style combined selector: pick which of scheme/configuration/destination to change.
  register("xcodekit.selectTarget", async () => {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: "$(target) Scheme",
          description: config.scheme ?? "not set",
          command: "xcodekit.selectScheme",
        },
        {
          label: "$(settings-gear) Configuration",
          description: config.configuration,
          command: "xcodekit.selectConfiguration",
        },
        {
          label: "$(device-mobile) Destination",
          description: "simulator",
          command: "xcodekit.selectDestination",
        },
        {
          label: "$(checklist) Test Plan",
          description: config.testPlan ?? "Default",
          command: "xcodekit.selectTestPlan",
        },
        {
          label: "$(beaker) Test Target",
          description: config.testTarget ?? "All Tests",
          command: "xcodekit.selectTestTarget",
        },
      ],
      { placeHolder: "What do you want to change?" }
    );
    if (pick) {
      await vscode.commands.executeCommand(pick.command);
    }
  });

  // Pick an Xcode project/workspace when none is auto-detected.
  register("xcodekit.selectProject", async () => {
    const picks = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Xcode Project",
      filters: { "Xcode Project": ["xcodeproj", "xcworkspace"] },
    });
    const chosen = picks?.[0];
    if (chosen) {
      await vscode.workspace
        .getConfiguration("xcodekit")
        .update("projectPath", chosen.fsPath, vscode.ConfigurationTarget.Workspace);
      await updateHasProjectContext(config);
      await reload();
    }
  });

  context.subscriptions.push({
    dispose: () => {
      for (const recording of recordings.values()) {
        recording.stopping = true;
        const { process } = recording;
        process.cancel("SIGINT");
      }
      recordings.clear();
    },
  });

  void updateHasProjectContext(config);
}

/** Sets the `xcodekit.hasProject` context key that drives the welcome view. */
export async function updateHasProjectContext(config: ConfigService): Promise<boolean> {
  let hasProject = false;
  try {
    await config.resolveProject();
    hasProject = true;
  } catch {
    hasProject = false;
  }
  await vscode.commands.executeCommand("setContext", "xcodekit.hasProject", hasProject);
  return hasProject;
}
