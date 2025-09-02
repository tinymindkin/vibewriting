# Repository Guidelines

## Project Structure & Module Organization
- `src/main/`: Electron main process (window creation, IPC, PDF parsing in `pdf.js`).
- `src/preload/`: Preload script exposing a minimal `window.api` via `contextBridge`.
- `src/renderer/`: React + Vite UI (`index.html`, `main.jsx`, `App.jsx`, styles).
- `dist/`: Vite build output consumed by Electron in production.
- `tests/`: Utility scripts and sample assets (e.g., `testAtonation.js`, `files/*.pdf`).
- `build/`: Packaging assets for electron-builder.

## Build, Test, and Development Commands
- `npm run dev`: Start Vite on `5174` and Electron with auto-reload.
- `npm run build:renderer`: Build renderer to `dist/`.
- `npm start`: Launch Electron loading `dist/index.html` (build first).
- `npm run build`: Build renderer and package app via electron-builder.
- `node tests/testAtonation.js`: Run PDF highlight extraction demo against `tests/files`.

## Coding Style & Naming Conventions
- JavaScript/React with 2‑space indentation, single quotes, and semicolons.
- React components in PascalCase (`App.jsx`); module files in lower camel/kebab as existing.
- Keep main/preload strictly Node/Electron; renderer stays browser‑safe (no Node APIs).
- Prefer small, focused modules; colocate renderer assets next to components.

## Testing Guidelines
- Place ad‑hoc tests under `tests/`; reuse `node tests/<file>.js` to run.
- For PDF parsing, copy sample PDFs into `tests/files/` and import from `src/main/pdf.js`.
- Aim for deterministic output (log summaries of pages/groups), avoid network calls.

## Commit & Pull Request Guidelines
- Commit messages: concise, imperative, include scope when helpful (e.g., "main: handle multi‑PDF selection").
- PRs must include: clear description, what/why, screenshots or logs if UI/CLI changes, and linked issue if any.
- Keep changes scoped; avoid drive‑by refactors unrelated to the PR.

## Security & Configuration Tips
- IPC only exposes: `ping`, `dialog:openPDFs`, `pdf:extractHighlights`. Validate inputs on the main side.
- Electron settings: `contextIsolation: true`, `nodeIntegration: false`. In production, enable `sandbox: true` and add a CSP.
- Configuration via `.env` (see `.env.example`: `API_KEY`, `BASE_URL`, `MODEL_NAME`). Never commit secrets.


