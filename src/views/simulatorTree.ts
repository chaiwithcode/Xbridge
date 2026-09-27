//  Created by Deepak Sharma on 03/07/2026.
import * as vscode from "vscode";
import { DeviceKind, SimctlService, Simulator } from "../services/simctl";
import { DevicectlService, PhysicalDevice } from "../services/devicectl";

const KIND_ICONS: Record<DeviceKind, string> = {
  iphone: "device-mobile",
  ipad: "device-desktop",
  watch: "watch",
  tv: "device-desktop",
  vision: "vr",
  mac: "device-desktop",
  other: "device-mobile",
};

/** A physical device. Clicking it makes it the active run destination. */
export class DeviceItem extends vscode.TreeItem {
  constructor(public readonly device: PhysicalDevice, selected: boolean) {
    super(device.name, vscode.TreeItemCollapsibleState.None);

    const tags = [device.marketingName];
    if (device.osVersion) {
      tags.push(`iOS ${device.osVersion}`);
    }
    if (device.tunnelConnected) {
      tags.push("Connected");
    } else {
      tags.push(device.tunnelState === "disconnected" ? "Disconnected" : "Unavailable");
    }
    if (selected) {
      tags.push("Destination");
    }
    this.description = tags.join(" • ");

    const icon = selected ? "pass-filled" : "plug";
    const color = selected || device.tunnelConnected ? "charts.green" : "foreground";
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    this.contextValue = [
      "physicalDevice",
      device.tunnelConnected ? "connected" : "disconnected",
      selected ? "selected" : "unselected",
    ].join(".");

    this.tooltip = new vscode.MarkdownString(
      [
        `**${device.name}**`,
        "",
        `Model · ${device.marketingName}`,
        `OS · ${device.platform} ${device.osVersion}`,
        `Connection · ${device.transportType} (${device.tunnelState})`,
        `Developer Mode · ${device.developerModeEnabled ? "Enabled" : "Disabled"}`,
        `UDID · \`${device.udid}\``,
        "",
        selected
          ? "_This is the active run destination._"
          : "_Click to make this the active run destination._",
      ].join("\n")
    );

    this.command = {
      command: "xbridge.setDestination",
      title: "Set as Destination",
      arguments: [device.udid],
    };
  }
}

/** A single simulator. Clicking it makes it the active run destination. */
export class SimulatorItem extends vscode.TreeItem {
  constructor(
    public readonly simulator: Simulator,
    selected: boolean,
    recording: boolean
  ) {
    super(simulator.name, vscode.TreeItemCollapsibleState.None);
    const booted = simulator.state === "Booted";

    const tags = [simulator.runtime];
    if (booted) {
      tags.push("Booted");
    }
    if (recording) {
      tags.push("Recording");
    }
    if (selected) {
      tags.push("Destination");
    }
    this.description = tags.join(" • ");

    const icon = recording ? "record" : selected ? "pass-filled" : KIND_ICONS[simulator.kind];
    const color = recording ? "charts.red" : booted || selected ? "charts.green" : "foreground";
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));

    // Drives which inline/context actions are offered for this row.
    this.contextValue = [
      "simulator",
      booted ? "booted" : "shutdown",
      selected ? "selected" : "unselected",
      recording ? "recording" : "idle",
    ].join(".");

    this.tooltip = new vscode.MarkdownString(
      [
        `**${simulator.name}**`,
        "",
        `Runtime · ${simulator.runtime}`,
        `State · ${simulator.state}`,
        `UDID · \`${simulator.udid}\``,
        "",
        selected
          ? "_This is the active run destination._"
          : "_Click to make this the active run destination._",
      ].join("\n")
    );

    this.command = {
      command: "xbridge.setDestination",
      title: "Set as Destination",
      arguments: [simulator.udid],
    };
  }
}

/** A collapsible group of simulators (either "Booted" or a runtime). */
class GroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly key: string,
    count: number,
    expanded: boolean,
    icon: string
  ) {
    super(
      label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "runtimeGroup";
    this.id = `group:${key}`;
  }
}

type Node = GroupItem | SimulatorItem | DeviceItem | vscode.TreeItem;

export class SimulatorTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private simulators: Simulator[] = [];
  private devices: PhysicalDevice[] = [];
  /** UDIDs with an in-flight screen recording. */
  private readonly recording = new Set<string>();

  constructor(
    private readonly simctl: SimctlService,
    private readonly getSelectedUdid: () => string | undefined,
    private readonly devicectl?: DevicectlService
  ) {}

  refresh(): void {
    this.simctl.invalidate();
    this.devicectl?.invalidate();
    this._onDidChangeTreeData.fire();
  }

  /** Re-renders without re-querying simctl/devicectl (e.g. the destination changed). */
  rerender(): void {
    this._onDidChangeTreeData.fire();
  }

  setRecording(udid: string, active: boolean): void {
    if (active) {
      this.recording.add(udid);
    } else {
      this.recording.delete(udid);
    }
    this.rerender();
  }

  isRecording(udid: string): boolean {
    return this.recording.has(udid);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const [devices, sims] = await Promise.all([
        this.devicectl?.listDevices().catch(() => []) ?? [],
        this.simctl.list(true).catch(() => []),
      ]);
      this.devices = devices;
      this.simulators = sims;

      if (this.simulators.length === 0 && this.devices.length === 0) {
        const empty = new vscode.TreeItem("No destinations available");
        empty.iconPath = new vscode.ThemeIcon("warning");
        empty.description = "Connect an iOS device or install a simulator runtime";
        return [empty];
      }

      const nodes: Node[] = [];
      const selected = this.getSelectedUdid();

      if (this.devices.length > 0) {
        const holdsSelection = this.devices.some(
          (d) => d.udid === selected || d.coreDeviceIdentifier === selected
        );
        nodes.push(
          new GroupItem("Connected Devices", "devices", this.devices.length, holdsSelection || true, "plug")
        );
      }

      const booted = this.simulators.filter((s) => s.state === "Booted");
      if (booted.length > 0) {
        nodes.push(new GroupItem("Booted", "booted", booted.length, true, "vm-running"));
      }

      const runtimes = [...new Set(this.simulators.map((s) => s.runtime))];
      for (const runtime of runtimes) {
        const group = this.simulators.filter((s) => s.runtime === runtime && s.state !== "Booted");
        if (group.length === 0) {
          continue;
        }
        // Keep the runtime holding the active destination open for context.
        const holdsSelection = group.some((s) => s.udid === selected);
        nodes.push(new GroupItem(runtime, runtime, group.length, holdsSelection, "layers"));
      }
      return nodes;
    }

    if (element instanceof GroupItem) {
      const selected = this.getSelectedUdid();
      if (element.key === "devices") {
        return this.devices.map(
          (d) => new DeviceItem(d, d.udid === selected || d.coreDeviceIdentifier === selected)
        );
      }
      const group =
        element.key === "booted"
          ? this.simulators.filter((s) => s.state === "Booted")
          : this.simulators.filter((s) => s.runtime === element.key && s.state !== "Booted");
      return group.map(
        (s) => new SimulatorItem(s, s.udid === selected, this.recording.has(s.udid))
      );
    }

    return [];
  }
}
