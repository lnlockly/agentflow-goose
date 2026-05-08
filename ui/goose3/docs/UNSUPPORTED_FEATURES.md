# Unsupported features in goose3

goose3 only talks to the backend over ACP. The features below depended on
custom Tauri commands or Tauri plugins in goose2 and have **no ACP method
yet**. They are stubbed in the goose3 frontend so the UI keeps rendering,
but the corresponding actions are no-ops, return empty data, or reject
with `"... is not available in goose3 yet"`.

The point of this document is to give us a punch-list to work through —
each item should eventually be replaced by a typed ACP method exposed
from `crates/goose-sdk/src/custom_requests.rs`, implemented in
`crates/goose-acp`, and called from the matching `features/*/api/`
adapter (see `AGENTS.md` → "The canonical example" for the migration
shape).

## Status legend

| Symbol | Meaning |
| ------ | ------- |
| 🔴      | Stubbed — feature is fully disabled / inert in the UI |
| 🟡      | Partially stubbed — read paths return empty data, mutations reject |
| 🟢      | Already on ACP — listed for reference |

---

## Personas / agents (`src/shared/api/agents.ts`)

🔴 Was: `commands::agents::*` Tauri commands with on-disk YAML and avatar
files under `~/.goose/personas/` and `~/.goose/avatars/`.

| Method                       | goose3 stub behaviour                              |
| ---------------------------- | -------------------------------------------------- |
| `listPersonas`               | returns `[]`                                       |
| `refreshPersonas`            | returns `[]`                                       |
| `createPersona`              | rejects                                            |
| `updatePersona`              | rejects                                            |
| `deletePersona`              | rejects                                            |
| `exportPersona`              | rejects                                            |
| `importPersonas`             | rejects                                            |
| `readImportPersonaFile`      | rejects                                            |
| `savePersonaAvatar`          | rejects                                            |
| `savePersonaAvatarBytes`     | rejects                                            |
| `getAvatarsDir`              | rejects                                            |

**ACP shape suggestion:** namespace under `_goose/personas/*`
(create/list/update/delete/export/import) plus a separate avatar upload
method (or piggy-back on an existing assets endpoint).

## Git integration (`src/shared/api/git.ts`)

🟡 Was: `commands::git::*` and `commands::git_changes::*` shelling out to
`git` from Tauri.

| Method            | goose3 stub behaviour                                       |
| ----------------- | ----------------------------------------------------------- |
| `getGitState`     | returns a "not a repo" shape (`isRepo: false`, no branches) |
| `getChangedFiles` | returns `[]`                                                |
| `switchBranch`    | rejects                                                     |
| `stashChanges`    | rejects                                                     |
| `initRepo`        | rejects                                                     |
| `fetchRepo`       | rejects                                                     |
| `pullRepo`        | rejects                                                     |
| `createBranch`    | rejects                                                     |
| `createWorktree`  | rejects                                                     |

**ACP shape suggestion:** `_goose/git/state`, `_goose/git/changed_files`,
`_goose/git/branch/*`, `_goose/git/worktree/*` — they all take a workspace
path. Some of this might already be doable with the existing developer
MCP — worth checking before duplicating.

## Doctor (`src/shared/api/doctor.ts`)

🟡 Was: `commands::doctor::run_doctor` / `run_doctor_fix` (via the
`doctor` crate).

| Method         | goose3 stub behaviour     |
| -------------- | ------------------------- |
| `runDoctor`    | returns `{ checks: [] }`  |
| `runDoctorFix` | rejects                   |

**ACP shape suggestion:** `_goose/doctor/run`, `_goose/doctor/fix` — both
take no session ID. Output streaming is nice-to-have.

## Distro bundle (`src/shared/api/distro.ts`)

🟡 Was: `commands::distro::get_distro_bundle` reading the bundled distro
directory metadata.

| Method            | goose3 stub behaviour                |
| ----------------- | ------------------------------------ |
| `getDistroBundle` | returns an "unbundled" shape         |

**ACP shape suggestion:** `_goose/distro/info` — read-only, returns the
same `DistroBundleInfo` shape goose2 had.

## Filesystem helpers (`src/shared/api/system.ts`)

🟡 Was: `commands::system::*` — these powered file mentions, attachments,
session export, and directory pickers.

| Method                   | goose3 stub behaviour |
| ------------------------ | --------------------- |
| `getHomeDir`             | returns `""`          |
| `pathExists`             | returns `false`       |
| `listDirectoryEntries`   | returns `[]`          |
| `listFilesForMentions`   | returns `[]`          |
| `inspectAttachmentPaths` | returns `[]`          |
| `readImageAttachment`    | rejects               |
| `saveExportedSessionFile`| returns `null`        |

