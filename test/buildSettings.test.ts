//  Created by Deepak Sharma on 13/08/2026.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BuildSettingsEntry,
  selectRunnableBuildSettings,
} from "../src/services/buildSettings";

function entry(
  target: string,
  settings: Record<string, string>
): BuildSettingsEntry {
  return { target, buildSettings: { TARGET_NAME: target, ...settings } };
}

describe("selectRunnableBuildSettings", () => {
  it("selects an application instead of the final framework target", () => {
    const application = entry("MyApp", {
      PRODUCT_TYPE: "com.apple.product-type.application",
      FULL_PRODUCT_NAME: "MyApp.app",
      PRODUCT_BUNDLE_IDENTIFIER: "com.example.MyApp",
    });
    const framework = entry("Networking", {
      PRODUCT_TYPE: "com.apple.product-type.framework",
      FULL_PRODUCT_NAME: "Networking.framework",
      PRODUCT_BUNDLE_IDENTIFIER: "com.example.Networking",
    });

    assert.equal(
      selectRunnableBuildSettings([application, framework], "MyApp"),
      application
    );
  });

  it("prefers the scheme target when multiple app products are present", () => {
    const companion = entry("Companion", {
      PRODUCT_TYPE: "com.apple.product-type.application",
      FULL_PRODUCT_NAME: "Companion.app",
    });
    const main = entry("MyApp", {
      PRODUCT_TYPE: "com.apple.product-type.application",
      FULL_PRODUCT_NAME: "MyApp.app",
    });

    assert.equal(
      selectRunnableBuildSettings([companion, main], "MyApp"),
      main
    );
  });

  it("uses executable app metadata when PRODUCT_TYPE is missing", () => {
    const library = entry("Library", {
      PRODUCT_TYPE: "com.apple.product-type.library.static",
      FULL_PRODUCT_NAME: "libLibrary.a",
    });
    const application = entry("LegacyApp", {
      WRAPPER_EXTENSION: "app",
      MACH_O_TYPE: "mh_execute",
      FULL_PRODUCT_NAME: "LegacyApp.app",
    });

    assert.equal(
      selectRunnableBuildSettings([library, application], "LegacyApp"),
      application
    );
  });

  it("returns undefined when Xcode returns no entries", () => {
    assert.equal(selectRunnableBuildSettings([], "MyApp"), undefined);
  });

  it("rejects schemes that contain no runnable application product", () => {
    const framework = entry("Networking", {
      PRODUCT_TYPE: "com.apple.product-type.framework",
      FULL_PRODUCT_NAME: "Networking.framework",
    });

    assert.equal(
      selectRunnableBuildSettings([framework], "Networking"),
      undefined
    );
  });
});
