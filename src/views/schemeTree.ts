//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as path from "path";
import { XcodebuildService } from "../services/xcodebuild";
import { SimctlService } from "../services/simctl";
import { ConfigService } from "../core/config";

/** A "settings summary" row: a label with its current value, clickable to change. */
class SettingItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string, command: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.command = { command, title: label };
    this.tooltip = new vscode.MarkdownString(`**${label}** · ${value}\n\n_${tooltip}_`);
    this.contextValue = "setting";
    this.id = `setting:${label}`;
  }
}

/** A collapsible section header. */
class GroupItem extends vscode.TreeItem {
  constructor(label: string, public readonly key: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = `group.${key}`;
    this.id = `group:${key}`;
  }
}

/** A selectable option inside one of the groups. */
class ChoiceItem extends vscode.TreeItem {
  constructor(name: string, value: string, icon: string, selected: boolean, command: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = selected
      ? new vscode.ThemeIcon("pass-filled", new vscode.ThemeColor("charts.green"))
      : new vscode.ThemeIcon(icon);
    this.contextValue = selected ? "choice.active" : "choice";
    this.tooltip = selected ? `${name} (active)` : `Switch to ${name}`;
    this.command = { command, title: "Select", arguments: [value] };
  }
}

type Node = vscode.TreeItem;

export class SchemeTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly xcodebuild: XcodebuildService,
    private readonly config: ConfigService,
    private readonly simctl: SimctlService
  ) {}

  /** Re-reads project metadata from disk. */
  refresh(): void {
    this.xcodebuild.invalidate();
    this.simctl.invalidate();
    this._onDidChangeTreeData.fire();
  }

  /** Re-renders using cached metadata (e.g. after a selection changed). */
  rerender(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      return this.rootItems();
    }
    if (element instanceof GroupItem) {
      return this.groupChildren(element.key);
    }
    return [];
  }

  private async rootItems(): Promise<Node[]> {
    const [project, destination] = await Promise.all([
      this.projectLabel(),
      this.destinationLabel(),
    ]);
    return [
      new SettingItem(
        "Project",
        project,
        "folder-opened",
        "xcodekit.selectProject",
        "Choose the .xcodeproj or .xcworkspace to work with"
      ),
      new SettingItem(
        "Scheme",
        this.config.scheme ?? "Select…",
        "target",
        "xcodekit.selectScheme",
        "Select the scheme to build, run and test"
      ),
      new SettingItem(
        "Configuration",
        this.config.configuration,
        "settings-gear",
        "xcodekit.selectConfiguration",
        "Select the build configuration (Debug/Release)"
      ),
      new SettingItem(
        "Destination",
        destination,
        "device-mobile",
        "xcodekit.selectDestination",
        "Select the simulator or device to run on"
      ),
      new SettingItem(
        "Test Plan",
        this.config.testPlan ?? "Default",
        "checklist",
        "xcodekit.selectTestPlan",
        "Select the test plan to run (or the scheme default)"
      ),
      new SettingItem(
        "Test Target",
        this.config.testTarget ?? "All Tests",
        "beaker",
        "xcodekit.selectTestTarget",
        "Select which test target to run (or all tests)"
      ),
      new GroupItem("Schemes", "schemes", "list-tree"),
      new GroupItem("Test Plans", "testPlans", "checklist"),
      new GroupItem("Test Targets", "testTargets", "beaker"),
    ];
  }

  private async groupChildren(key: string): Promise<Node[]> {
    try {
      switch (key) {
        case "schemes": {
          const { schemes } = await this.xcodebuild.listSchemes();
          if (schemes.length === 0) {
            return [placeholder("No schemes found", "warning")];
          }
          const active = this.config.scheme;
          return schemes.map(
            (s) => new ChoiceItem(s, s, "target", s === active, "xcodekit.selectScheme")
          );
        }
        case "testPlans": {
          const plans = await this.xcodebuild.listTestPlans();
          const active = this.config.testPlan;
          const items: Node[] = [
            new ChoiceItem("Default", "", "circle-large-outline", !active, "xcodekit.selectTestPlan"),
          ];
          for (const p of plans) {
            items.push(
              new ChoiceItem(p, p, "checklist", p === active, "xcodekit.selectTestPlan")
            );
          }
          return items;
        }
        case "testTargets": {
          const targets = await this.xcodebuild.listTestTargets();
          const active = this.config.testTarget;
          const items: Node[] = [
            new ChoiceItem("All Tests", "", "beaker", !active, "xcodekit.selectTestTarget"),
          ];
          for (const t of targets.unit) {
            items.push(
              new ChoiceItem(t, t, "beaker", t === active, "xcodekit.selectTestTarget")
            );
          }
          for (const t of targets.ui) {
            items.push(
              new ChoiceItem(t, t, "device-mobile", t === active, "xcodekit.selectTestTarget")
            );
          }
          return items;
        }
        default:
          return [];
      }
    } catch (err) {
      return [placeholder(err instanceof Error ? err.message : "Failed to load", "error")];
    }
  }

  private async projectLabel(): Promise<string> {
    try {
      const project = await this.config.resolveProject();
      return path.basename(project.path);
    } catch {
      return "Select…";
    }
  }

  private async destinationLabel(): Promise<string> {
    const udid = this.config.destination;
    if (!udid) {
      return "Any iOS Simulator";
    }
    const sim = await this.simctl.find(udid).catch(() => undefined);
    return sim ? sim.name : "Unknown device";
  }
}

function placeholder(label: string, icon: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}
