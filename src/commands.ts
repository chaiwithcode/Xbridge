//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { XBridgeManager } from "./manager";
import { ConfigService } from "./core/config";
import { SimctlService, Simulator } from "./services/simctl";
import { DevicectlService } from "./services/devicectl";
import { XcodebuildService } from "./services/xcodebuild";
import { log } from "./core/log";
import { Process, run } from "./core/process";
import { SchemeTreeProvider } from "./views/schemeTree";
import { SimulatorTreeProvider } from "./views/simulatorTree";
import { StatusBar } from "./statusBar";

interface Deps {
  manager: XBridgeManager;
  config: ConfigService;
  simctl: SimctlService;
  devicectl?: DevicectlService;
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
    super("Another XBridge action is already running. Stop it before starting a new one.");
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
    void vscode.commands.executeCommand("setContext", "xbridge.running", running);
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
      vscode.window.showWarningMessage(`XBridge: ${message}`);
      return;
    }
    statusBar.showError(message);
    vscode.window.showErrorMessage(`XBridge: ${message}`);
  };

  /** Resolves the simulator a device command should act on. */
  const targetSimulator = async (item?: SimulatorContext): Promise<Simulator | undefined> => {
    if (item?.simulator) {
      return item.simulator;
    }
    const udid = config.destination;
    if (!udid) {
      vscode.window.showWarningMessage("XBridge: No simulator selected.");
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

  register("xbridge.build", () =>
    withActionProgress(
      "XBridge: Building…",
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
          vscode.window.setStatusBarMessage("$(pass-filled) XBridge: Build succeeded", 4000);
        } else if (result.parsed.codeSigningFailed) {
          vscode.window
            .showErrorMessage(
              "XBridge: Code signing error: A Development Team or Provisioning Profile is required.",
              "Open in Xcode",
              "Show Output"
            )
            .then((choice) => {
              if (choice === "Open in Xcode") {
                void vscode.commands.executeCommand("xbridge.openInXcode");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        } else if (result.parsed.schemeNotFound) {
          vscode.window
            .showErrorMessage(
              "XBridge: Scheme not found in active project.",
              "Select Scheme",
              "Select Project"
            )
            .then((choice) => {
              if (choice === "Select Scheme") {
                void vscode.commands.executeCommand("xbridge.selectScheme");
              } else if (choice === "Select Project") {
                void vscode.commands.executeCommand("xbridge.selectProject");
              }
            });
        } else {
          vscode.window
            .showErrorMessage(
              `XBridge: Build failed with ${result.parsed.errors.length} error(s).`,
              "Show Issues",
              "Show Output"
            )
            .then((choice) => {
              if (choice === "Show Issues") {
                void vscode.commands.executeCommand("xbridge.showIssues");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xbridge.clean", () =>
    withActionProgress(
      "XBridge: Cleaning…",
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
          vscode.window.setStatusBarMessage("$(pass-filled) XBridge: Clean finished", 4000);
        } else {
          vscode.window
            .showErrorMessage("XBridge: Clean failed.", "Show Output")
            .then((choice) => choice && log.build.show());
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xbridge.run", () =>
    withActionProgress(
      "XBridge: Building & running…",
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
          if (result.parsed.codeSigningFailed) {
            vscode.window
              .showErrorMessage(
                "XBridge: Code signing error: A Development Team or Provisioning Profile is required for device deployment.",
                "Open in Xcode",
                "Show Output"
              )
              .then((choice) => {
                if (choice === "Open in Xcode") {
                  void vscode.commands.executeCommand("xbridge.openInXcode");
                } else if (choice === "Show Output") {
                  log.build.show();
                }
              });
          } else {
            const detail =
              result.parsed.errors.length > 0
                ? `Build failed with ${result.parsed.errors.length} error(s).`
                : "Run failed.";
            vscode.window
              .showErrorMessage(`XBridge: ${detail}`, "Show Issues", "Show Output")
              .then((c) => {
                if (c === "Show Issues") {
                  void vscode.commands.executeCommand("xbridge.showIssues");
                } else if (c === "Show Output") {
                  log.build.show();
                }
              });
          }
        }
        await reload();
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xbridge.stop", async () => {
    activeCancellation?.cancel();
    await manager.stopApp();
    vscode.window.setStatusBarMessage("XBridge: Stopped", 3000);
  });

  register("xbridge.stopApp", async () => {
    const app = manager.runningApp;
    if (!app) {
      vscode.window.showInformationMessage("XBridge: No app is running.");
      return;
    }
    await manager.stopApp().catch(fail);
  });

  register("xbridge.test", () =>
    withActionProgress(
      "XBridge: Building & testing…",
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
            `$(pass-filled) XBridge: ${result.parsed.testSummary ?? "Tests passed"}`,
            5000
          );
        } else if (result.parsed.missingDebugDylib) {
          vscode.window
            .showErrorMessage(
              "XBridge: Testability debug dylib is missing from DerivedData. Clean build folder and re-run.",
              "Clean & Re-test",
              "Show Output"
            )
            .then(async (choice) => {
              if (choice === "Clean & Re-test") {
                await vscode.commands.executeCommand("xbridge.clean");
                void vscode.commands.executeCommand("xbridge.test");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        } else if (result.parsed.buildFailedBeforeTests) {
          vscode.window
            .showErrorMessage(
              `XBridge: Test compilation failed with ${result.parsed.errors.length} error(s).`,
              "Show Issues",
              "Show Output"
            )
            .then((choice) => {
              if (choice === "Show Issues") {
                void vscode.commands.executeCommand("xbridge.showIssues");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        } else {
          const detail =
            result.parsed.errors.length > 0
              ? `Test build failed with ${result.parsed.errors.length} compile error(s).`
              : result.parsed.testFailures.length > 0
              ? `Tests failed with ${result.parsed.testFailures.length} failure(s).`
              : "Testing failed.";
          vscode.window
            .showErrorMessage(`XBridge: ${detail}`, "Show Issues", "Show Output")
            .then((choice) => {
              if (choice === "Show Issues") {
                void vscode.commands.executeCommand("xbridge.showIssues");
              } else if (choice === "Show Output") {
                log.build.show();
              }
            });
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  // ---------------------------------------------------------------- issues

  register("xbridge.showIssues", async () => {
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
      vscode.window.showInformationMessage("XBridge: No issues from the last build.");
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

  register("xbridge.selectScheme", async (preselected?: string) => {
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

  register("xbridge.selectConfiguration", async () => {
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

  register("xbridge.selectTestPlan", async (preselected?: string) => {
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

  register("xbridge.selectTestTarget", async (preselected?: string) => {
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

  register("xbridge.selectDestination", async () => {
    const active = config.destination;
    const pick = await pickAsync(
      "Select a destination (simulator or physical device)",
      async () => {
        const [devices, sims] = await Promise.all([
          deps.devicectl?.listDevices().catch(() => []) ?? [],
          simctl.list(true).catch(() => []),
        ]);
        const items: PickItem[] = [];

        if (devices.length > 0) {
          items.push({ label: "Connected Devices", kind: vscode.QuickPickItemKind.Separator });
          for (const d of devices) {
            items.push({
              label: `$(plug) ${d.name}`,
              description: `${d.marketingName}  •  ${d.platform} ${d.osVersion}${
                d.udid === active || d.coreDeviceIdentifier === active ? "  •  active" : ""
              }`,
              detail: `${d.udid} (${d.tunnelState})`,
              udid: d.udid,
            });
          }
        }

        const booted = sims.filter((s) => s.state === "Booted");
        if (booted.length > 0) {
          items.push({ label: "Booted Simulators", kind: vscode.QuickPickItemKind.Separator });
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

  /** Invoked by clicking a simulator or device row, so it becomes the run destination. */
  register("xbridge.setDestination", async (arg?: string | SimulatorContext | { device?: { udid: string } }) => {
    let udid: string | undefined;
    if (typeof arg === "string") {
      udid = arg;
    } else if (arg && "device" in arg && arg.device) {
      udid = arg.device.udid;
    } else if (arg && "simulator" in arg && arg.simulator) {
      udid = arg.simulator.udid;
    }
    if (!udid) {
      return;
    }
    await config.setDestination(udid);
    await rerender();
  });

  // ---------------------------------------------------------------- devices

  register("xbridge.bootSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress(`XBridge: Booting ${sim.name}…`, async () => {
      await simctl.boot(sim.udid);
      await simctl.openApp();
    }).catch(fail);
    await reload();
  });

  register("xbridge.shutdownSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await simctl.shutdown(sim.udid).catch(fail);
    await reload();
  });

  register("xbridge.eraseSimulator", async (item?: SimulatorContext) => {
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
      await withDeviceProgress(`XBridge: Erasing ${sim.name}…`, () => simctl.erase(sim.udid)).catch(fail);
      await reload();
    }
  });

  register("xbridge.copySimulatorUdid", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await vscode.env.clipboard.writeText(sim.udid);
    vscode.window.setStatusBarMessage(`XBridge: Copied UDID for ${sim.name}`, 3000);
  });

  register("xbridge.openUrlOnSimulator", async (item?: SimulatorContext) => {
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
    await withDeviceProgress(`XBridge: Opening link on ${sim.name}…`, async () => {
      await simctl.boot(sim.udid);
      await simctl.openUrl(sim.udid, url.trim());
    }).catch(fail);
  });

  register("xbridge.screenshotSimulator", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XBridge: Boot ${sim.name} before taking a screenshot.`);
      return;
    }
    const file = timestamped(sim.name.replace(/\s+/g, "-"), "png");
    try {
      await withDeviceProgress("XBridge: Capturing screenshot…", () =>
        simctl.screenshot(sim.udid, file)
      );
    } catch (err) {
      fail(err);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
    vscode.window
      .showInformationMessage("XBridge: Screenshot captured.", "Reveal in Finder")
      .then((c) => c && revealInFinder(file));
  });

  register("xbridge.toggleRecording", async (item?: SimulatorContext) => {
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
        .showInformationMessage("XBridge: Recording saved.", "Reveal in Finder")
        .then((c) => c && revealInFinder(existing.file));
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XBridge: Boot ${sim.name} before recording.`);
      return;
    }
    const file = timestamped(sim.name.replace(/\s+/g, "-"), "mp4");
    const process = simctl.startRecording(sim.udid, file);
    recordings.set(sim.udid, { process, file, stopping: false });
    simulatorTree.setRecording(sim.udid, true);
    vscode.window.setStatusBarMessage(`$(record) XBridge: Recording ${sim.name}…`, 4000);
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
            `XBridge: Screen recording on ${sim.name} stopped unexpectedly.`
          );
        }
      });
  });

  register("xbridge.toggleAppearance", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    if (sim.state !== "Booted") {
      vscode.window.showWarningMessage(`XBridge: Boot ${sim.name} to change its appearance.`);
      return;
    }
    try {
      const current = await simctl.getAppearance(sim.udid);
      const next = current === "dark" ? "light" : "dark";
      await simctl.setAppearance(sim.udid, next);
      vscode.window.setStatusBarMessage(`XBridge: ${sim.name} switched to ${next} mode`, 3000);
    } catch (e) {
      fail(e);
    }
  });

  register("xbridge.openAppContainer", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress("XBridge: Locating app container…", async () => {
      const bundleId = manager.runningApp?.bundleId ?? (await resolveBundleId());
      if (!bundleId) {
        throw new Error("Could not resolve the app's bundle identifier.");
      }
      const container = await simctl.appContainer(sim.udid, bundleId);
      await run("open", [container]);
    }).catch(fail);
  });

  register("xbridge.uninstallApp", async (item?: SimulatorContext) => {
    const sim = await targetSimulator(item);
    if (!sim) {
      return;
    }
    await withDeviceProgress("XBridge: Uninstalling app…", async () => {
      const bundleId = manager.runningApp?.bundleId ?? (await resolveBundleId());
      if (!bundleId) {
        throw new Error("Could not resolve the app's bundle identifier.");
      }
      await simctl.uninstall(sim.udid, bundleId);
      vscode.window.setStatusBarMessage(`XBridge: Uninstalled ${bundleId}`, 3000);
    }).catch(fail);
  });

  // ---------------------------------------------------------------- misc

  register("xbridge.resolvePackages", () =>
    withActionProgress(
      "XBridge: Resolving package dependencies…",
      async (token) => {
        statusBar.startActivity("Build");
        const result = await xcodebuild.resolvePackages(
          (c) => {
            log.build.append(c);
            statusBar.observeLog(c);
          },
          token
        );
        const succeeded = result.code === 0;
        statusBar.showResult({
          action: "Build",
          succeeded,
          errors: 0,
          warnings: 0,
        });
        if (succeeded) {
          vscode.window.setStatusBarMessage(
            "$(pass-filled) XBridge: Package dependencies resolved",
            4000
          );
        } else {
          vscode.window
            .showErrorMessage(
              "XBridge: Failed to resolve package dependencies.",
              "Show Output"
            )
            .then((c) => c && log.build.show());
        }
      },
      () => statusBar.clearActivity()
    ).catch(fail)
  );

  register("xbridge.openInXcode", async () => {
    try {
      const project = await config.resolveProject();
      await run("open", ["-a", "Xcode", project.path]);
    } catch {
      vscode.window.showErrorMessage(
        "XBridge: No Xcode project found to open."
      );
    }
  });

  register("xbridge.openSimulatorApp", () => simctl.openApp());
  register("xbridge.refreshSimulators", () => simulatorTree.refresh());
  register("xbridge.refreshDevices", () => simulatorTree.refresh());
  register("xbridge.refreshSchemes", () => void reload());
  register("xbridge.showOutput", () => log.build.show());
  register("xbridge.showAppLog", () => log.app.show());
  register("xbridge.openWalkthrough", () =>
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      `${context.extension.id}#xbridge.welcome`,
      false
    )
  );

  // Xcode-style combined selector: pick which of scheme/configuration/destination to change.
  register("xbridge.selectTarget", async () => {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: "$(target) Scheme",
          description: config.scheme ?? "not set",
          command: "xbridge.selectScheme",
        },
        {
          label: "$(settings-gear) Configuration",
          description: config.configuration,
          command: "xbridge.selectConfiguration",
        },
        {
          label: "$(device-mobile) Destination",
          description: "simulator",
          command: "xbridge.selectDestination",
        },
        {
          label: "$(checklist) Test Plan",
          description: config.testPlan ?? "Default",
          command: "xbridge.selectTestPlan",
        },
        {
          label: "$(beaker) Test Target",
          description: config.testTarget ?? "All Tests",
          command: "xbridge.selectTestTarget",
        },
      ],
      { placeHolder: "What do you want to change?" }
    );
    if (pick) {
      await vscode.commands.executeCommand(pick.command);
    }
  });

  // Pick an Xcode project/workspace when none is auto-detected, or switch between discovered projects.
  register("xbridge.selectProject", async () => {
    const exclude = "**/{node_modules,.build,DerivedData}/**";
    const [workspaces, projects, packages] = await Promise.all([
      vscode.workspace.findFiles("**/*.xcworkspace/contents.xcworkspacedata", exclude, 20),
      vscode.workspace.findFiles("**/*.xcodeproj/project.pbxproj", exclude, 20),
      vscode.workspace.findFiles("**/Package.swift", exclude, 20),
    ]);

    const activeProject = await config.resolveProject().catch(() => undefined);
    const activePath = config.projectPath ?? activeProject?.path;

    interface ProjectPickItem extends vscode.QuickPickItem {
      projectPath?: string;
      action?: "browse" | "clear";
    }

    const items: ProjectPickItem[] = [];

    const wsPaths = workspaces
      .map((ws) => path.dirname(ws.fsPath))
      .filter((p) => !p.includes(".xcodeproj/"))
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);

    const projPaths = projects
      .map((p) => path.dirname(p.fsPath))
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);

    const pkgPaths = packages
      .map((p) => p.fsPath)
      .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);

    const wsFolders = vscode.workspace.workspaceFolders;
    const wsRoot = wsFolders?.[0]?.uri.fsPath;

    const formatRel = (p: string) => {
      if (wsRoot) {
        const rel = path.relative(wsRoot, p);
        return rel.startsWith("..") ? p : rel;
      }
      return p;
    };

    if (wsPaths.length > 0 || projPaths.length > 0 || pkgPaths.length > 0) {
      items.push({ label: "Discovered Projects & Workspaces", kind: vscode.QuickPickItemKind.Separator });
      for (const p of wsPaths) {
        const isCurrent = p === activePath;
        items.push({
          label: `$(folder-opened) ${path.basename(p)}`,
          description: formatRel(p) + (isCurrent ? "  •  active" : ""),
          detail: p,
          projectPath: p,
        });
      }
      for (const p of projPaths) {
        const isCurrent = p === activePath;
        items.push({
          label: `$(folder-opened) ${path.basename(p)}`,
          description: formatRel(p) + (isCurrent ? "  •  active" : ""),
          detail: p,
          projectPath: p,
        });
      }
      for (const p of pkgPaths) {
        const isCurrent = p === activePath;
        items.push({
          label: `$(package) ${path.basename(p)} (Swift Package)`,
          description: formatRel(p) + (isCurrent ? "  •  active" : ""),
          detail: p,
          projectPath: p,
        });
      }
    }

    items.push({ label: "Options", kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: "$(file-directory) Browse with File Dialog…",
      description: "Locate an Xcode project anywhere on disk",
      action: "browse",
    });

    if (config.projectPath) {
      items.push({
        label: "$(clear-all) Reset to Auto-detect",
        description: `Currently overridden to: ${config.projectPath}`,
        action: "clear",
      });
    }

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Select the Xcode project or workspace to use",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!pick) {
      return;
    }

    if (pick.action === "browse") {
      const dialogPicks = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Xcode Project",
        filters: { "Xcode Project": ["xcodeproj", "xcworkspace"] },
      });
      const chosen = dialogPicks?.[0];
      if (chosen) {
        await config.setProjectPath(chosen.fsPath);
        config.invalidate();
        xcodebuild.invalidate();
        await updateHasProjectContext(config);
        await reload();
        vscode.window.showInformationMessage(`XBridge: Active project set to ${path.basename(chosen.fsPath)}`);
      }
    } else if (pick.action === "clear") {
      await config.setProjectPath(undefined);
      config.invalidate();
      xcodebuild.invalidate();
      await updateHasProjectContext(config);
      await reload();
      vscode.window.showInformationMessage("XBridge: Reset project to auto-detect.");
    } else if (pick.projectPath) {
      await config.setProjectPath(pick.projectPath);
      config.invalidate();
      xcodebuild.invalidate();
      await updateHasProjectContext(config);
      await reload();
      vscode.window.showInformationMessage(`XBridge: Active project set to ${path.basename(pick.projectPath)}`);
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

/** Sets the `xbridge.hasProject` context key that drives the welcome view. */
export async function updateHasProjectContext(config: ConfigService): Promise<boolean> {
  let hasProject = false;
  try {
    await config.resolveProject();
    hasProject = true;
  } catch {
    hasProject = false;
  }
  await vscode.commands.executeCommand("setContext", "xbridge.hasProject", hasProject);
  return hasProject;
}
