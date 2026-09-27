//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import { ConfigService } from "./core/config";
import { log } from "./core/log";
import { Process } from "./core/process";
import { XcodebuildService } from "./services/xcodebuild";
import { SimctlService, Simulator } from "./services/simctl";
import { DevicectlService } from "./services/devicectl";
import { parseXcodebuildOutput, ParsedOutput } from "./services/outputParser";

export interface ActionResult {
  succeeded: boolean;
  parsed: ParsedOutput;
  /** Short human/AI-readable summary. */
  summary: string;
  scheme: string;
  destinationId?: string;
}

export interface RunResultInfo extends ActionResult {
  bundleId?: string;
  appPath?: string;
}

/** The app currently installed and launched by XBridge. */
export interface AppSession {
  udid: string;
  bundleId: string;
  name: string;
}

/**
 * High-level orchestration of build / run / test used by both interactive
 * commands and the AI language-model tools, so behavior stays consistent.
 */
export class XBridgeManager {
  readonly diagnostics: vscode.DiagnosticCollection;

  /** The most recent build/test result, used to drive badges and the issue list. */
  lastResult?: ActionResult;

  private readonly _onDidChangeState = new vscode.EventEmitter<void>();
  /** Fires whenever the last result or the running app session changes. */
  readonly onDidChangeState = this._onDidChangeState.event;

  private appSession?: AppSession;
  private appProcess?: Process;

  constructor(
    readonly config: ConfigService,
    readonly xcodebuild: XcodebuildService,
    readonly simctl: SimctlService,
    readonly devicectl?: DevicectlService
  ) {
    this.diagnostics = vscode.languages.createDiagnosticCollection("xbridge");
  }

  dispose(): void {
    this.diagnostics.dispose();
    this._onDidChangeState.dispose();
  }

  /** The app launched by the last successful run, if it is still tracked. */
  get runningApp(): AppSession | undefined {
    return this.appSession;
  }

  /** Terminates the app launched by the last run. */
  async stopApp(): Promise<void> {
    const session = this.appSession;
    if (!session) {
      return;
    }
    this.appProcess?.cancel();
    this.appProcess = undefined;
    this.appSession = undefined;
    if (!(await this.isPhysicalDevice(session.udid))) {
      await this.simctl.terminate(session.udid, session.bundleId);
    }
    log.app.appendLine(`\n--- ${session.name} terminated ---`);
    this._onDidChangeState.fire();
  }

