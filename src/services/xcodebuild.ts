//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as path from "path";
import { runOrThrow, Process, RunResult } from "../core/process";
import { ConfigService, XcodeProject } from "../core/config";
import { log } from "../core/log";
import { BuildSettingsEntry, selectRunnableBuildSettings } from "./buildSettings";

export interface SchemeInfo {
  schemes: string[];
  targets: string[];
  configurations: string[];
}

export interface BuildSettings {
  /** e.g. MyApp.app path inside DerivedData for a simulator build. */
  appPath?: string;
  productBundleIdentifier?: string;
  productName?: string;
  raw: Record<string, string>;
}

export interface BuildOptions {
  scheme: string;
  configuration?: string;
  destinationId?: string;
  onLog?: (chunk: string) => void;
  token?: vscode.CancellationToken;
}

export interface TestOptions extends BuildOptions {
  testIdentifier?: string;
  /** Multiple `-only-testing` identifiers (Target/Class/method) to run. */
  testIdentifiers?: string[];
  /** Name of an .xctestplan (without extension) to run via -testPlan. */
  testPlan?: string;
}

/** Test targets discovered in the project, classified by kind. */
export interface TestTargets {
  /** All targets that appear to contain tests. */
  all: string[];
  /** Unit-test targets (name contains "Test" but not "UITest"). */
  unit: string[];
  /** UI-test targets (name contains "UITest"). */
  ui: string[];
}

/** Wraps `xcodebuild` for listing, building, testing and running. */
export class XcodebuildService {
  private schemeCache?: Promise<SchemeInfo>;

  constructor(private readonly config: ConfigService) {}

  /** Drops cached project metadata so the next read re-runs `xcodebuild -list`. */
  invalidate(): void {
    this.schemeCache = undefined;
  }

  private containerArgs(project: XcodeProject): string[] {
    if (project.containerFlag) {
      return [project.containerFlag, project.path];
    }
    return [];
  }

  /** Builds the destination flag. Falls back to a generic simulator. */
  private destinationArgs(destinationId?: string): string[] {
    const udid = destinationId ?? this.config.destination;
    if (udid) {
      return ["-destination", `id=${udid}`];
    }
    return ["-destination", "generic/platform=iOS Simulator"];
  }

  private derivedDataArgs(): string[] {
    const path = this.config.derivedDataPath;
    return path ? ["-derivedDataPath", path] : [];
  }

  async listSchemes(): Promise<SchemeInfo> {
    if (!this.schemeCache) {
      this.schemeCache = this.fetchSchemes().catch((err) => {
        this.schemeCache = undefined;
        throw err;
      });
    }
    return this.schemeCache;
  }

  private async fetchSchemes(): Promise<SchemeInfo> {
    const project = await this.config.resolveProject();

    const args = ["-list", "-json", ...this.containerArgs(project)];
    const result = await runOrThrow("xcodebuild", args, { cwd: project.cwd });

    try {
      const parsed = JSON.parse(result.stdout);
      const container = parsed.workspace ?? parsed.project ?? {};
      return {
        schemes: container.schemes ?? [],
        targets: container.targets ?? [],
        configurations: container.configurations ?? ["Debug", "Release"],
      };
    } catch (err) {
      log.error("Failed to parse xcodebuild -list output", err);
      return { schemes: [], targets: [], configurations: ["Debug", "Release"] };
    }
  }

  /** Resolves the active scheme, auto-selecting the only one if unset. */
  async resolveScheme(explicit?: string): Promise<string> {
    if (explicit) {
      return explicit;
    }
    const configured = this.config.scheme;
    if (configured) {
      return configured;
    }
    const { schemes } = await this.listSchemes();
    if (schemes.length === 1) {
      await this.config.setScheme(schemes[0]);
      return schemes[0];
    }
    if (schemes.length === 0) {
      throw new Error("No schemes found in the project.");
    }
    throw new Error(
      `Multiple schemes available (${schemes.join(", ")}). Select one with "XBridge: Select Scheme".`
    );
  }

