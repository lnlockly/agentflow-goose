// goose3: The HTTP base URL / secret-key bootstrap is still served from
// Tauri because inline MCP apps need a localhost HTTP origin. This is the
// *only* non-ACP backend call we keep — and it ultimately just forwards to
// the same `goose serve` process.
import { invoke } from "@tauri-apps/api/core";

export interface GooseServeHostInfo {
  // Rename to baseUrl when goose serve supports a secure local origin.
  httpBaseUrl: string;
  secretKey: string;
}

export async function getGooseServeHostInfo(): Promise<GooseServeHostInfo> {
  return invoke<GooseServeHostInfo>("get_goose_serve_host_info");
}
