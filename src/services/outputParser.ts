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
}

// /path/File.swift:12:5: error: message
const ISSUE_RE = /^(.*?):(\d+):(?:(\d+):)?\s+(error|warning):\s+(.*)$/;
// /path/File.swift:12: error: -[Tests testX] : failure message
const TEST_FAILURE_RE = /^(.*?):(\d+):\s+error:\s+(.*)$/;
const TEST_SUMMARY_RE = /(Executed \d+ tests?,? with \d+ failures?[^\n]*)/;
const BUILD_SUCCEEDED_RE = /\*\*\s*(BUILD|TEST|CLEAN)\s+SUCCEEDED\s*\*\*/;
const BUILD_FAILED_RE = /\*\*\s*(BUILD|TEST|CLEAN)\s+FAILED\s*\*\*/;

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
        // A test assertion failure is also emitted as an error line.
        if (/-\[.+\s.+\]|XCTAssert|failed/i.test(message)) {
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
      testFailures.push({
        file: file.trim() || undefined,
        line: lineNo ? parseInt(lineNo, 10) : undefined,
        message: message.trim(),
      });
    }
  }

  const summaryMatch = TEST_SUMMARY_RE.exec(output);
  const succeeded = BUILD_SUCCEEDED_RE.test(output) && !BUILD_FAILED_RE.test(output);

  return {
    errors,
    warnings,
    testFailures,
    succeeded,
    testSummary: summaryMatch?.[1],
  };
}
