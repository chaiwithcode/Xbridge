//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import { ConfigService } from "./core/config";
import { SimctlService } from "./services/simctl";

/** The high-level action a status update belongs to. */
export type ActionKind = "Build" | "Run" | "Test" | "Clean";

/** Structured result used to render the post-run status pill. */
export interface BuildStatus {
  action: ActionKind;
  succeeded: boolean;
  errors: number;
  warnings: number;
  /** e.g. "Executed 42 tests, with 1 failure". */
  testSummary?: string;
}

/**
 * Xcode-style toolbar rendered in the status bar. Mirrors Xcode's layout:
 * a Run/Stop toggle and Build/Test actions, an independently clickable
 * `scheme` and `destination` selector (like Xcode's two-part control), and a
 * live activity pill that shows the current phase, a spinner, and the final
 * result with error/warning counts.
 */
export class StatusBar implements vscode.Disposable {
  private readonly runStop: vscode.StatusBarItem;
  private readonly build: vscode.StatusBarItem;
  private readonly test: vscode.StatusBarItem;
  private readonly scheme: vscode.StatusBarItem;
  private readonly destination: vscode.StatusBarItem;
  private readonly activity: vscode.StatusBarItem;
  private readonly app: vscode.StatusBarItem;
  private readonly toolbar: vscode.StatusBarItem[];
  private running = false;
  private visible = true;

