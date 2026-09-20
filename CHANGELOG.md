# Changelog

## 1.3.0

- Added complete extension identity and Marketplace metadata: author, homepage, gallery banner, pricing, Q&A, workspace runtime, trust capabilities, virtual-workspace limitations, and richer iOS/Swift discovery keywords.
- Declared that XBridge requires a trusted local workspace because it runs `xcodebuild` and `xcrun` against local projects and simulators.
- Updated VSCE automation to package and publish non-interactively while the project has no verified public source repository.

## 1.2.1

- Test Explorer no longer marks unresolved tests as passed when the overall test action fails.
- Clean now reports the real `xcodebuild` result, streams its output, publishes diagnostics, and can be stopped.
- Simulator utilities no longer cancel an active build, run, test, or clean action; conflicting primary actions are disabled while one is running.
- Run now selects the application product from Xcode build settings instead of accidentally using a framework, extension, or test bundle.
- Screenshot failures stop immediately, and screen-recording state now clears if the recording process exits unexpectedly.
- Added focused regression tests for runnable-product selection and xcodebuild output parsing.
- Removed the Debuggers marketplace category and unsupported debugging claim until LLDB integration is available.

## 1.2.0

- **The Simulators view is now a real device panel.** Click any simulator to make it your run destination — a green check shows which one is active, booted devices are pinned to the top, and each device gets the right icon for its family (iPhone, iPad, Watch, TV, Vision). Right-click for the things you used to open Simulator.app for: open a URL or deep link, take a screenshot, record the screen, toggle light/dark appearance, open the app's data container, uninstall the app, copy the UDID or erase the device.
- **See your app's logs.** The launched app's console output now streams live into the **XBridge App** output channel, and a status-bar pill shows what's running — click it to stop the app.
- **Xcode-style keyboard shortcuts**: ⌃⌘B build, ⌃⌘R run, ⌃⌘U test, ⌃⌘K clean, ⌃⌘. stop, ⌃⌘D pick a destination.
- **Jump straight to a failure.** When a build or test fails, click the status-bar pill to get a searchable list of every error, warning and test failure — pick one and land on the exact line. The Activity Bar icon also carries a badge with the error count.
- **Builds stay out of your way.** Progress moved from a notification popup to the status bar, and the build log no longer steals focus (turn it back on with `xbridge.autoRevealBuildLog`).
- **Everything opens instantly.** Scheme and simulator lists are cached, so the sidebar, pickers and status bar no longer wait on `xcodebuild` for every redraw.
- The **Build & Run** view now shows the detected project, and the long option lists are collapsed by default.
- New **Getting Started** walkthrough, and a refresh button in the Test Explorer.

## 1.1.0

- Reworked the status-bar toolbar to feel like Xcode: the **scheme** and **destination** are now two independently clickable pills — click the scheme to switch schemes, click the destination to switch simulators.
- Live build status: while an action runs you'll see a spinner with the current phase (Building → Linking → Testing → Launching), and when it finishes a ✓ success or the exact error/warning counts — click it to jump straight to the build log.

## 1.0.0

- The XBridge sidebar now has expandable **Test Plans** and **Test Targets** sections, just like **Schemes** — browse and switch the active test plan or target with one click, without opening a picker.

## 0.1.9

- Marketplace icon now uses an Xcode/VS Code-style blue gradient.

## 0.1.8

- New crossed hammer + wrench icon. The Activity Bar uses a themeable monochrome version; the marketplace icon is the same shape with a blue-to-indigo gradient.

## 0.1.7

- Marketplace icon is now transparent (removed the blue tile) with a neutral hammer that reads on both light and dark backgrounds.

## 0.1.6

- Bigger, bolder Activity Bar and marketplace icon. The claw hammer now fills the canvas (was only ~13% of the box, so it looked tiny next to other extensions) and reads clearly at small sizes.

## 0.1.5

- Test now runs instantly like Build & Run — no more slow modal. Choose your test plan and target once from the new **Test Plan** and **Test Target** dropdowns in the Build & Run view (or the status-bar pill), and the Test button builds & runs them directly.
- Scheme, Configuration and Destination pickers now open instantly with a loading spinner instead of blocking while Xcode is queried.

## 0.1.4

- New gear+hammer icon; redesigned "Build & Run" view with a one-click toolbar (Run/Build/Test/Stop) and a settings summary (scheme, configuration, destination).
- Native Test Explorer: XCTest and swift-testing tests appear in the Test navigator with gutter run buttons and inline pass/fail results.
- Run ⇄ Stop toggle with live status while an action runs.
- Xcode-style status-bar pill combining scheme › destination.
- Test failures now surface in the Problems panel alongside build errors.
- Welcome view with a "Select Xcode Project" action when no project is detected.

## 0.1.1

- Redesigned activity-bar icon with a cleaner Xcode-style hammer.
- Xcode-like destination picker: booted devices first, grouped by runtime.
- Run Tests now auto-detects test plans (`.xctestplan`) and unit/UI test targets and offers a dropdown to choose what to run.

## 0.1.0

- Initial release.
- Build, run and test Xcode projects/workspaces via `xcodebuild`.
- Simulator management (list, boot, shutdown, erase, launch) via `simctl`.
- Schemes and Simulators sidebar views, status-bar actions.
- Compiler error/warning diagnostics parsed into the Problems panel.
- AI agent language-model tools: build, test, run, list schemes, list simulators, boot simulator.
