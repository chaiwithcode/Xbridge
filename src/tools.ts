//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import { XcodeKitManager } from "./manager";

type Tool<T> = vscode.LanguageModelTool<T>;

function text(...parts: string[]): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(parts.join("\n")),
  ]);
}

interface BuildInput {
  scheme?: string;
  configuration?: string;
  destinationId?: string;
}

class BuildTool implements Tool<BuildInput> {
  constructor(private readonly manager: XcodeKitManager) {}

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<BuildInput>) {
    return {
      invocationMessage: `Building ${options.input.scheme ?? "the project"}…`,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<BuildInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await this.manager.build(options.input, undefined, token);
    const header = result.succeeded ? "Build succeeded." : "Build failed.";
    return text(
      header,
      `Scheme: ${result.scheme}`,
      result.destinationId ? `Destination: ${result.destinationId}` : "",
      "",
      result.summary
    );
  }
}

interface TestInput {
  scheme?: string;
  destinationId?: string;
  testIdentifier?: string;
}

class TestTool implements Tool<TestInput> {
  constructor(private readonly manager: XcodeKitManager) {}

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<TestInput>) {
    return {
      invocationMessage: options.input.testIdentifier
        ? `Running test ${options.input.testIdentifier}…`
        : "Running tests…",
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TestInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await this.manager.test(options.input, undefined, token);
    return text(
      result.succeeded ? "Tests passed." : "Tests failed.",
      `Scheme: ${result.scheme}`,
      "",
      result.summary
    );
  }
}

interface RunInput {
  scheme?: string;
  destinationId?: string;
}

class RunTool implements Tool<RunInput> {
  constructor(private readonly manager: XcodeKitManager) {}

  async prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<RunInput>) {
    return { invocationMessage: "Building and launching on simulator…" };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await this.manager.run(options.input, undefined, token);
    return text(
      result.succeeded ? "App launched." : "Run failed.",
      result.bundleId ? `Bundle ID: ${result.bundleId}` : "",
      "",
      result.summary
    );
  }
}

class ListSchemesTool implements Tool<Record<string, never>> {
  constructor(private readonly manager: XcodeKitManager) {}

  async invoke(): Promise<vscode.LanguageModelToolResult> {
    const info = await this.manager.xcodebuild.listSchemes();
    return text(
      `Schemes: ${info.schemes.join(", ") || "(none)"}`,
      `Targets: ${info.targets.join(", ") || "(none)"}`,
      `Configurations: ${info.configurations.join(", ")}`,
      `Active scheme: ${this.manager.config.scheme ?? "(not selected)"}`
    );
  }
}

interface ListSimsInput {
  availableOnly?: boolean;
}

class ListSimulatorsTool implements Tool<ListSimsInput> {
  constructor(private readonly manager: XcodeKitManager) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListSimsInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const sims = await this.manager.listSimulators(options.input.availableOnly ?? true);
    if (sims.length === 0) {
      return text("No simulators found.");
    }
    const lines = sims.map(
      (s) => `- ${s.name} [${s.runtime}] state=${s.state} udid=${s.udid}`
    );
    const selected = this.manager.config.destination;
    return text(
      `${sims.length} simulator(s):`,
      ...lines,
      selected ? `\nSelected destination: ${selected}` : ""
    );
  }
}

interface BootInput {
  udid?: string;
}

class BootSimulatorTool implements Tool<BootInput> {
  constructor(private readonly manager: XcodeKitManager) {}

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<BootInput>) {
    return { invocationMessage: `Booting simulator ${options.input.udid ?? ""}…` };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<BootInput>
  ): Promise<vscode.LanguageModelToolResult> {
    const udid = await this.manager.ensureDestination(options.input.udid);
    await this.manager.simctl.boot(udid);
    await this.manager.simctl.openApp();
    const sim = await this.manager.simctl.find(udid);
    return text(`Booted ${sim?.name ?? udid} (${udid}).`);
  }
}

/** Registers all XcodeKit language-model tools for AI agents. */
export function registerLanguageModelTools(
  context: vscode.ExtensionContext,
  manager: XcodeKitManager
): void {
  context.subscriptions.push(
    vscode.lm.registerTool("xcodekit_build", new BuildTool(manager)),
    vscode.lm.registerTool("xcodekit_test", new TestTool(manager)),
    vscode.lm.registerTool("xcodekit_run", new RunTool(manager)),
    vscode.lm.registerTool("xcodekit_listSchemes", new ListSchemesTool(manager)),
    vscode.lm.registerTool("xcodekit_listSimulators", new ListSimulatorsTool(manager)),
    vscode.lm.registerTool("xcodekit_bootSimulator", new BootSimulatorTool(manager))
  );
}
