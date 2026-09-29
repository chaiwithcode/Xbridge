# Contributing to XBridge

Thank you for your interest in contributing to XBridge! We are excited to collaborate with the community on a focused Xcode workflow for VS Code.

---

## Code of Conduct

This project and everyone participating in it is governed by the [XBridge Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Development Setup

### Prerequisites

- **macOS** with **Xcode 15+** installed.
- **Node.js** (v20+ recommended).
- **npm** (v10+).
- **VS Code** (latest stable release).

### Getting the Code

1. Fork the repo on GitHub: [https://github.com/chaiwithcode/Xbridge](https://github.com/chaiwithcode/Xbridge)
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/xbridge.git
   cd xbridge
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

---

## Running and Debugging Locally

1. Open the `xbridge` folder in VS Code:
   ```bash
   code .
   ```
2. Start the TypeScript watcher:
   ```bash
   npm run watch
   ```
3. Press <kbd>F5</kbd> (or select **Run > Start Debugging**) to launch the **Extension Development Host**.
4. In the Extension Development Host window, open any iOS/macOS project or Swift package to test your changes.
5. Use <kbd>⇧⌘F5</kbd> to reload the host window after making changes.

---

## Scripts & Quality Checks

Run the following checks before committing code:

```bash
# Type-check TypeScript code
npm run check-types

# Run ESLint
npm run lint

# Run unit tests
npm test

# Bundle production extension
npm run package

# Build a distributable .vsix package
make vsix
```

---

## Branching Strategy

XBridge uses `develop` as its integration branch and keeps `main` production-ready.

| Branch | Purpose | Created from | Merged into |
| --- | --- | --- | --- |
| `main` | Stable releases only | — | — |
| `develop` | Integration for the next release | `main` | `main` through a release PR |
| `feature/<name>` | New functionality | `develop` | `develop` |
| `fix/<name>` | Non-urgent bug fixes | `develop` | `develop` |
| `chore/<name>` | Documentation, tooling, and maintenance | `develop` | `develop` |
| `release/<version>` | Final release stabilization | `develop` | `main`, then back into `develop` |
| `hotfix/<version>` | Urgent production corrections | `main` | `main`, then back into `develop` |

Both `main` and `develop` are protected. Changes must arrive through pull requests and pass the **Test & Build** CI check. Releases are tagged from `main` using semantic version tags such as `v1.4.1`.

### Typical feature flow

```bash
git switch develop
git pull --ff-only
git switch -c feature/my-feature
```

Open the pull request against `develop`. When preparing a release, create `release/<version>` from `develop`, complete final verification, and open a pull request into `main`. After release, merge `main` back into `develop` so both branches contain the release commit and tag.

Maintainers preparing the second registry listing can follow the [Open VSX publishing guide](docs/open-vsx.md).

---

## Submitting Pull Requests

1. Start from `develop` and create a descriptive branch:
   ```bash
   git switch develop
   git pull --ff-only
   git switch -c feature/my-awesome-feature
   ```
2. Make your changes and commit with clear, conventional messages (`feat: ...`, `fix: ...`, `docs: ...`).
3. Ensure all tests pass (`npm test`).
4. Push your branch to GitHub and open a pull request targeting `develop`.
5. Provide a summary of changes, motivation, and screenshots/recordings if UI elements were modified.

Thank you for helping make XBridge better!