  /** Classifies the project's targets into unit- and UI-test targets. */
  async listTestTargets(): Promise<TestTargets> {
    const { targets } = await this.listSchemes();
    const all = targets.filter((t) => /test/i.test(t));
    const ui = all.filter((t) => /uitest/i.test(t));
    const unit = all.filter((t) => !/uitest/i.test(t));
    return { all, unit, ui };
  }

  /** Finds `.xctestplan` files in the project and returns their base names. */
  async listTestPlans(): Promise<string[]> {
    const project = await this.config.resolveProject();
    const pattern = new vscode.RelativePattern(project.cwd, "**/*.xctestplan");
    const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.build}/**", 50);
    const names = files.map((f) => path.basename(f.fsPath, ".xctestplan"));
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }

  async getBuildSettings(scheme: string, configuration?: string, destinationId?: string): Promise<BuildSettings> {
    const project = await this.config.resolveProject();
    const args = [
      "-showBuildSettings",
      "-json",
      "-scheme",
      scheme,
      "-configuration",
      configuration ?? this.config.configuration,
      ...this.containerArgs(project),
      ...this.destinationArgs(destinationId),
      ...this.derivedDataArgs(),
    ];
    const result = await runOrThrow("xcodebuild", args, { cwd: project.cwd });

    let raw: Record<string, string> = {};
    try {
      const parsed = JSON.parse(result.stdout) as BuildSettingsEntry[];
      raw = selectRunnableBuildSettings(parsed, scheme)?.buildSettings ?? {};
    } catch (err) {
      log.error("Failed to parse build settings", err);
    }

    let appPath: string | undefined;
    if (raw.TARGET_BUILD_DIR && raw.FULL_PRODUCT_NAME) {
      appPath = `${raw.TARGET_BUILD_DIR}/${raw.FULL_PRODUCT_NAME}`;
    } else if (raw.CODESIGNING_FOLDER_PATH) {
      appPath = raw.CODESIGNING_FOLDER_PATH;
    }

    return {
      appPath,
      productBundleIdentifier: raw.PRODUCT_BUNDLE_IDENTIFIER,
      productName: raw.PRODUCT_NAME,
      raw,
    };
  }

  private async baseActionArgs(options: BuildOptions): Promise<{ project: XcodeProject; args: string[] }> {
    const project = await this.config.resolveProject();
    const args = [
      "-scheme",
      options.scheme,
      "-configuration",
      options.configuration ?? this.config.configuration,
      ...this.containerArgs(project),
      ...this.destinationArgs(options.destinationId),
      ...this.derivedDataArgs(),
      ...this.config.extraBuildArgs,
    ];
    return { project, args };
  }

  private startAction(
    action: string,
    project: XcodeProject,
    args: string[],
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Process {
    const fullArgs = [action, ...args];
    log.info(`xcodebuild ${fullArgs.join(" ")}`);
    return Process.start("xcodebuild", fullArgs, {
      cwd: project.cwd,
      onStdout: onLog,
      onStderr: onLog,
      token,
    });
  }

  async build(options: BuildOptions): Promise<RunResult> {
    const { project, args } = await this.baseActionArgs(options);
    return this.startAction("build", project, args, options.onLog, options.token).promise;
  }

  async clean(
    scheme: string,
    onLog?: (chunk: string) => void,
    token?: vscode.CancellationToken
  ): Promise<RunResult> {
    const project = await this.config.resolveProject();
    const args = [
      "-scheme",
      scheme,
      ...this.containerArgs(project),
      ...this.derivedDataArgs(),
    ];
    return this.startAction("clean", project, args, onLog, token).promise;
  }

  async test(options: TestOptions): Promise<RunResult> {
    const { project, args } = await this.baseActionArgs(options);
    const testArgs = [...args];
    if (options.testPlan) {
      testArgs.push("-testPlan", options.testPlan);
    }
    if (options.testIdentifier) {
      testArgs.push("-only-testing", options.testIdentifier);
    }
    for (const id of options.testIdentifiers ?? []) {
      testArgs.push("-only-testing", id);
    }
    return this.startAction("test", project, testArgs, options.onLog, options.token).promise;
  }
}