  // Current live-activity state.
  private action?: ActionKind;
  private phase?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly simctl: SimctlService
  ) {
    this.runStop = this.create(106, "xcodekit.run", "Run");
    this.build = this.create(105, "xcodekit.build", "Build", "$(tools)", "XcodeKit: Build");
    this.test = this.create(104, "xcodekit.test", "Test", "$(beaker)", "XcodeKit: Run Tests");
    this.scheme = this.create(103, "xcodekit.selectScheme", "Scheme");
    this.destination = this.create(102, "xcodekit.selectDestination", "Destination");
    this.toolbar = [this.runStop, this.build, this.test, this.scheme, this.destination];

    // The activity pill starts hidden and only appears while/after an action runs.
    this.activity = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
    this.activity.name = "XcodeKit Status";
    this.activity.command = "xcodekit.showOutput";

    // Shown only while an app launched by XcodeKit is running.
    this.app = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.app.name = "XcodeKit App";
    this.app.command = "xcodekit.stopApp";

    this.updateRunStop();
  }

  private create(
    priority: number,
    command: string,
    name: string,
    text?: string,
    tooltip?: string
  ): vscode.StatusBarItem {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    item.name = `XcodeKit ${name}`;
    item.command = command;
    if (text) {
      item.text = text;
    }
    if (tooltip) {
      item.tooltip = tooltip;
    }
    item.show();
    return item;
  }

  /** Hides the whole toolbar when the folder has no Xcode project. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const item of this.toolbar) {
      if (visible) {
        item.show();
      } else {
        item.hide();
      }
    }
    if (!visible) {
      this.activity.hide();
      this.app.hide();
    }
  }

  /** Shows or hides the "app running" pill with a one-click stop. */
  setAppRunning(name?: string): void {
    if (!name || !this.visible) {
      this.app.hide();
      return;
    }
    this.app.text = `$(circle-filled) ${name}`;
    this.app.tooltip = new vscode.MarkdownString(
      `**${name}** is running on the simulator.\n\n_Click to stop it._`
    );
    this.app.color = new vscode.ThemeColor("charts.green");
    this.app.show();
  }

  /** Reflects whether a build/run/test action is currently in progress. */
  setRunning(running: boolean): void {
    this.running = running;
    this.updateRunStop();
  }

  private updateRunStop(): void {
    if (this.running) {
      this.runStop.text = "$(debug-stop) Stop";
      this.runStop.tooltip = "XcodeKit: Stop the running task";
      this.runStop.command = "xcodekit.stop";
      this.runStop.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
      this.runStop.text = "$(play) Run";
      this.runStop.tooltip = "XcodeKit: Build & Run";
      this.runStop.command = "xcodekit.run";
      this.runStop.backgroundColor = undefined;
    }
  }

  /** Begins a live activity, showing a spinner with the initial phase. */
  startActivity(action: ActionKind): void {
    this.action = action;
    this.phase = action === "Clean" ? "Cleaning" : "Building";
    this.renderActivity();
  }

  /**
   * Updates the current phase from a chunk of xcodebuild output, so the pill
   * reflects Building → Linking → Testing → Launching as Xcode does.
   */
  observeLog(chunk: string): void {
    if (!this.action) {
      return;
    }
    let next = this.phase;
    if (/Test Suite .* started|Testing started|\bTest case\b/.test(chunk)) {
      next = "Testing";
    } else if (/Launching|Installing app|Waiting for .* to launch/.test(chunk)) {
      next = "Launching";
    } else if (/\bLd\b|Linking/.test(chunk)) {
      next = "Linking";
    } else if (/CompileSwift|Compiling|SwiftCompile/.test(chunk)) {
      next = "Building";
    }
    if (next !== this.phase) {
      this.phase = next;
      this.renderActivity();
    }
  }

  private renderActivity(): void {
    const scheme = this.config.scheme ?? "";
    const suffix = scheme ? ` ${scheme}` : "";
    this.activity.text = `$(sync~spin) ${this.phase}${suffix}…`;
    this.activity.tooltip = "XcodeKit: In progress — click to show the build log";
    this.activity.command = "xcodekit.showOutput";
    this.activity.backgroundColor = undefined;
    this.activity.show();
  }

  /** Renders the final result of an action with error/warning counts. */
  showResult(status: BuildStatus): void {
    this.action = undefined;
    this.phase = undefined;
    const warnPart = status.warnings > 0 ? ` $(warning) ${status.warnings}` : "";
    if (status.succeeded) {
      this.activity.text = `$(pass-filled) ${status.action} succeeded${warnPart}`;
      this.activity.backgroundColor = undefined;
      this.activity.command = status.warnings > 0 ? "xcodekit.showIssues" : "xcodekit.showOutput";
      this.activity.tooltip = new vscode.MarkdownString(
        `**${status.action} succeeded**` +
          (status.warnings ? `\n\n${status.warnings} warning(s)` : "") +
          (status.testSummary ? `\n\n${status.testSummary}` : "") +
          `\n\n_Click to review._`
      );
    } else {
      this.activity.text = `$(error) ${status.errors}${warnPart}`;
      this.activity.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      this.activity.command = "xcodekit.showIssues";
      this.activity.tooltip = new vscode.MarkdownString(
        `**${status.action} failed**\n\n${status.errors} error(s), ${status.warnings} warning(s)` +
          (status.testSummary ? `\n\n${status.testSummary}` : "") +
          `\n\n_Click to jump to the failing code._`
      );
    }
    this.activity.show();
  }

  /** Shows a generic failure (e.g. the action could not start). */
  showError(message: string): void {
    this.action = undefined;
    this.phase = undefined;
    this.activity.text = "$(error) Failed";
    this.activity.command = "xcodekit.showOutput";
    this.activity.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    this.activity.tooltip = new vscode.MarkdownString(`**XcodeKit**\n\n${message}`);
    this.activity.show();
  }

  /** Hides the activity pill (e.g. after cancellation). */
  clearActivity(): void {
    this.action = undefined;
    this.phase = undefined;
    this.activity.hide();
  }

  async refresh(): Promise<void> {
    const scheme = this.config.scheme ?? "No scheme";
    this.scheme.text = `$(target) ${scheme}`;
    this.scheme.tooltip = new vscode.MarkdownString(
      `**Scheme:** ${scheme}\n\n**Configuration:** ${this.config.configuration}\n\n_Click to change the scheme._`
    );

    let destination = "Any iOS Simulator";
    let booted = false;
    const destUdid = this.config.destination;
    if (destUdid) {
      const sim = await this.simctl.find(destUdid).catch(() => undefined);
      destination = sim ? sim.name : "Unknown device";
      booted = sim?.state === "Booted";
    }
    this.destination.text = `$(${booted ? "vm-running" : "device-mobile"}) ${destination}`;
    this.destination.tooltip = new vscode.MarkdownString(
      `**Destination:** ${destination}${booted ? " (booted)" : ""}\n\n_Click to change the simulator or device._`
    );
  }

  dispose(): void {
    for (const item of this.toolbar) {
      item.dispose();
    }
    this.activity.dispose();
    this.app.dispose();
  }
}
