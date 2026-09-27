//  Created by Deepak Sharma on 27/09/2026.
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { run, runOrThrow, Process } from "../core/process";
import { log } from "../core/log";
import { PhysicalDevice, parseDevicectlOutput } from "./devicectlParser";

export { PhysicalDevice, parseDevicectlOutput };

/** How long a device list result stays fresh before it is fetched again. */
const CACHE_TTL_MS = 5000;

/** Wraps `xcrun devicectl` for physical device lifecycle and operations. */
export class DevicectlService {
  private cache?: { at: number; devices: PhysicalDevice[] };
  private availabilityPromise?: Promise<boolean>;

  /** Drops the cached device list so the next read re-queries devicectl. */
  invalidate(): void {
    this.cache = undefined;
  }

  /** Returns true if `devicectl` is available on this system (Xcode 15+). */
  async isAvailable(): Promise<boolean> {
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }
    this.availabilityPromise = (async () => {
      try {
        const result = await run("xcrun", ["devicectl", "--help"]);
        return result.code === 0;
      } catch {
        return false;
      }
    })();
    return this.availabilityPromise;
  }

  async listDevices(): Promise<PhysicalDevice[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.devices;
    }
    const devices = await this.fetch();
    this.cache = { at: Date.now(), devices };
    return devices;
  }

  async find(udid: string): Promise<PhysicalDevice | undefined> {
    const devices = await this.listDevices();
    return devices.find((d) => d.udid === udid || d.coreDeviceIdentifier === udid);
  }

  private async fetch(): Promise<PhysicalDevice[]> {
    const available = await this.isAvailable();
    if (!available) {
      return [];
    }

    let stdout = "";
    // Try directly reading JSON from stdout
    const directResult = await run("xcrun", ["devicectl", "list", "devices", "-j", "-"]);
    if (directResult.code === 0 && directResult.stdout.trim().startsWith("{")) {
      stdout = directResult.stdout;
    } else {
      // Fallback to temporary file output
      const jsonFile = path.join(os.tmpdir(), `xbridge-devices-${Date.now()}.json`);
      const fileResult = await run("xcrun", [
        "devicectl",
        "list",
        "devices",
        "--json-output",
        jsonFile,
      ]);
      if (fileResult.code === 0) {
        try {
          stdout = await fs.readFile(jsonFile, "utf8");
          await fs.unlink(jsonFile).catch(() => {});
        } catch (err) {
          log.error("Failed to read devicectl temp json", err);
          stdout = "";
        }
      }
    }

    if (!stdout) {
      return [];
    }
    return parseDevicectlOutput(stdout);
  }

  async installApp(deviceId: string, appPath: string): Promise<void> {
    await runOrThrow("xcrun", [
      "devicectl",
      "device",
      "install",
      "app",
      "--device",
      deviceId,
      appPath,
    ]);
  }

  async launchApp(deviceId: string, bundleId: string): Promise<void> {
    await runOrThrow("xcrun", [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      deviceId,
      "--terminate-existing",
      bundleId,
    ]);
  }

  launchWithConsole(
    deviceId: string,
    bundleId: string,
    onLog: (chunk: string) => void
  ): Process {
    return Process.start(
      "xcrun",
      [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        deviceId,
        "--terminate-existing",
        "--console",
        bundleId,
      ],
      { onStdout: onLog, onStderr: onLog }
    );
  }
}
