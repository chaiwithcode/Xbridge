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

1. Fork the repo on GitHub: [https://github.com/chaiwithcode/xbridge](https://github.com/chaiwithcode/xbridge)
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

## Submitting Pull Requests

1. Create a descriptive branch:
   ```bash
   git checkout -b feat/my-awesome-feature
   ```
2. Make your changes and commit with clear, conventional messages (`feat: ...`, `fix: ...`, `docs: ...`).
3. Ensure all tests pass (`npm test`).
4. Push your branch to GitHub and open a Pull Request.
5. Provide a summary of changes, motivation, and screenshots/recordings if UI elements were modified.

Thank you for helping make XBridge better!
