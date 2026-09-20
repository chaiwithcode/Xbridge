//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";

/** Centralized, lazily-created output channels used across XBridge. */
class LogService {
  private buildChannel: vscode.OutputChannel | undefined;
  private appChannel: vscode.OutputChannel | undefined;
  private diagnosticChannel: vscode.LogOutputChannel | undefined;

  get build(): vscode.OutputChannel {
    if (!this.buildChannel) {
      this.buildChannel = vscode.window.createOutputChannel("XBridge Build");
    }
    return this.buildChannel;
  }

  get app(): vscode.OutputChannel {
    if (!this.appChannel) {
      this.appChannel = vscode.window.createOutputChannel("XBridge App");
    }
    return this.appChannel;
  }

  get diagnostic(): vscode.LogOutputChannel {
    if (!this.diagnosticChannel) {
      this.diagnosticChannel = vscode.window.createOutputChannel("XBridge", { log: true });
    }
    return this.diagnosticChannel;
  }

  info(message: string): void {
    this.diagnostic.info(message);
  }

  warn(message: string): void {
    this.diagnostic.warn(message);
  }

  error(message: string, err?: unknown): void {
    this.diagnostic.error(err ? `${message}: ${String(err)}` : message);
  }

  dispose(): void {
    this.buildChannel?.dispose();
    this.appChannel?.dispose();
    this.diagnosticChannel?.dispose();
  }
}

export const log = new LogService();
