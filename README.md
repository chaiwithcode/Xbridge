# XBridge — Build, Test, and Run Xcode Projects in VS Code

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="XBridge logo" />
</p>

<p align="center">
  <a href="https://github.com/chaiwithcode/Xbridge/actions"><img src="https://github.com/chaiwithcode/Xbridge/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=chaiwithcode.xbridge"><img src="https://img.shields.io/visual-studio-marketplace/v/chaiwithcode.xbridge?color=0A84FF&label=Marketplace" alt="Marketplace Version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=chaiwithcode.xbridge"><img src="https://img.shields.io/visual-studio-marketplace/i/chaiwithcode.xbridge?color=34C759&label=Installs" alt="Installs" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
</p>

<p align="center">
  <strong>Stay in VS Code for the everyday Xcode workflow.</strong><br/>
  Build, test, and run iOS and macOS apps with simulator and physical-device control, native Test Explorer integration, inline diagnostics, and eight AI agent tools.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#ai-agent-tools">AI Tools</a> •
  <a href="#physical-device-support">Physical Devices</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#settings">Settings</a>
</p>

---

## Why XBridge?

- Run the core Xcode workflow from the editor where you write Swift.
- Target simulators or connected iPhones and iPads through Apple's native tools.
- See compiler and test failures inline and in VS Code's Problems and Test Explorer views.
- Let compatible AI coding agents build, test, run, clean, and inspect diagnostics through dedicated tools.
- Keep Xcode one click away for Interface Builder, Instruments, signing, and project settings.

---

## Features

### 1. Build, Run & Test
- **Xcode-Style Status Bar Toolbar**: Persistent controls right where you expect them:
  - **Run / Stop** toggle button (`⌃⌘R` / `⌃⌘.`)
  - **Build** button (`⌃⌘B`)
  - **Test** button (`⌃⌘U`)
  - Clickable **Scheme** selector
  - Clickable **Destination** selector (Simulators & Physical Devices)
  - **Live Activity Pill**: Displays active compilation phase (`Building` → `Linking` → `Testing` → `Launching`) with error/warning counts on completion.
  - **App Running Pill**: Green status indicator when your app is active; click anytime to terminate it.

### 2. Physical iOS Device Support (`devicectl`)
- Seamlessly deploy and run your apps on real iPhones and iPads running iOS 17+.
- Uses Apple's modern **CoreDevice** framework (`xcrun devicectl`) without needing third-party Python daemons or jailbreaks.
- Automatic device discovery: connected USB and paired Wi-Fi devices automatically appear in the **Destinations** sidebar.
- Verifies Developer Mode status before building, providing actionable warnings if disabled.

### 3. Simulator Management Superpowers
Right-click any simulator in the **Destinations** panel to access deep device utilities:
- 📸 **Take Screenshot**: Captures clean PNG screenshots directly to your workspace.
- 🎬 **Record Screen**: One-click screen recording saved as H.264 video.
- 🌙 **Toggle Appearance**: Instantly switch between Light and Dark mode.
- 🔗 **Open URL / Deep Link**: Test your app's custom URL schemes and universal links.
- 📂 **Open App Container**: Open your app's Documents/Library sandbox folder in Finder.
- 🗑️ **Uninstall App**: Remove installed builds with a single click.
- 📋 **Copy UDID**: Fast clipboard access for scripting or provisioning.
- 🧼 **Erase Simulator**: Reset simulator contents and settings to factory state.

### 4. Modern Testing with XCTest & Swift Testing (`@Test`)
- Native integration with the VS Code **Test Explorer**.
- Discovers and runs both traditional **XCTest** suites and modern **Swift Testing** (`@Test`, `@Suite`) tests.
- Gutter play buttons (▶️) next to test functions for single-test execution.
- Accurately captures assertion failures with file, line, and expression decomposition.

### 5. Inline Diagnostics & Searchable Issue Viewer
- Compiler errors, warnings, and test failures are mapped directly into the VS Code Problems panel and highlighted with inline squiggly lines.
- Click the status-bar result pill anytime to open a fuzzy-searchable QuickPick of all build issues and jump straight to the source line.

### 6. Dependency Management & Xcode Integration
- **Resolve Package Dependencies (`⌃⌘P`)**: Run `xcodebuild -resolvePackageDependencies` without touching terminal.
- **Open in Xcode**: Quickly open the active project or workspace in Xcode.app whenever you need Interface Builder or Instruments.

---

## AI Agent Tools (GitHub Copilot)

XBridge exposes 8 dedicated **Language Model Tools** directly to AI coding agents (such as GitHub Copilot in VS Code or Cursor). Reference them with `#` in prompt:

