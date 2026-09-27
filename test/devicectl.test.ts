//  Created by Deepak Sharma on 27/09/2026.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDevicectlOutput } from "../src/services/devicectlParser";

describe("parseDevicectlOutput", () => {
  it("filters physical devices and ignores simulated ones", () => {
    const json = JSON.stringify({
      info: { outcome: "success" },
      result: {
        devices: [
          {
            identifier: "UUID-1",
            deviceProperties: {
              name: "Deepak’s iPhone",
              osVersionNumber: "18.0",
              developerModeStatus: "enabled",
            },
            hardwareProperties: {
              marketingName: "iPhone 16 Pro",
              platform: "iOS",
              reality: "physical",
              udid: "00008120-001234567890",
              deviceType: "iPhone",
            },
            connectionProperties: {
              tunnelState: "connected",
              transportType: "wired",
              pairingState: "paired",
            },
          },
          {
            identifier: "SIM-1",
            deviceProperties: {
              name: "iPhone 16 Simulator",
              osVersionNumber: "18.0",
            },
            hardwareProperties: {
              marketingName: "iPhone 16",
              platform: "iOS",
              reality: "simulated",
              udid: "SIM-UDID-1",
            },
          },
        ],
      },
    });

    const devices = parseDevicectlOutput(json);
    assert.equal(devices.length, 1);
    assert.equal(devices[0].name, "Deepak’s iPhone");
    assert.equal(devices[0].marketingName, "iPhone 16 Pro");
    assert.equal(devices[0].osVersion, "18.0");
    assert.equal(devices[0].tunnelConnected, true);
    assert.equal(devices[0].developerModeEnabled, true);
    assert.equal(devices[0].udid, "00008120-001234567890");
    assert.equal(devices[0].coreDeviceIdentifier, "UUID-1");
  });

  it("sorts connected devices before disconnected ones", () => {
    const json = JSON.stringify({
      result: {
        devices: [
          {
            identifier: "D1",
            deviceProperties: { name: "B Device" },
            hardwareProperties: { reality: "physical", marketingName: "iPhone 14" },
            connectionProperties: { tunnelState: "disconnected" },
          },
          {
            identifier: "D2",
            deviceProperties: { name: "A Device" },
            hardwareProperties: { reality: "physical", marketingName: "iPhone 15" },
            connectionProperties: { tunnelState: "connected" },
          },
        ],
      },
    });

    const devices = parseDevicectlOutput(json);
    assert.equal(devices.length, 2);
    assert.equal(devices[0].name, "A Device");
    assert.equal(devices[0].tunnelConnected, true);
    assert.equal(devices[1].name, "B Device");
    assert.equal(devices[1].tunnelConnected, false);
  });

  it("handles malformed JSON gracefully", () => {
    const devices = parseDevicectlOutput("invalid json string");
    assert.deepEqual(devices, []);
  });

  it("handles empty devices array", () => {
    const devices = parseDevicectlOutput(JSON.stringify({ result: { devices: [] } }));
    assert.deepEqual(devices, []);
  });
});
