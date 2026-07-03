//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as path from "path";

export type ProjectKind = "workspace" | "project" | "package";

export interface XcodeProject {
  /** Absolute path to the .xcworkspace, .xcodeproj, or directory containing Package.swift. */
  path: string;
  kind: ProjectKind;
  /** Directory that should be used as the cwd for commands. */
  cwd: string;
  /** The xcodebuild flag: -workspace or -project. Undefined for SwiftPM packages. */
  containerFlag?: "-workspace" | "-project";
}

const CONFIG_SECTION = "xcodekit";

export class ConfigService {
  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  get scheme(): string | undefined {
    return this.config.get<string>("scheme") || undefined;
  }

  async setScheme(scheme: string | undefined): Promise<void> {
    await this.config.update("scheme", scheme ?? "", vscode.ConfigurationTarget.Workspace);
  }

  get configuration(): string {
    return this.config.get<string>("configuration") || "Debug";
  }

  async setConfiguration(value: string): Promise<void> {
    await this.config.update("configuration", value, vscode.ConfigurationTarget.Workspace);
  }

  get destination(): string | undefined {
    return this.config.get<string>("destination") || undefined;
  }

  async setDestination(udid: string | undefined): Promise<void> {
    await this.config.update("destination", udid ?? "", vscode.ConfigurationTarget.Workspace);
  }

  /** The selected test plan (.xctestplan base name). Empty = scheme default. */
  get testPlan(): string | undefined {
    return this.config.get<string>("testPlan") || undefined;
  }

  async setTestPlan(value: string | undefined): Promise<void> {
    await this.config.update("testPlan", value ?? "", vscode.ConfigurationTarget.Workspace);
  }

  /** The selected test target to run. Empty = all tests. */
  get testTarget(): string | undefined {
    return this.config.get<string>("testTarget") || undefined;
  }

  async setTestTarget(value: string | undefined): Promise<void> {
    await this.config.update("testTarget", value ?? "", vscode.ConfigurationTarget.Workspace);
  }

  get extraBuildArgs(): string[] {
    return this.config.get<string[]>("extraBuildArgs") ?? [];
  }

  /** Stream the launched app's stdout/stderr into the "XcodeKit App" channel. */
  get streamAppLogs(): boolean {
    return this.config.get<boolean>("streamAppLogs") ?? true;
  }

  /** Bring Simulator.app to the front when running the app. */
  get openSimulatorOnRun(): boolean {
    return this.config.get<boolean>("openSimulatorOnRun") ?? true;
  }

  /** Reveal the build log automatically when an action starts. */
  get autoRevealBuildLog(): boolean {
    return this.config.get<boolean>("autoRevealBuildLog") ?? false;
  }

  get derivedDataPath(): string | undefined {
    const custom = this.config.get<string>("derivedDataPath");
    if (custom) {
      return custom;
    }
    const project = this.tryResolveProjectSync();
    if (project) {
      return path.join(project.cwd, ".build", "DerivedData");
    }
    return undefined;
  }

  /**
   * Resolves the active Xcode project/workspace. Prefers an explicit
   * configured path, otherwise auto-detects within the workspace folders.
   */
  async resolveProject(): Promise<XcodeProject> {
    const explicit = this.config.get<string>("projectPath");
    if (explicit) {
      return this.describe(explicit);
    }
    const detected = await this.autoDetect();
    if (!detected) {
      throw new Error(
        "No Xcode project, workspace or Package.swift found in the workspace. Set 'xcodekit.projectPath' to specify one."
      );
    }
    return detected;
  }

  private tryResolveProjectSync(): XcodeProject | undefined {
    const explicit = this.config.get<string>("projectPath");
    if (explicit) {
      try {
        return this.describe(explicit);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private describe(targetPath: string): XcodeProject {
    const ext = path.extname(targetPath);
    if (ext === ".xcworkspace") {
      return {
        path: targetPath,
        kind: "workspace",
        cwd: path.dirname(targetPath),
        containerFlag: "-workspace",
      };
    }
    if (ext === ".xcodeproj") {
      return {
        path: targetPath,
        kind: "project",
        cwd: path.dirname(targetPath),
        containerFlag: "-project",
      };
    }
    // Assume SwiftPM package directory or Package.swift file.
    const cwd = path.basename(targetPath) === "Package.swift" ? path.dirname(targetPath) : targetPath;
    return { path: cwd, kind: "package", cwd };
  }

  private async autoDetect(): Promise<XcodeProject | undefined> {
    // Prefer .xcworkspace, then .xcodeproj, then Package.swift.
    const workspaces = await vscode.workspace.findFiles("**/*.xcworkspace/contents.xcworkspacedata", "**/node_modules/**", 5);
    for (const ws of workspaces) {
      const wsPath = path.dirname(ws.fsPath);
      // Skip the project-embedded workspace inside .xcodeproj bundles.
      if (!wsPath.includes(".xcodeproj/")) {
        return this.describe(wsPath);
      }
    }

    const projects = await vscode.workspace.findFiles("**/*.xcodeproj/project.pbxproj", "**/node_modules/**", 5);
    if (projects.length > 0) {
      return this.describe(path.dirname(projects[0].fsPath));
    }

    const packages = await vscode.workspace.findFiles("**/Package.swift", "**/node_modules/**", 5);
    if (packages.length > 0) {
      return this.describe(packages[0].fsPath);
    }

    return undefined;
  }
}