| Tool Reference | Tool Name | Description |
|:---|:---|:---|
| `#iosBuild` | `xbridge_build` | Compiles the active scheme and returns structured compiler errors and warnings. |
| `#iosTest` | `xbridge_test` | Runs test suites (or an individual test) and reports test failures with file/line locations. |
| `#iosRun` | `xbridge_run` | Builds, installs, and launches the app on the selected simulator or physical device. |
| `#iosDiagnostics` | `xbridge_readDiagnostics` | Reads compiler errors and test failures from the last run without rebuilding. |
| `#iosClean` | `xbridge_clean` | Cleans the Xcode build folder (`DerivedData`) for a fresh compilation. |
| `#iosSchemes` | `xbridge_listSchemes` | Discovers available schemes, configurations, and build targets. |
| `#iosSimulators` | `xbridge_listSimulators` | Lists all installed simulators and their status (Booted/Shutdown). |
| `#iosBoot` | `xbridge_bootSimulator` | Boots a specified simulator by UDID and opens Simulator.app. |

> **AI Pair Programming Example:**
> *"Use `#iosBuild` to compile the app. If there are any compiler errors, use `#iosDiagnostics` to inspect the error lines, fix the Swift code, and re-run `#iosBuild` until it succeeds."*

---

## Requirements

- **macOS** with **Xcode** and command-line developer tools installed (`xcodebuild`, `xcrun simctl`).
- Physical device support requires **Xcode 15+** (`xcrun devicectl`).
- For physical device builds, code signing (Development Team & Signing Identity) must be configured in your Xcode project.

---

## Getting Started

1. Open a workspace folder containing an `.xcodeproj`, `.xcworkspace`, or `Package.swift`.
2. Click the **XBridge** icon in the Activity Bar.
3. Select your desired Scheme and Destination (Simulator or Connected Physical Device).
4. Press `⌃⌘B` to build, or `⌃⌘R` to build and launch!

Run **XBridge: Getting Started** from the Command Palette (`⇧⌘P`) anytime for a guided walkthrough.

---

## Keyboard Shortcuts

| Command | macOS Shortcut | Description |
|:---|:---:|:---|
| **XBridge: Build** | <kbd>⌃⌘B</kbd> | Build the current scheme |
| **XBridge: Build & Run** | <kbd>⌃⌘R</kbd> | Build and launch on simulator or device |
| **XBridge: Run Tests** | <kbd>⌃⌘U</kbd> | Run test plan or target |
| **XBridge: Clean Build Folder** | <kbd>⌃⌘K</kbd> | Clean DerivedData build products |
| **XBridge: Stop** | <kbd>⌃⌘.</kbd> | Cancel active build or terminate running app |
| **XBridge: Select Destination** | <kbd>⌃⌘D</kbd> | Switch destination device or simulator |
| **XBridge: Resolve Package Dependencies** | <kbd>⌃⌘P</kbd> | Resolve SPM package dependencies |

---

## Settings

Configure XBridge in your User or Workspace `settings.json`:

| Setting | Type | Default | Description |
|:---|:---:|:---:|:---|
| `xbridge.projectPath` | `string` | `""` | Path to `.xcodeproj`, `.xcworkspace`, or `Package.swift` (auto-detected if empty). |
| `xbridge.scheme` | `string` | `""` | Xcode scheme to build. |
| `xbridge.configuration` | `string` | `"Debug"` | Build configuration (`Debug` or `Release`). |
| `xbridge.destination` | `string` | `""` | UDID of the selected target simulator or physical device. |
| `xbridge.testPlan` | `string` | `""` | `.xctestplan` to run, overriding scheme default. |
| `xbridge.testTarget` | `string` | `""` | Specific test target to run (or all tests if empty). |
| `xbridge.derivedDataPath` | `string` | `""` | Custom DerivedData directory. Defaults to `.build/DerivedData`. |
| `xbridge.extraBuildArgs` | `array` | `[]` | Extra arguments injected into `xcodebuild` invocations. |
| `xbridge.streamAppLogs` | `boolean` | `true` | Stream app `stdout`/`stderr` into the "XBridge App" output channel. |
| `xbridge.openSimulatorOnRun` | `boolean` | `true` | Focus Simulator.app when launching on a simulator. |
| `xbridge.autoRevealBuildLog` | `boolean` | `false` | Automatically show the build output channel when an action starts. |

---

## Contributing

We welcome community contributions! Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

1. Fork the repository: [https://github.com/chaiwithcode/Xbridge](https://github.com/chaiwithcode/Xbridge)
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Deepak Sharma.
