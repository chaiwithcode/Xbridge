//  Created by Deepak Sharma on 27/09/2026.

export interface PhysicalDevice {
  udid: string;
  coreDeviceIdentifier: string;
  name: string;
  marketingName: string;
  platform: string;
  osVersion: string;
  transportType: string;
  tunnelState: "connected" | "disconnected" | "unavailable" | string;
  tunnelConnected: boolean;
  developerModeEnabled: boolean;
  deviceType: string;
  paired: boolean;
}

interface DevicectlDevice {
  identifier: string;
  connectionProperties?: {
    transportType?: string;
    tunnelState?: string;
    pairingState?: string;
  };
  deviceProperties?: {
    name?: string;
    osVersionNumber?: string;
    developerModeStatus?: string;
    bootState?: string;
  };
  hardwareProperties?: {
    marketingName?: string;
    platform?: string;
    deviceType?: string;
    reality?: string;
    udid?: string;
  };
}

interface DevicectlOutput {
  result?: {
    devices?: DevicectlDevice[];
  };
}

/** Pure parser for `xcrun devicectl list devices -j -` JSON output. */
export function parseDevicectlOutput(stdout: string): PhysicalDevice[] {
  try {
    const parsed = JSON.parse(stdout) as DevicectlOutput;
    const rawDevices = parsed.result?.devices ?? [];

    const devices: PhysicalDevice[] = rawDevices
      .filter((d) => d.hardwareProperties?.reality === "physical")
      .map((d) => {
        const hw = d.hardwareProperties;
        const dev = d.deviceProperties;
        const conn = d.connectionProperties;
        const tunnelState = conn?.tunnelState ?? "unavailable";
        const udid = hw?.udid ?? d.identifier;
        return {
          udid,
          coreDeviceIdentifier: d.identifier,
          name: dev?.name ?? hw?.marketingName ?? "iOS Device",
          marketingName: hw?.marketingName ?? "iPhone",
          platform: hw?.platform ?? "iOS",
          osVersion: dev?.osVersionNumber ?? "",
          transportType: conn?.transportType ?? "wired",
          tunnelState,
          tunnelConnected: tunnelState === "connected",
          developerModeEnabled: dev?.developerModeStatus === "enabled",
          deviceType: hw?.deviceType ?? "iPhone",
          paired: conn?.pairingState === "paired",
        };
      });

    // Sort: connected first, then by name
    devices.sort((a, b) => {
      if (a.tunnelConnected && !b.tunnelConnected) {
        return -1;
      }
      if (!a.tunnelConnected && b.tunnelConnected) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return devices;
  } catch {
    return [];
  }
}
