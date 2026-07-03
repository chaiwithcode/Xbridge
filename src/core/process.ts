//  Created by Deepak Sharma on 03/07/2026.
import { spawn, SpawnOptions } from "child_process";
import * as vscode from "vscode";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Called for each chunk of stdout as it arrives. */
  onStdout?: (chunk: string) => void;
  /** Called for each chunk of stderr as it arrives. */
  onStderr?: (chunk: string) => void;
  /** Abort signal to cancel the process. */
  token?: vscode.CancellationToken;
  /** Maximum buffered output length before older data is dropped (default 5MB). */
  maxBuffer?: number;
}

/**
 * A tracked, cancelable child process wrapper around a spawned command.
 */
export class Process {
  private constructor(
    public readonly promise: Promise<RunResult>,
    private readonly kill: (signal: NodeJS.Signals) => void
  ) {}

  static start(command: string, args: string[], options: RunOptions = {}): Process {
    const maxBuffer = options.maxBuffer ?? 5 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let killed = false;

    const spawnOpts: SpawnOptions = {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
    };

    const child = spawn(command, args, spawnOpts);

    const kill = (signal: NodeJS.Signals) => {
      killed = true;
      if (!child.killed) {
        try {
          child.kill(signal);
        } catch {
          /* ignore */
        }
      }
    };

    if (options.token) {
      options.token.onCancellationRequested(() => kill("SIGTERM"));
    }

    const promise = new Promise<RunResult>((resolve, reject) => {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (data: string) => {
        stdout += data;
        if (stdout.length > maxBuffer) {
          stdout = stdout.slice(stdout.length - maxBuffer);
        }
        options.onStdout?.(data);
      });

      child.stderr?.on("data", (data: string) => {
        stderr += data;
        if (stderr.length > maxBuffer) {
          stderr = stderr.slice(stderr.length - maxBuffer);
        }
        options.onStderr?.(data);
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        resolve({ code: killed ? code ?? 130 : code, stdout, stderr });
      });
    });

    return new Process(promise, kill);
  }

  /** `SIGINT` lets tools such as `simctl io recordVideo` finalize their output. */
  cancel(signal: NodeJS.Signals = "SIGTERM"): void {
    this.kill(signal);
  }
}

/**
 * Runs a command to completion and returns the aggregated result.
 * Rejects only on spawn failure, not on a non-zero exit code.
 */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return Process.start(command, args, options).promise;
}

/**
 * Runs a command and throws if it exits with a non-zero code.
 */
export async function runOrThrow(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `\`${command} ${args.join(" ")}\` exited with code ${result.code}${
        detail ? `:\n${detail}` : ""
      }`
    );
  }
  return result;
}
