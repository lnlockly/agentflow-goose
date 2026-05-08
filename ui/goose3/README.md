# goose3

A fresh fork of `ui/goose2` whose only backend channel is **ACP**.

## What's different from goose2

- The Tauri shell is intentionally minimal. The only Tauri commands are
  `get_goose_serve_url` and `get_goose_serve_host_info` — both bootstrap the
  ACP WebSocket. Every other backend interaction must go over ACP via
  `@aaif/goose-sdk`.
- Tauri plugins for `dialog`, `opener`, `shell` (frontend usage), and the
  app test driver were removed. UI code that relied on them now imports
  shims from `@/shared/lib/tauriShims`.
- Frontend modules that previously called native Tauri commands (personas,
  git, doctor, distro, system fs, model/agent setup, project icons) are
  stubbed in goose3 — they return safe empty defaults or reject with a
  "not supported in goose3" error so the UI can degrade gracefully.

See [`docs/UNSUPPORTED_FEATURES.md`](./docs/UNSUPPORTED_FEATURES.md) for the
running list of features that need an ACP method before they can light up
in goose3.

## Getting started

```bash
just setup
just dev
```

The dev workflow is otherwise identical to goose2 — see `AGENTS.md` for
architecture and conventions (most still apply, with the additional
constraint that **all** new backend functionality MUST go through ACP).
