//  Created by Deepak Sharma on 13/08/2026.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseXcodebuildOutput } from "../src/services/outputParser";

describe("parseXcodebuildOutput", () => {
  it("parses a successful clean action", () => {
    const result = parseXcodebuildOutput("** CLEAN SUCCEEDED **");

    assert.equal(result.succeeded, true);
    assert.deepEqual(result.errors, []);
  });

  it("parses compiler locations and removes duplicate diagnostics", () => {
    const line = "/tmp/MyApp/App.swift:12:5: error: cannot find 'value' in scope";
    const result = parseXcodebuildOutput(`${line}\n${line}\n** BUILD FAILED **`);

    assert.equal(result.succeeded, false);
    assert.equal(result.errors.length, 1);
    assert.deepEqual(result.errors[0], {
      type: "error",
      file: "/tmp/MyApp/App.swift",
      line: 12,
      column: 5,
      message: "cannot find 'value' in scope",
    });
  });

  it("surfaces assertion failures and the test summary", () => {
    const output = [
      "/tmp/LoginTests.swift:42: error: -[AppTests.LoginTests testLogin] : XCTAssertTrue failed",
      "Executed 1 test, with 1 failure (0 unexpected) in 0.1 seconds",
      "** TEST FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.testFailures.length, 1);
    assert.equal(result.testFailures[0].line, 42);
    assert.match(result.testSummary ?? "", /Executed 1 test, with 1 failure/);
  });
});
