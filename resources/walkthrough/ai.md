<!--  Created by Deepak Sharma on 13/08/2026. -->
## Agent tools

XBridge exposes the Xcode toolchain to Copilot and other AI agents:

| Tool | What it does |
| --- | --- |
| `#iosBuild` | Compiles the project and reports compiler errors |
| `#iosTest` | Runs tests, optionally a single one, and reports failures |
| `#iosRun` | Builds, installs and launches on a simulator |
| `#iosDiagnostics` | Reads errors and warnings from the most recent build |
| `#iosClean` | Cleans DerivedData before a fresh build |
| `#iosSchemes` | Lists schemes, targets and configurations |
| `#iosSimulators` | Lists simulators and their UDIDs |
| `#iosBoot` | Boots a simulator |

Try asking:

> Run #iosBuild, fix the reported errors, then build again to verify.
