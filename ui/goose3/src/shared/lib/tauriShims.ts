// goose3: minimal shims for the @tauri-apps/plugin-opener and
// @tauri-apps/plugin-dialog APIs that the goose2 UI used. The goose3 Tauri
// shell deliberately does not include these plugins — every backend call must
// flow over ACP. These shims either fall back to standard browser APIs (where
// reasonable) or no-op so the UI degrades gracefully.
//
// See docs/UNSUPPORTED_FEATURES.md.

// --- @tauri-apps/plugin-opener replacements --------------------------------

/** Open an external URL. Falls back to `window.open` so links still work. */
export function openUrl(url: string): Promise<void> {
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.warn("[goose3] openUrl failed", error);
  }
  return Promise.resolve();
}

/** Open a local file/path in the OS shell. Not available without Tauri. */
export function openPath(_path: string): Promise<void> {
  console.info(
    "[goose3] openPath is not available without Tauri opener plugin",
  );
  return Promise.resolve();
}

/** Reveal an item in Finder/Explorer. Not available without Tauri. */
export function revealItemInDir(_path: string): Promise<void> {
  console.info(
    "[goose3] revealItemInDir is not available without Tauri opener plugin",
  );
  return Promise.resolve();
}

// --- @tauri-apps/plugin-dialog replacements --------------------------------

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  multiple?: boolean;
  directory?: boolean;
  filters?: DialogFilter[];
  defaultPath?: string;
  title?: string;
}

/**
 * Show a file picker. Without Tauri's native dialog we fall back to the
 * browser's <input type="file">, which only gives us in-memory File objects
 * — not absolute paths. Callers that need absolute paths should treat this
 * as unsupported and disable the affected feature.
 *
 * The overloads mirror @tauri-apps/plugin-dialog's `open()` so callers can
 * keep their existing type narrowing — `multiple: true` returns `string[]`,
 * everything else returns `string | null`.
 */
export function open(
  options: OpenDialogOptions & { multiple: true },
): Promise<string[] | null>;
export function open(
  options?: OpenDialogOptions & { multiple?: false },
): Promise<string | null>;
export function open(
  options?: OpenDialogOptions,
): Promise<string | string[] | null>;
export function open(
  options: OpenDialogOptions = {},
): Promise<string | string[] | null> {
  if (options.directory) {
    // The browser cannot let the user pick a directory by absolute path.
    console.info(
      "[goose3] directory picker is not available without Tauri dialog plugin",
    );
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple === true;
    if (options.filters?.length) {
      const accept = options.filters
        .flatMap((f) => f.extensions.map((ext) => `.${ext}`))
        .join(",");
      input.accept = accept;
    }
    input.addEventListener("change", () => {
      const files = input.files;
      if (!files || files.length === 0) {
        resolve(null);
        return;
      }
      // We intentionally return File names rather than fabricated paths.
      // Callers that need real paths must handle this graceful failure.
      const paths = Array.from(files).map((f) => f.name);
      resolve(options.multiple ? paths : (paths[0] ?? null));
    });
    input.click();
  });
}

// --- @tauri-apps/api/core convertFileSrc replacement -----------------------

/**
 * In Tauri, `convertFileSrc` rewrote a local filesystem path into a URL the
 * webview could load via the asset protocol. goose3 doesn't ship the asset
 * protocol — we just return a `file://` URL, which most surfaces will render
 * as a broken image. UI code that depends on local images should fall back
 * to a placeholder.
 */
export function convertFileSrc(path: string, _protocol = "asset"): string {
  if (!path) return "";
  if (/^[a-z]+:\/\//i.test(path)) return path;
  return `file://${path}`;
}

// --- @tauri-apps/api/event listen replacement ------------------------------

export type UnlistenFn = () => void;

/**
 * Tauri events were used for streaming subprocess output. In goose3 we don't
 * have those subprocess channels, so the listener is a no-op.
 */
export function listen<_T>(
  _event: string,
  _handler: (event: { payload: _T }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(() => {});
}
