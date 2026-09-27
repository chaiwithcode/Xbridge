//  Created by Deepak Sharma on 03/07/2026.

export interface BuildIssue {
  type: "error" | "warning";
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface TestFailure {
  file?: string;
  line?: number;
  testCase?: string;
  message: string;
}

export interface ParsedOutput {
  errors: BuildIssue[];
  warnings: BuildIssue[];
  testFailures: TestFailure[];
  succeeded: boolean;
  /** e.g. "Executed 42 tests, with 1 failure". */
  testSummary?: string;
  /** True when testing was cancelled because the test bundle failed to compile/link. */
  buildFailedBeforeTests?: boolean;
  /** True if code signing failed (requires Team / provisioning profile). */
  codeSigningFailed?: boolean;
  /** True if a required testability dylib was missing from DerivedData. */
  missingDebugDylib?: boolean;
  /** True if the scheme was not found in the container. */
  schemeNotFound?: boolean;
}

// /path/File.swift:12:5: error: message
const ISSUE_RE = /^(.*?):(\d+):(?:(\d+):)?\s+(error|warning):\s+(.*)$/;
// /path/File.swift:12: error: -[Tests testX] : failure message
const TEST_FAILURE_RE = /^(.*?):(\d+):\s+error:\s+(.*)$/;
const TEST_SUMMARY_RE = /(Executed \d+ tests?,? with \d+ failures?[^\n]*)/;
const BUILD_SUCCEEDED_RE = /\*\*\s*(BUILD|TEST|CLEAN)\s+SUCCEEDED\s*\*\*/;
const BUILD_FAILED_RE = /\*\*\s*(BUILD|TEST|CLEAN)\s+FAILED\s*\*\*/;

// Edge case regexes
const CANCELLED_BUILD_FAILED_RE = /Testing cancelled because the build failed/i;
const CODE_SIGN_RE = /Signing for [^]+? requires a development team|No profiles? for [^]+? (?:were|was) found|Code signing is required/i;
const MISSING_DEBUG_DYLIB_RE = /Build input file cannot be found: '[^']*?\.debug\.dylib'/i;
const SCHEME_NOT_FOUND_RE = /does not contain a scheme named/i;

// ── Swift Testing output patterns ──────────────────────────────────
// ✘ Test myTest() recorded an issue at MyTests.swift:15:5: message
const ST_FAIL_RE =
  /^[✘✗] Test (.+?) recorded an issue at (.+?):(\d+):\d+: (.+)$/;
// Test run with 5 tests passed/failed after 0.234 seconds
const ST_RUN_SUMMARY_RE =
  /(Test run with \d+ tests? (?:passed|failed) after [\d.]+ seconds(?: with \d+ issues?)?)/;

/** Parses raw xcodebuild output into structured issues and test results. */
export function parseXcodebuildOutput(output: string): ParsedOutput {
  const errors: BuildIssue[] = [];
  const warnings: BuildIssue[] = [];
  const testFailures: TestFailure[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const issueMatch = ISSUE_RE.exec(line);
    if (issueMatch) {
      const [, file, lineNo, colNo, type, message] = issueMatch;
      const key = `${type}:${file}:${lineNo}:${message}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const issue: BuildIssue = {
        type: type as "error" | "warning",
        file: file.trim() || undefined,
        line: lineNo ? parseInt(lineNo, 10) : undefined,
        column: colNo ? parseInt(colNo, 10) : undefined,
        message: message.trim(),
      };
      if (issue.type === "error") {
        errors.push(issue);
        // A test assertion failure is also emitted as an error line in XCTest.
        if (
          (/-\[.+\s.+\]|XCTAssert/i.test(message) ||
            (/failed/i.test(message) && !/build failed|cancelled|compilation/i.test(message))) &&
          !/type .+ does not conform|protocol requires|cannot find|build input file/i.test(message)
        ) {
          testFailures.push({
            file: issue.file,
            line: issue.line,
            message: issue.message,
          });
        }
      } else {
        warnings.push(issue);
      }
      continue;
    }

    const testMatch = TEST_FAILURE_RE.exec(line);
    if (testMatch && !ISSUE_RE.test(line)) {
      const [, file, lineNo, message] = testMatch;
      if (!/Testing cancelled|build failed/i.test(message)) {
        testFailures.push({
          file: file.trim() || undefined,
          line: lineNo ? parseInt(lineNo, 10) : undefined,
          message: message.trim(),
        });
      }
    }

    // ── Swift Testing failure with source location ──
    const stFailMatch = ST_FAIL_RE.exec(line);
    if (stFailMatch) {
      const [, testCase, file, lineNo, message] = stFailMatch;
      const key = `st:${file}:${lineNo}:${testCase}`;
      if (!seen.has(key)) {
        seen.add(key);
        testFailures.push({
          file: file.trim() || undefined,
          line: lineNo ? parseInt(lineNo, 10) : undefined,
          testCase: testCase.replace(/\(\)$/, "").trim(),
          message: message.trim(),
        });
      }
    }
  }

  // Accept both XCTest and Swift Testing summary lines.
  const summaryMatch =
    TEST_SUMMARY_RE.exec(output) ?? ST_RUN_SUMMARY_RE.exec(output);
  const succeeded = BUILD_SUCCEEDED_RE.test(output) && !BUILD_FAILED_RE.test(output);

  return {
    errors,
    warnings,
    testFailures,
    succeeded,
    testSummary: summaryMatch?.[1],
    buildFailedBeforeTests: CANCELLED_BUILD_FAILED_RE.test(output),
    codeSigningFailed: CODE_SIGN_RE.test(output),
    missingDebugDylib: MISSING_DEBUG_DYLIB_RE.test(output),
    schemeNotFound: SCHEME_NOT_FOUND_RE.test(output),
  };
}
