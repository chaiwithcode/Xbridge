//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import * as path from "path";
import { ConfigService } from "./core/config";
import { log } from "./core/log";
import { XcodebuildService } from "./services/xcodebuild";
import { SimctlService } from "./services/simctl";
import { XcodeKitManager } from "./manager";
import { SchemeTreeProvider } from "./views/schemeTree";
import { SimulatorTreeProvider } from "./views/simulatorTree";
import { StatusBar } from "./statusBar";
import { registerCommands, updateHasProjectContext } from "./commands";
import { registerLanguageModelTools } from "./tools";
import { registerTestExplorer } from "./testExplorer";

export function activate(context: vscode.ExtensionContext): void {
  log.info("XcodeKit activating");

  const config = new ConfigService();
  const simctl = new SimctlService();
  const xcodebuild = new XcodebuildService(config);
  const manager = new XcodeKitManager(config, xcodebuild, simctl);
  context.subscriptions.push(manager);

  const schemeTree = new SchemeTreeProvider(xcodebuild, config, simctl);
  const simulatorTree = new SimulatorTreeProvider(simctl, () => config.destination);
  const statusBar = new StatusBar(config, simctl);
  context.subscriptions.push(statusBar);

  // Tree views (rather than bare providers) so they can carry a title
  // description and an error badge on the Activity Bar icon.
  const schemeView = vscode.window.createTreeView("xcodekit.schemes", {
    treeDataProvider: schemeTree,
    showCollapseAll: true,
  });
  const simulatorView = vscode.window.createTreeView("xcodekit.simulators", {
    treeDataProvider: simulatorTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(schemeView, simulatorView);

  registerCommands(context, {
    manager,
    config,
    simctl,
    xcodebuild,
    schemeTree,
    simulatorTree,
    statusBar,
  });

  registerLanguageModelTools(context, manager);
  registerTestExplorer(context, manager, xcodebuild);

  /** Mirrors the last build result and the running app into the chrome. */
  const syncState = () => {
    const errors = manager.lastResult?.parsed.errors.length ?? 0;
    schemeView.badge =
      errors > 0
        ? { value: errors, tooltip: `${errors} build error${errors === 1 ? "" : "s"}` }
        : undefined;

    const app = manager.runningApp;
    statusBar.setAppRunning(app?.name);
    void vscode.commands.executeCommand("setContext", "xcodekit.appRunning", Boolean(app));
    simulatorTree.rerender();
  };
  context.subscriptions.push(manager.onDidChangeState(syncState));

  /** Shows the project name in the view header and hides the toolbar if there is none. */
  const syncProject = async () => {
    const hasProject = await updateHasProjectContext(config);
    statusBar.setVisible(hasProject);
    if (hasProject) {
      const project = await config.resolveProject().catch(() => undefined);
      schemeView.description = project ? path.basename(project.path) : undefined;
    } else {
      schemeView.description = undefined;
    }
    await statusBar.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("xcodekit")) {
        schemeTree.refresh();
        simulatorTree.refresh();
        void syncProject();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      schemeTree.refresh();
      void syncProject();
    })
  );

  void syncProject();
  log.info("XcodeKit activated");
}

export function deactivate(): void {
  log.dispose();
}
