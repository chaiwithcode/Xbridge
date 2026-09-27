<!--  Created by Deepak Sharma on 13/08/2026. -->
## Your project

XBridge looks for, in order:

1. `*.xcworkspace`
2. `*.xcodeproj`
3. `Package.swift`

The detected project name is shown in the header of the **Build & Run** view.

Working in a monorepo with several projects? Set `xbridge.projectPath` and
XBridge will always use that one.
