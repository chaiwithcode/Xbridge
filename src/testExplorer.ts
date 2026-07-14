//  Created by Deepak Sharma on 13/07/2026.
import * as vscode from "vscode";
import { XcodeKitManager } from "./manager";
import { XcodebuildService } from "./services/xcodebuild";

interface DiscoveredMethod {
  name: string;
  line: number;
}

interface DiscoveredClass {
  name: string;
  line: number;
  methods: DiscoveredMethod[];
}

// class/struct/actor SomeTests: XCTestCase / @Suite
const TYPE_RE = /\b(?:final\s+)?(?:class|struct|actor)\s+(\w+)/g;
// XCTest style: func testSomething()
const XCTEST_METHOD_RE = /func\s+(test\w*)\s*\(/g;
// swift-testing style: @Test ... func something()
const SWIFT_TESTING_RE = /@Test\b[^\n]*\r?\n(?:\s*@[^\n]*\r?\n)*\s*(?:private|internal|public|func|\s)*func\s+(\w+)\s*\(/g;

function lineOf(text: string, index: number): number {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
    }
  }
  return line;
}

/** Scans a Swift file's text and returns test classes/structs with their methods. */
function parseSwiftTests(text: string): DiscoveredClass[] {
  const types: { name: string; index: number; line: number }[] = [];
  for (const m of text.matchAll(TYPE_RE)) {
    types.push({ name: m[1], index: m.index ?? 0, line: lineOf(text, m.index ?? 0) });
  }
  if (types.length === 0) {
    return [];
  }

  const classes = new Map<string, DiscoveredClass>();
  const ensure = (index: number): DiscoveredClass | undefined => {
    // Assign a method to its nearest preceding type declaration.
    let owner: { name: string; index: number; line: number } | undefined;
    for (const t of types) {
      if (t.index <= index && (!owner || t.index > owner.index)) {
        owner = t;
      }
    }
    if (!owner) {
      return undefined;
    }
    let cls = classes.get(owner.name);
    if (!cls) {
      cls = { name: owner.name, line: owner.line, methods: [] };
      classes.set(owner.name, cls);
    }
    return cls;
  };

  const addMethod = (name: string, index: number) => {
    const cls = ensure(index);
    if (!cls || cls.methods.some((mm) => mm.name === name)) {
      return;
    }
    cls.methods.push({ name, line: lineOf(text, index) });
  };

  for (const m of text.matchAll(XCTEST_METHOD_RE)) {
    addMethod(m[1], m.index ?? 0);
  }
  for (const m of text.matchAll(SWIFT_TESTING_RE)) {
    addMethod(m[1], m.index ?? 0);
  }

  return [...classes.values()].filter((c) => c.methods.length > 0);
}

/**
 * Provides a native Test Explorer (Test navigator) for Xcode projects,
 * discovering XCTest and swift-testing tests from source and running them
 * through xcodebuild.
 */
