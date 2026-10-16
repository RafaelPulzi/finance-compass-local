# Tauri desktop shell for a local-first vault

We want all financial data to stay on the user's own machine as files they own (the Obsidian model), which a browser sandbox cannot do. We build Finance Compass as a **Tauri** desktop app wrapping the React/Vite UI, giving it real filesystem access to a user-chosen Vault folder.

## Considered Options

- **Tauri (chosen)**: real filesystem access, tiny binary, cross-platform, keeps the React/Vite frontend unchanged.
- **Electron**: same filesystem freedom but ~100MB+ and bundles Chromium.
- **Browser + File System Access API**: stays a pure web app but is Chromium-only and prompts for folder access every session.
- **Browser + IndexedDB**: simplest, but data is locked inside a browser profile — not "data on the user's desktop like Obsidian."
