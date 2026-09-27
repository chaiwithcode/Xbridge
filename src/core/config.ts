//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { log } from "./log";

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

const CONFIG_SECTION = "xbridge";

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

  /** Stream the launched app's stdout/stderr into the "XBridge App" channel. */
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

  get projectPath(): string | undefined {
    return this.config.get<string>("projectPath") || undefined;
  }

  async setProjectPath(value: string | undefined): Promise<void> {
    this.cachedProject = undefined;
    await this.config.update("projectPath", value || undefined, vscode.ConfigurationTarget.Workspace);
  }

  private cachedProject?: XcodeProject;

  /** Drops the cached detected project so the next call re-scans the workspace. */
  invalidate(): void {
    this.cachedProject = undefined;
  }

  /**
   * Resolves the active Xcode project/workspace. Prefers an explicit
   * configured path, otherwise auto-detects within the workspace folders.
   */
  async resolveProject(): Promise<XcodeProject> {
    const explicit = this.projectPath;
    if (explicit) {
      if (fs.existsSync(explicit)) {
        return this.describe(explicit);
      }
      log.warn(`Configured project path "${explicit}" no longer exists on disk. Falling back to auto-detection.`);
      await this.setProjectPath(undefined);
    }
    if (this.cachedProject && fs.existsSync(this.cachedProject.path)) {
      return this.cachedProject;
    }
    const detected = await this.autoDetect();
    if (!detected) {
      throw new Error(
        "No Xcode project, workspace or Package.swift found in the workspace. Set 'xbridge.projectPath' to specify one."
      );
    }
    this.cachedProject = detected;
    return detected;
  }

  private tryResolveProjectSync(): XcodeProject | undefined {
    const explicit = this.projectPath;
    if (explicit) {
      try {
        if (fs.existsSync(explicit)) {
          return this.describe(explicit);
        }
      } catch {
        return undefined;
      }
    }
    return this.cachedProject && fs.existsSync(this.cachedProject.path) ? this.cachedProject : undefined;
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
    // Exclude common build directories, dependencies, and temporary outputs
    const exclude = "**/{node_modules,.build,DerivedData,Pods,Carthage,SourcePackages,.swiftpm,build_product}/**";

    // Helper: filters out project bundles that are nested inside another accepted project bundle or directory
    const filterNested = (paths: string[]): string[] => {
      const sorted = [...paths].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
      const roots: string[] = [];
      for (const p of sorted) {
        const pDir = path.dirname(p);
        const isNested = roots.some((root) => {
          const rel = path.relative(path.dirname(root), pDir);
          return !rel.startsWith("..") && !path.isAbsolute(rel) && rel !== "";
        });
        if (!isNested) {
          roots.push(p);
        }
      }
      return roots;
    };

    // 1. Prefer .xcworkspace
    const workspaces = await vscode.workspace.findFiles("**/*.xcworkspace/contents.xcworkspacedata", exclude, 30);
    const validWorkspaces = filterNested(
      workspaces
        .map((ws) => path.dirname(ws.fsPath))
        .filter((wsPath) => !wsPath.includes(".xcodeproj/"))
    );
    if (validWorkspaces.length > 0) {
      return this.describe(validWorkspaces[0]);
    }

    // 2. Then .xcodeproj
    const projects = await vscode.workspace.findFiles("**/*.xcodeproj/project.pbxproj", exclude, 30);
    if (projects.length > 0) {
      const validProjects = filterNested(
        projects
          .map((p) => path.dirname(p.fsPath))
          .filter((p) => !p.includes(".xcodeproj/"))
      );
      if (validProjects.length > 0) {
        return this.describe(validProjects[0]);
      }
    }

    // 3. Then Package.swift
    const packages = await vscode.workspace.findFiles("**/Package.swift", exclude, 20);
    if (packages.length > 0) {
      const sorted = packages
        .map((p) => p.fsPath)
        .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
      return this.describe(sorted[0]);
    }

    return undefined;
  }
}
