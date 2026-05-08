// goose3: Filesystem helpers are not exposed over ACP yet.
// See docs/UNSUPPORTED_FEATURES.md.

export interface FileTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface AttachmentPathInfo {
  name: string;
  path: string;
  kind: "file" | "directory";
  mimeType?: string | null;
}

export interface ImageAttachmentPayload {
  base64: string;
  mimeType: string;
}

const NOT_SUPPORTED =
  "Filesystem operations are not available in goose3 yet (no ACP coverage).";

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_SUPPORTED));
}

export async function getHomeDir(): Promise<string> {
  // The browser-only build can't know the user's home directory; return an
  // empty string so callers can detect "no home" without crashing.
  return "";
}

export async function saveExportedSessionFile(
  _defaultFilename: string,
  _contents: string,
): Promise<string | null> {
  // No native save dialog without Tauri plugins; signal "user cancelled".
  return null;
}

export async function pathExists(_path: string): Promise<boolean> {
  return false;
}

export async function listFilesForMentions(
  _roots: string[],
  _maxResults = 1500,
): Promise<string[]> {
  return [];
}

export async function listDirectoryEntries(
  _path: string,
): Promise<FileTreeEntry[]> {
  return [];
}

export async function inspectAttachmentPaths(
  _paths: string[],
): Promise<AttachmentPathInfo[]> {
  return [];
}

export async function readImageAttachment(
  _path: string,
): Promise<ImageAttachmentPayload> {
  return unsupported();
}
