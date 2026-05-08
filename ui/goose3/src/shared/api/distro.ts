// goose3: Distro bundle metadata isn't exposed over ACP yet.
// See docs/UNSUPPORTED_FEATURES.md.
import type { DistroBundleInfo } from "@/shared/types/distro";

export async function getDistroBundle(): Promise<DistroBundleInfo> {
  // Return an "unbundled" shape so callers fall back to default behaviour.
  return {
    isBundled: false,
    binDir: null,
    configPath: null,
    rootDir: null,
  } as unknown as DistroBundleInfo;
}
