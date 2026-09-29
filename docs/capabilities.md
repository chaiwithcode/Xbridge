# XBridge capabilities

XBridge puts the everyday Xcode workflow in VS Code. These are the commands and tools available in version 1.4.2. Open the Command Palette and type `XBridge:` to find a command; the most common actions also appear in the XBridge sidebar and status bar.

## Project and workflow

| Command | What it does |
|:---|:---|
| `XBridge: Select Xcode Project or Workspace` | Choose an `.xcodeproj`, `.xcworkspace`, or Swift package when more than one is available. |
| `XBridge: Select Scheme` | Choose the Xcode scheme. |
| `XBridge: Select Build Configuration` | Switch between configurations such as Debug and Release. |
| `XBridge: Select Scheme, Configuration or Destination` | Open one picker for the active build target. |
| `XBridge: Refresh Schemes` | Reload schemes and targets from Xcode. |
| `XBridge: Open in Xcode` | Open the active project or workspace in Xcode. |
| `XBridge: Getting Started` | Open the guided VS Code walkthrough. |

## Build, run, test, and packages

| Command | What it does |
|:---|:---|
| `XBridge: Build` | Compile the active scheme. |
| `XBridge: Build & Run` | Build, install, and launch the app on the selected destination. |
| `XBridge: Stop` | Cancel the active operation or stop the running app. |
| `XBridge: Stop Running App` | Terminate the launched app without shutting down the simulator. |
| `XBridge: Clean Build Folder` | Remove the active project's DerivedData build products. |
| `XBridge: Run Tests` | Run the selected test plan or target with `xcodebuild`. |
| `XBridge: Select Test Plan` | Choose an Xcode test plan, if the scheme has one. |
| `XBridge: Select Test Target` | Limit a run to one test target. |
| `XBridge: Resolve Package Dependencies` | Resolve Swift Package Manager dependencies through Xcode. |

The native VS Code Test Explorer discovers XCTest methods and Swift Testing `@Test` methods, shows per-test results, and lets you run individual tests. Build errors and test failures appear in Problems and at their source locations.

## Results and logs

| Command | What it does |
|:---|:---|
| `XBridge: Show Build Output` | Open the `XBridge Build` output channel. |
| `XBridge: Show Build Issues` | Browse errors and warnings and jump to the source line. |
| `XBridge: Show App Console` | Open the launched app's console output. |

The status bar also shows the selected scheme and destination, build activity, and error and warning counts.

## Simulators and devices

| Command | What it does |
|:---|:---|
| `XBridge: Select Destination (Simulator/Device)` | Choose a simulator or connected physical device. |
| `XBridge: Set as Destination` | Use the selected device from the Destinations tree. |
| `XBridge: Boot Simulator` | Start a simulator. |
| `XBridge: Shutdown Simulator` | Shut down a simulator. |
| `XBridge: Open Simulator.app` | Bring Apple's Simulator app forward. |
| `XBridge: Refresh Simulators` | Reload the local simulator list. |
| `XBridge: Refresh Devices & Simulators` | Reload simulator and connected-device discovery. |
| `XBridge: Erase Simulator Content` | Reset a simulator's content and settings. |
| `XBridge: Copy Simulator UDID` | Copy the simulator identifier. |
| `XBridge: Open URL or Deep Link…` | Open a URL in a simulator. |
| `XBridge: Take Screenshot` | Save a PNG from a booted simulator. |
| `XBridge: Start / Stop Screen Recording` | Save a simulator recording as video. |
| `XBridge: Toggle Light / Dark Appearance` | Change the simulator appearance. |
| `XBridge: Open App Data Container` | Open the installed app's container in Finder. |
| `XBridge: Uninstall App from Simulator` | Remove the installed app. |

Connected iPhones and iPads appear in Destinations through Apple's `devicectl`. Physical-device builds require working code signing and Developer Mode.

## AI agent tools

Compatible VS Code AI agents can call these eight tools directly:

| Tool | Capability |
|:---|:---|
| `xbridge_build` | Build and return compiler diagnostics. |
| `xbridge_test` | Run tests and return failures. |
| `xbridge_run` | Build and launch an app. |
| `xbridge_listSchemes` | List schemes, configurations, and targets. |
| `xbridge_listSimulators` | List available simulators and status. |
| `xbridge_bootSimulator` | Boot a simulator. |
| `xbridge_readDiagnostics` | Read the last build or test diagnostics. |
| `xbridge_clean` | Clean the Xcode build folder. |

See the [main README](../README.md#settings) for the eleven configurable settings and [XBridgeDemo](../examples/XBridgeDemo) for a project you can try locally.
