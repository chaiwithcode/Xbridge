# XcodeKit

Build, run, test and manage iOS/macOS Xcode projects and simulators directly from
VS Code — with first-class **AI agent tools**. XcodeKit lets you do the day-to-day
Xcode workflow (build, run on a simulator, run tests, manage simulators) without
leaving your editor, and exposes those same capabilities to Copilot / AI agents.

## Features

- **Build / Run / Test** any scheme with `xcodebuild`, streamed to an output channel.
- **Simulator panel** — every device grouped by runtime with booted ones pinned to
  the top. Click one to make it the run destination; right-click to open a deep
  link, take a screenshot, record the screen, toggle light/dark appearance, open
  the app's data container, uninstall the app, copy the UDID or erase the device.
- **Live app console** — the launched app's `stdout`/`stderr` streams into the
  **XcodeKit App** channel, with a status-bar pill to stop it.
- **Status bar toolbar** with Run/Stop, Build, Test, and independently clickable
  scheme and destination selectors, plus a live phase indicator
  (Building → Linking → Testing → Launching).
- **Inline diagnostics** — compiler errors, warnings and test failures are parsed
  into the Problems panel and onto the relevant source lines. Click the status-bar
  result pill for a searchable issue list that jumps to the failing line.
- **Native Test Explorer** — XCTest and swift-testing tests with gutter run buttons.
- **AI agent tools** — Copilot and other agents can call:
  - `xcodekit_build` — build the project and report compiler errors.
  - `xcodekit_test` — run tests (optionally a single test) and report failures.
  - `xcodekit_run` — build, install and launch on a simulator.
  - `xcodekit_listSchemes` — discover schemes, targets, configurations.
  - `xcodekit_listSimulators` — discover simulators and their UDIDs.
  - `xcodekit_bootSimulator` — boot a simulator.

## Requirements

- macOS with **Xcode** and command-line tools installed (`xcodebuild`, `xcrun simctl`).

## Getting started

1. Open a folder containing an `.xcodeproj`, `.xcworkspace`, or `Package.swift`.
2. Open the **XcodeKit** view in the Activity Bar.
3. Click a simulator to set it as your destination, and pick a scheme.
4. Build, Run or Test.

Run **XcodeKit: Getting Started** from the Command Palette for a guided tour.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Build | <kbd>⌃⌘B</kbd> |
| Build & Run | <kbd>⌃⌘R</kbd> |
| Run Tests | <kbd>⌃⌘U</kbd> |
| Clean Build Folder | <kbd>⌃⌘K</kbd> |
| Stop | <kbd>⌃⌘.</kbd> |
| Select Destination | <kbd>⌃⌘D</kbd> |

## Settings

| Setting | Description |
| --- | --- |
| `xcodekit.projectPath` | Explicit path to the project/workspace (auto-detected if empty). |
| `xcodekit.scheme` | Default scheme. |
| `xcodekit.configuration` | Build configuration (Debug/Release). |
| `xcodekit.destination` | Selected simulator UDID. |
| `xcodekit.testPlan` | Selected test plan (`.xctestplan` base name). |
| `xcodekit.testTarget` | Selected test target, or all tests when empty. |
| `xcodekit.derivedDataPath` | Custom DerivedData path. |
| `xcodekit.extraBuildArgs` | Extra args appended to every `xcodebuild` call. |
| `xcodekit.streamAppLogs` | Stream the launched app's console into the App channel. |
| `xcodekit.openSimulatorOnRun` | Bring Simulator.app to the front when running. |
| `xcodekit.autoRevealBuildLog` | Open the build log automatically when an action starts. |

## Development

```bash
npm install
npm run compile      # one-off build
npm run watch        # watch mode
```

Press <kbd>F5</kbd> to launch an Extension Development Host.