**ACP shape suggestion:** `_goose/fs/home`, `_goose/fs/list`,
`_goose/fs/exists`, `_goose/fs/mentions`, `_goose/attachments/inspect`,
`_goose/attachments/image`. Session export should probably use a
client-side blob download in goose3 instead of writing through the
backend — worth a separate design pass.

## Path resolver (`src/shared/api/pathResolver.ts`)

🟡 Was: `commands::path_resolver::resolve_path` (turns `["~", "subdir"]`
into a real absolute path).

| Method        | goose3 stub behaviour                      |
| ------------- | ------------------------------------------ |
| `resolvePath` | naive `parts.join("/")` with no expansion  |

**ACP shape suggestion:** `_goose/fs/resolve_path`. Could be folded into
the FS surface above.

## Project icon discovery (`src/features/projects/api/projects.ts`)

🟡 Was: `commands::project_icons::*` scanning working directories for
`.goose/icon.svg` (or similar) and reading them as inline SVG.

| Method              | goose3 stub behaviour |
| ------------------- | --------------------- |
| `scanProjectIcons`  | returns `[]`          |
| `readProjectIcon`   | rejects               |

The rest of the projects feature is already on ACP via `_goose/sources/*`.

**ACP shape suggestion:** `_goose/projects/icons/scan` and
`_goose/projects/icons/read`.

## Native model / agent setup (`src/features/providers/api/`)

🔴 Was: `commands::agent_setup::*` and `commands::model_setup::*` ran
`brew`/`npm`/CLI subprocesses and streamed their output via Tauri events.

| Method                        | goose3 stub behaviour |
| ----------------------------- | --------------------- |
| `checkAgentInstalled`         | returns `false`       |
| `checkAgentAuth`              | returns `false`       |
| `installAgent`                | rejects               |
| `authenticateAgent`           | rejects               |
| `onAgentSetupOutput`          | no-op subscription    |
| `onModelSetupOutput`          | no-op subscription    |
| `authenticateModelProvider`   | 🟢 already ACP-backed via `authenticateProviderConfig` |

**ACP shape suggestion:** these are inherently "the desktop shell pokes
something on disk" actions. Either keep them as Tauri commands in a
future goose3 build, or let goose core own provider auth flows behind a
typed contract such as `_goose/providers/auth/*`.

## Tauri plugin shims (`src/shared/lib/tauriShims.ts`)

🟡 The opener / dialog / event APIs that the goose2 UI used directly are
stubbed in `tauriShims.ts`:

| Replaced API                                  | goose3 behaviour                      |
| --------------------------------------------- | ------------------------------------- |
| `openUrl` (`@tauri-apps/plugin-opener`)       | falls back to `window.open(...)`      |
| `openPath` (`@tauri-apps/plugin-opener`)      | no-op + console hint                  |
| `revealItemInDir` (`@tauri-apps/plugin-opener`)| no-op + console hint                 |
| `open` file picker (`@tauri-apps/plugin-dialog`)| HTML `<input type="file">` fallback (returns file *names*, not paths) |
| `open` directory picker (`@tauri-apps/plugin-dialog`)| returns `null` (browsers can't return paths) |
| `convertFileSrc` (`@tauri-apps/api/core`)     | returns `file://<path>` (mostly broken in webview) |
| `listen` (`@tauri-apps/api/event`)            | resolves to a no-op unlisten function |

These shims exist to keep the UI compiling and graceful — most of them
indicate a place where we either need a real ACP method (e.g. inline file
streaming) or an honest "this doesn't work in goose3" UX state.

## Asset protocol (avatars / project icons)

🟡 goose2 served images from `~/.goose/avatars/**` via Tauri's
`assetProtocol`. goose3 doesn't enable that protocol, so `avatarUrl()`
and `ProjectIcon` produce `file://` URLs that the webview will refuse to
load. UI should fall back to the default avatar / icon. Long term this
needs an ACP method that streams image bytes (similar to
`readImageAttachment` above).

## App test driver

🔴 The `tauri-plugin-app-test-driver` plugin and the `app-test-driver`
Cargo feature are not part of goose3. The `tests/app-e2e/` Vitest suite
won't run as-is. Either re-introduce the plugin behind a feature flag
or migrate those tests to Playwright (`tests/e2e/`).

---

### Tracking issue checklist

When porting one of the above to ACP:

1. Add the request/response in `crates/goose-sdk/src/custom_requests.rs`.
2. Implement the handler in `crates/goose-acp/src/server.rs` (or the
   appropriate sub-module under `crates/goose/src/acp/server/`).
3. Put the real logic in the `goose` crate.
4. Run the SDK regen so the typed TS method appears on `GooseClient`.
5. Replace the stub in the goose3 `features/*/api/` (or
   `shared/api/`) module with a typed call, and remove the corresponding
   row from this document.
