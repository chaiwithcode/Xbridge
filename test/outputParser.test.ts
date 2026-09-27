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

  it("parses swift-testing failure with source location", () => {
    const output = [
      "◇ Test validateLogin() started.",
      "✘ Test validateLogin() recorded an issue at /tmp/LoginTests.swift:15:5: Expectation failed: (result → false) == true",
      "✘ Test validateLogin() failed after 0.002 seconds with 1 issue.",
      "Test run with 1 test failed after 0.002 seconds with 1 issue.",
      "** TEST FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.testFailures.length, 1);
    assert.equal(result.testFailures[0].file, "/tmp/LoginTests.swift");
    assert.equal(result.testFailures[0].line, 15);
    assert.equal(result.testFailures[0].testCase, "validateLogin");
    assert.match(result.testFailures[0].message, /Expectation failed/);
  });

  it("captures swift-testing summary when XCTest summary is absent", () => {
    const output = [
      "✔ Test fast() passed after 0.001 seconds.",
      "Test run with 3 tests passed after 0.123 seconds.",
      "** TEST SUCCEEDED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, true);
    assert.match(result.testSummary ?? "", /Test run with 3 tests passed/);
  });

  it("handles mixed XCTest + swift-testing output", () => {
    const output = [
      "Test Case '-[OldTests testLegacy]' passed (0.001 seconds).",
      "Executed 1 test, with 0 failures (0 unexpected) in 0.001 seconds",
      "◇ Test newTest() started.",
      "✘ Test newTest() recorded an issue at /tmp/New.swift:10:3: failed",
      "Test run with 1 test failed after 0.01 seconds with 1 issue.",
      "** TEST FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.testFailures.length, 1);
    assert.equal(result.testFailures[0].file, "/tmp/New.swift");
    // XCTest summary should be preferred when present
    assert.match(result.testSummary ?? "", /Executed 1 test/);
  });

  it("detects build failures that cancel testing before tests run", () => {
    const output = [
      "/tmp/MyApp/VoiceTests.swift:379:13: error: type 'TestTVProvider' does not conform to protocol 'TVProvider'",
      "Testing failed:",
      "\tType 'TestTVProvider' does not conform to protocol 'TVProvider'",
      "\tTesting cancelled because the build failed.",
      "** TEST FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.errors.length, 1);
    assert.equal(result.buildFailedBeforeTests, true);
    // Should NOT have misclassified the compiler error as a test failure
    assert.equal(result.testFailures.length, 0);
  });

  it("detects missing testability debug dylib", () => {
    const output = [
      "error: Build input file cannot be found: '/DerivedData/Build/Products/Debug-iphonesimulator/MyApp.app/MyApp.debug.dylib'",
      "** TEST FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.missingDebugDylib, true);
  });

  it("detects code signing errors for physical devices", () => {
    const output = [
      "error: Signing for \"MyApp\" requires a development team. Select a development team in the Signing & Capabilities editor.",
      "** BUILD FAILED **",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.succeeded, false);
    assert.equal(result.codeSigningFailed, true);
  });

  it("detects missing scheme errors", () => {
    const output = [
      "xcodebuild: error: The project named \"MyApp\" does not contain a scheme named \"BadScheme\".",
    ].join("\n");
    const result = parseXcodebuildOutput(output);

    assert.equal(result.schemeNotFound, true);
  });
});
