// goose3: Native path resolution isn't exposed over ACP yet.
// See docs/UNSUPPORTED_FEATURES.md.

export interface ResolvePathParams {
  parts: string[];
}

export interface ResolvedPath {
  path: string;
}

export async function resolvePath({
  parts,
}: ResolvePathParams): Promise<ResolvedPath> {
  // Best-effort: join with "/" so callers receive *something*. They should
  // not be relying on this to access the filesystem in goose3.
  return { path: parts.join("/") };
}
