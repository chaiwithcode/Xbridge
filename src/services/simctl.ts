//  Created by Deepak Sharma on 03/07/2026.
import { run, runOrThrow, Process } from "../core/process";
import { log } from "../core/log";

/** Broad device family, used to pick an icon and group simulators. */
export type DeviceKind = "iphone" | "ipad" | "watch" | "tv" | "vision" | "mac" | "other";

export interface Simulator {
  udid: string;
  name: string;
  state: "Booted" | "Shutdown" | "Creating" | "Booting" | "ShuttingDown" | string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
  kind: DeviceKind;
  /** Human-readable runtime, e.g. "iOS 18.0". */
  runtime: string;
  /** Runtime identifier, e.g. "com.apple.CoreSimulator.SimRuntime.iOS-18-0". */
  runtimeIdentifier: string;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
  availabilityError?: string;
}

interface SimctlListOutput {
  devices: Record<string, SimctlDevice[]>;
}

function humanizeRuntime(runtimeIdentifier: string): string {
  // com.apple.CoreSimulator.SimRuntime.iOS-18-0 -> iOS 18.0
  const suffix = runtimeIdentifier.split(".SimRuntime.").pop() ?? runtimeIdentifier;
  const match = suffix.match(/^([A-Za-z]+)-(.+)$/);
  if (!match) {
    return suffix;
  }
  const [, os, version] = match;
  return `${os} ${version.replace(/-/g, ".")}`;
}

function deviceKind(deviceTypeIdentifier: string | undefined, name: string): DeviceKind {
  const id = `${deviceTypeIdentifier ?? ""} ${name}`;
  if (/ipad/i.test(id)) {
    return "ipad";
  }
  if (/iphone|ipod/i.test(id)) {
    return "iphone";
  }
  if (/watch/i.test(id)) {
    return "watch";
  }
  if (/apple-?tv/i.test(id)) {
    return "tv";
  }
  if (/vision|reality/i.test(id)) {
    return "vision";
  }
  if (/mac/i.test(id)) {
    return "mac";
  }
  return "other";
}

/** How long a `simctl list` result stays fresh before it is fetched again. */
const CACHE_TTL_MS = 4000;

/** Wraps `xcrun simctl` for simulator lifecycle and device management. */
export class SimctlService {
  private cache?: { at: number; sims: Simulator[] };

  /** Drops the cached device list so the next read hits `simctl` again. */
  invalidate(): void {
    this.cache = undefined;
  }

  async list(availableOnly = true): Promise<Simulator[]> {
    const fresh = this.cache && Date.now() - this.cache.at < CACHE_TTL_MS ? this.cache.sims : undefined;
    const all = fresh ?? (await this.fetch());
    return availableOnly ? all.filter((s) => s.isAvailable) : all;
  }

  private async fetch(): Promise<Simulator[]> {
    const result = await runOrThrow("xcrun", ["simctl", "list", "devices", "--json"]);
    let parsed: SimctlListOutput;
    try {
      parsed = JSON.parse(result.stdout) as SimctlListOutput;
    } catch (err) {
      log.error("Failed to parse simctl output", err);
      return [];
    }

    const sims: Simulator[] = [];
    for (const [runtimeIdentifier, devices] of Object.entries(parsed.devices)) {
      const runtime = humanizeRuntime(runtimeIdentifier);
      for (const device of devices) {
        sims.push({
          udid: device.udid,
          name: device.name,
          state: device.state,
          isAvailable: device.isAvailable,
          deviceTypeIdentifier: device.deviceTypeIdentifier,
          kind: deviceKind(device.deviceTypeIdentifier, device.name),
          runtime,
          runtimeIdentifier,
        });
      }
    }

    // Sort: booted first, then by runtime desc, then name.
    sims.sort((a, b) => {
      if (a.state === "Booted" && b.state !== "Booted") {
        return -1;
      }
      if (b.state === "Booted" && a.state !== "Booted") {
        return 1;
      }
      if (a.runtime !== b.runtime) {
        return b.runtime.localeCompare(a.runtime);
      }
      return a.name.localeCompare(b.name);
    });

    this.cache = { at: Date.now(), sims };
    return sims;
  }

  async find(udid: string): Promise<Simulator | undefined> {
    const all = await this.list(false);
    return all.find((s) => s.udid === udid);
  }

  async boot(udid: string): Promise<void> {
    const sim = await this.find(udid);
    if (sim?.state === "Booted") {
      return;
    }
    const result = await run("xcrun", ["simctl", "boot", udid]);
    // simctl returns an error if already booted; treat that as success.
    if (result.code !== 0 && !/current state: Booted/i.test(result.stderr)) {
      throw new Error(`Failed to boot simulator ${udid}: ${result.stderr.trim()}`);
    }
    await runOrThrow("xcrun", ["simctl", "bootstatus", udid]);
    this.invalidate();
  }

  async shutdown(udid: string): Promise<void> {
    const result = await run("xcrun", ["simctl", "shutdown", udid]);
    if (result.code !== 0 && !/current state: Shutdown/i.test(result.stderr)) {
      throw new Error(`Failed to shutdown simulator ${udid}: ${result.stderr.trim()}`);
    }
    this.invalidate();
  }

  async erase(udid: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "erase", udid]);
    this.invalidate();
  }

  async install(udid: string, appPath: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "install", udid, appPath]);
  }

  async uninstall(udid: string, bundleId: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "uninstall", udid, bundleId]);
  }

  async launch(udid: string, bundleId: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "launch", udid, bundleId]);
  }

  /**
   * Launches the app with a pseudo-terminal attached so its stdout/stderr can
   * be streamed live. The returned process stays alive until the app exits.
   */
  launchWithConsole(udid: string, bundleId: string, onLog: (chunk: string) => void): Process {
    return Process.start(
      "xcrun",
      ["simctl", "launch", "--console-pty", "--terminate-running-process", udid, bundleId],
      { onStdout: onLog, onStderr: onLog }
    );
  }

  async terminate(udid: string, bundleId: string): Promise<void> {
    // Ignore failure if the app is not running.
    await run("xcrun", ["simctl", "terminate", udid, bundleId]);
  }

  /** Opens a URL or custom-scheme deep link inside the simulator. */
  async openUrl(udid: string, url: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "openurl", udid, url]);
  }

  /** Captures a PNG screenshot of the device screen to `filePath`. */
  async screenshot(udid: string, filePath: string): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "io", udid, "screenshot", filePath]);
  }

  /** Starts a screen recording. Cancel the process with SIGINT to finalize it. */
  startRecording(udid: string, filePath: string): Process {
    return Process.start("xcrun", ["simctl", "io", udid, "recordVideo", "--codec=h264", filePath]);
  }

  async setAppearance(udid: string, appearance: "light" | "dark"): Promise<void> {
    await runOrThrow("xcrun", ["simctl", "ui", udid, "appearance", appearance]);
  }

  async getAppearance(udid: string): Promise<"light" | "dark"> {
    const result = await run("xcrun", ["simctl", "ui", udid, "appearance"]);
    return /dark/i.test(result.stdout) ? "dark" : "light";
  }

  /** Absolute path of the app's sandbox container on disk. */
  async appContainer(udid: string, bundleId: string, kind = "data"): Promise<string> {
    const result = await runOrThrow("xcrun", ["simctl", "get_app_container", udid, bundleId, kind]);
    return result.stdout.trim();
  }

  /** Opens the Simulator.app GUI. */
  async openApp(): Promise<void> {
    await run("open", ["-a", "Simulator"]);
  }
}