  private publishDiagnostics(parsed: ParsedOutput): void {
    this.diagnostics.clear();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const issue of [...parsed.errors, ...parsed.warnings]) {
      if (!issue.file) {
        continue;
      }
      const range = new vscode.Range(
        Math.max(0, (issue.line ?? 1) - 1),
        Math.max(0, (issue.column ?? 1) - 1),
        Math.max(0, (issue.line ?? 1) - 1),
        Number.MAX_SAFE_INTEGER
      );
      const diag = new vscode.Diagnostic(
        range,
        issue.message,
        issue.type === "error"
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning
      );
      diag.source = "xbridge";
      const list = byFile.get(issue.file) ?? [];
      list.push(diag);
      byFile.set(issue.file, list);
    }
    // Surface test failures inline too, so they appear in the Problems panel.
    for (const failure of parsed.testFailures) {
      if (!failure.file) {
        continue;
      }
      const line = Math.max(0, (failure.line ?? 1) - 1);
      const diag = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        failure.testCase ? `${failure.testCase}: ${failure.message}` : failure.message,
        vscode.DiagnosticSeverity.Error
      );
      diag.source = "xbridge (test)";
      const list = byFile.get(failure.file) ?? [];
      list.push(diag);
      byFile.set(failure.file, list);
    }
    for (const [file, diags] of byFile) {
      this.diagnostics.set(vscode.Uri.file(file), diags);
    }
  }

  private summarize(action: string, parsed: ParsedOutput): string {
    if (parsed.succeeded) {
      const warn = parsed.warnings.length ? ` with ${parsed.warnings.length} warning(s)` : "";
      const test = parsed.testSummary ? ` — ${parsed.testSummary}` : "";
      return `${action} SUCCEEDED${warn}${test}`;
    }
    const lines: string[] = [`${action} FAILED`];
    if (parsed.testSummary) {
      lines.push(parsed.testSummary);
    }
    const errors = parsed.errors.slice(0, 15);
    for (const e of errors) {
      const loc = e.file ? `${e.file}:${e.line ?? "?"}` : "";
      lines.push(`  error: ${e.message}${loc ? ` (${loc})` : ""}`);
    }
    if (parsed.errors.length > errors.length) {
      lines.push(`  …and ${parsed.errors.length - errors.length} more error(s)`);
    }
    for (const f of parsed.testFailures.slice(0, 10)) {
      const loc = f.file ? `${f.file}:${f.line ?? "?"}` : "";
      lines.push(`  test failure: ${f.message}${loc ? ` (${loc})` : ""}`);
    }
    return lines.join("\n");
  }

  /** Stores the result so views and badges can reflect it. */
  private track(result: ActionResult): ActionResult {
    this.lastResult = result;
    this._onDidChangeState.fire();
    return result;
  }

  private revealBuildLog(): void {
    if (this.config.autoRevealBuildLog) {
      log.build.show(true);
    }
  }

  async build(
    opts: { scheme?: string; configuration?: string; destinationId?: string },
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<ActionResult> {
    const scheme = await this.xcodebuild.resolveScheme(opts.scheme);
    this.revealBuildLog();
    log.build.appendLine(`\n=== Build ${scheme} (${opts.configuration ?? this.config.configuration}) ===`);
    const result = await this.xcodebuild.build({
      scheme,
      configuration: opts.configuration,
      destinationId: opts.destinationId,
      token,
      onLog: (c) => {
        log.build.append(c);
        onLog?.(c);
      },
    });
    const parsed = parseXcodebuildOutput(result.stdout + "\n" + result.stderr);
    const succeeded = parsed.succeeded && result.code === 0;
    this.publishDiagnostics(parsed);
    return this.track({
      succeeded,
      parsed,
      summary: this.summarize("BUILD", { ...parsed, succeeded }),
      scheme,
      destinationId: opts.destinationId ?? this.config.destination,
    });
  }

  async test(
    opts: { scheme?: string; destinationId?: string; testIdentifier?: string; testIdentifiers?: string[]; testPlan?: string },
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<ActionResult> {
    const scheme = await this.xcodebuild.resolveScheme(opts.scheme);
    const destinationId = await this.ensureDestination(opts.destinationId);
    this.revealBuildLog();
    log.build.appendLine(`\n=== Test ${scheme} ===`);
    const result = await this.xcodebuild.test({
      scheme,
      destinationId,
      testIdentifier: opts.testIdentifier,
      testIdentifiers: opts.testIdentifiers,
      testPlan: opts.testPlan,
      token,
      onLog: (c) => {
        log.build.append(c);
        onLog?.(c);
      },
    });
    const parsed = parseXcodebuildOutput(result.stdout + "\n" + result.stderr);
    const succeeded = parsed.succeeded && result.code === 0;
    this.publishDiagnostics(parsed);
    return this.track({
      succeeded,
      parsed,
      summary: this.summarize("TEST", { ...parsed, succeeded }),
      scheme,
      destinationId,
    });
  }

  async clean(
    scheme?: string,
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<ActionResult> {
    const resolved = await this.xcodebuild.resolveScheme(scheme);
    this.revealBuildLog();
    log.build.appendLine(`\n=== Clean ${resolved} ===`);
    const result = await this.xcodebuild.clean(
      resolved,
      (chunk) => {
        log.build.append(chunk);
        onLog?.(chunk);
      },
      token
    );
    const parsed = parseXcodebuildOutput(result.stdout + "\n" + result.stderr);
    const succeeded = parsed.succeeded && result.code === 0;
    this.publishDiagnostics(parsed);
    return this.track({
      succeeded,
      parsed,
      summary: this.summarize("CLEAN", { ...parsed, succeeded }),
      scheme: resolved,
      destinationId: this.config.destination,
    });
  }

  /** Determines if the given UDID or identifier belongs to a physical device. */
  async isPhysicalDevice(udid: string): Promise<boolean> {
    if (!this.devicectl) {
      return false;
    }
    const dev = await this.devicectl.find(udid);
    return Boolean(dev);
  }

  /** Ensures a bootable destination is selected (simulator or device), returns its UDID. */
  async ensureDestination(destinationId?: string): Promise<string> {
    const udid = destinationId ?? this.config.destination;
    if (udid) {
      return udid;
    }
    // Check connected physical devices first
    if (this.devicectl) {
      const devices = await this.devicectl.listDevices();
      const connected = devices.find((d) => d.tunnelConnected);
      if (connected) {
        await this.config.setDestination(connected.udid);
        return connected.udid;
      }
    }
    const sims = await this.simctl.list(true);
    const booted = sims.find((s) => s.state === "Booted");
    const chosen = booted ?? sims[0];
    if (!chosen) {
      throw new Error("No iOS simulators or physical devices are available.");
    }
    await this.config.setDestination(chosen.udid);
    return chosen.udid;
  }

  async run(
    opts: { scheme?: string; destinationId?: string },
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<RunResultInfo> {
    const scheme = await this.xcodebuild.resolveScheme(opts.scheme);
    const destinationId = await this.ensureDestination(opts.destinationId);

    // 1. Build
    const buildResult = await this.build({ scheme, destinationId }, onLog, token);
    if (!buildResult.succeeded) {
      return { ...buildResult, summary: `Build failed, not launching.\n${buildResult.summary}` };
    }

    // 2. Resolve product bundle + app path
    const settings = await this.xcodebuild.getBuildSettings(scheme, undefined, destinationId);
    if (!settings.appPath || !settings.productBundleIdentifier) {
      throw new Error("Could not resolve app path or bundle identifier from build settings.");
    }

    const bundleId = settings.productBundleIdentifier;
    const name = settings.productName ?? scheme;
    const isDevice = await this.isPhysicalDevice(destinationId);

    if (isDevice && this.devicectl) {
      const dev = await this.devicectl.find(destinationId);
      const targetId = dev?.coreDeviceIdentifier ?? destinationId;

      if (dev && !dev.developerModeEnabled) {
        throw new Error(
          `Developer Mode is disabled on "${dev.name}". Enable it in Settings > Privacy & Security > Developer Mode.`
        );
      }

      log.build.appendLine(`\nInstalling on device ${dev?.name ?? destinationId}…`);
      await this.devicectl.installApp(targetId, settings.appPath);
      log.build.appendLine(`Launching ${bundleId} on device`);

      await this.stopApp();
      if (this.config.streamAppLogs) {
        this.launchStreamingDevice(targetId, bundleId, name);
      } else {
        await this.devicectl.launchApp(targetId, bundleId);
      }
      this.appSession = { udid: destinationId, bundleId, name };
      this._onDidChangeState.fire();

      return {
        ...buildResult,
        bundleId,
        appPath: settings.appPath,
        summary: `Launched ${name} (${bundleId}) on device ${dev?.name ?? destinationId}.`,
      };
    }

    // 3. Boot simulator
    log.build.appendLine(`\nBooting simulator ${destinationId}…`);
    await this.simctl.boot(destinationId);
    if (this.config.openSimulatorOnRun) {
      await this.simctl.openApp();
    }

    // 4. Install + launch
    log.build.appendLine(`Installing ${settings.appPath}`);
    await this.simctl.install(destinationId, settings.appPath);
    log.build.appendLine(`Launching ${bundleId}`);

    await this.stopApp();
    if (this.config.streamAppLogs) {
      this.launchStreaming(destinationId, bundleId, name);
    } else {
      await this.simctl.launch(destinationId, bundleId);
    }
    this.appSession = { udid: destinationId, bundleId, name };
    this._onDidChangeState.fire();

    return {
      ...buildResult,
      bundleId,
      appPath: settings.appPath,
      summary: `Launched ${name} (${bundleId}) on simulator ${destinationId}.`,
    };
  }

  /**
   * Launches the app attached to a pty and pipes its output to the app log.
   * Not awaited: the process lives for as long as the app runs.
   */
  private launchStreaming(udid: string, bundleId: string, name: string): void {
    log.app.appendLine(`\n--- ${name} (${bundleId}) launched ---`);
    const proc = this.simctl.launchWithConsole(udid, bundleId, (chunk) => log.app.append(chunk));
    this.appProcess = proc;
    void proc.promise
      .catch((err) => log.error("App console stream ended", err))
      .finally(() => {
        if (this.appProcess === proc) {
          this.appProcess = undefined;
          this.appSession = undefined;
          this._onDidChangeState.fire();
        }
      });
  }

  private launchStreamingDevice(deviceId: string, bundleId: string, name: string): void {
    if (!this.devicectl) {
      return;
    }
    log.app.appendLine(`\n--- ${name} (${bundleId}) launched on physical device ---`);
    const proc = this.devicectl.launchWithConsole(deviceId, bundleId, (chunk) => log.app.append(chunk));
    this.appProcess = proc;
    void proc.promise
      .catch((err) => log.error("App console stream ended", err))
      .finally(() => {
        if (this.appProcess === proc) {
          this.appProcess = undefined;
          this.appSession = undefined;
          this._onDidChangeState.fire();
        }
      });
  }

  async listSimulators(availableOnly = true): Promise<Simulator[]> {
    return this.simctl.list(availableOnly);
  }
}