export function registerTestExplorer(
  context: vscode.ExtensionContext,
  manager: XcodeKitManager,
  xcodebuild: XcodebuildService
): void {
  const controller = vscode.tests.createTestController("xcodekit.tests", "XcodeKit Tests");
  context.subscriptions.push(controller);

  const fileTests = new Map<string, vscode.TestItem>();

  async function discoverAll(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      "**/*.swift",
      "**/{node_modules,.build,DerivedData,Pods}/**",
      2000
    );
    controller.items.replace([]);
    fileTests.clear();
    for (const uri of files) {
      await discoverFile(uri);
    }
  }

  async function discoverFile(uri: vscode.Uri): Promise<void> {
    let text: string;
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    } catch {
      return;
    }
    if (!/XCTestCase|@Test|@Suite|import\s+Testing/.test(text)) {
      removeFile(uri);
      return;
    }
    const classes = parseSwiftTests(text);
    if (classes.length === 0) {
      removeFile(uri);
      return;
    }

    const fileId = uri.toString();
    const fileItem =
      fileTests.get(fileId) ??
      controller.createTestItem(fileId, vscode.workspace.asRelativePath(uri), uri);
    fileItem.children.replace([]);
    fileTests.set(fileId, fileItem);
    controller.items.add(fileItem);

    for (const cls of classes) {
      const classItem = controller.createTestItem(`${fileId}/${cls.name}`, cls.name, uri);
      classItem.range = new vscode.Range(cls.line, 0, cls.line, 0);
      fileItem.children.add(classItem);
      for (const method of cls.methods) {
        const methodItem = controller.createTestItem(
          `${fileId}/${cls.name}/${method.name}`,
          method.name,
          uri
        );
        methodItem.range = new vscode.Range(method.line, 0, method.line, 0);
        classItem.children.add(methodItem);
      }
    }
  }

  function removeFile(uri: vscode.Uri): void {
    const fileId = uri.toString();
    if (fileTests.has(fileId)) {
      controller.items.delete(fileId);
      fileTests.delete(fileId);
    }
  }

  controller.resolveHandler = async (item) => {
    if (!item) {
      await discoverAll();
    }
  };

  // Adds the refresh button to the Test Explorer toolbar.
  controller.refreshHandler = async () => {
    await discoverAll();
  };

  // Re-scan on edits/creates/deletes of Swift files.
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.swift");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => void discoverFile(uri)),
    watcher.onDidCreate((uri) => void discoverFile(uri)),
    watcher.onDidDelete((uri) => removeFile(uri))
  );

  /** Maps a file path to the best-matching test target name. */
  function targetForUri(uri: vscode.Uri, targets: string[]): string | undefined {
    const segments = uri.path.split("/");
    const match = targets.find((t) => segments.includes(t));
    return match ?? targets[0];
  }

  /** Builds an xcodebuild -only-testing identifier for a test item. */
  function identifierFor(item: vscode.TestItem, targets: string[]): string | undefined {
    const target = item.uri ? targetForUri(item.uri, targets) : targets[0];
    if (!target) {
      return undefined;
    }
    // Walk up the label chain (Class, method) up to the file-level item.
    const chain: string[] = [];
    let node: vscode.TestItem | undefined = item;
    while (node && node.parent) {
      chain.unshift(node.label);
      node = node.parent;
    }
    return [target, ...chain].join("/");
  }

  function collectLeaves(item: vscode.TestItem, into: vscode.TestItem[]): void {
    if (item.children.size === 0) {
      into.push(item);
    } else {
      item.children.forEach((c) => collectLeaves(c, into));
    }
  }

  const runProfile = controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      const run = controller.createTestRun(request);

      // Determine which items to run.
      const roots: vscode.TestItem[] = [];
      if (request.include) {
        roots.push(...request.include);
      } else {
        controller.items.forEach((i) => roots.push(i));
      }
      const leaves: vscode.TestItem[] = [];
      for (const r of roots) {
        collectLeaves(r, leaves);
      }
      const excluded = new Set(request.exclude ?? []);
      const toRun = leaves.filter((l) => !excluded.has(l));
      toRun.forEach((t) => run.enqueued(t));

      const { all: targets } = await xcodebuild.listTestTargets().catch(() => ({ all: [] as string[], unit: [], ui: [] }));
      const identifiers = [
        ...new Set(
          toRun
            .map((t) => identifierFor(t, targets))
            .filter((id): id is string => Boolean(id))
        ),
      ];

      toRun.forEach((t) => run.started(t));
      try {
        const result = await manager.test(
          { testIdentifiers: request.include ? identifiers : undefined },
          undefined,
          token
        );

        const failures = result.parsed.testFailures;
        for (const item of toRun) {
          const failure = failures.find(
            (f) =>
              (f.testCase && f.testCase.includes(item.label)) ||
              f.message.includes(item.label)
          );
          if (result.succeeded && !failure) {
            run.passed(item);
          } else if (failure) {
            const message = new vscode.TestMessage(failure.message);
            if (item.uri && failure.line) {
              message.location = new vscode.Location(
                item.uri,
                new vscode.Position(Math.max(0, failure.line - 1), 0)
              );
            }
            run.failed(item, message);
          } else if (!result.succeeded) {
            run.errored(item, new vscode.TestMessage(result.summary));
          }
        }
      } catch (err) {
        const message = new vscode.TestMessage(
          err instanceof Error ? err.message : "Test run failed to start"
        );
        toRun.forEach((t) => run.errored(t, message));
      } finally {
        run.end();
      }
    },
    true
  );
  context.subscriptions.push(runProfile);

  // Kick off initial discovery.
  void discoverAll();
}
