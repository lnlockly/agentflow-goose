// goose3: Streaming model-setup output used Tauri events. The auth call
// itself is already ACP-backed (authenticateProviderConfig); we just stub
// the streaming hook.

import type { ProviderConfigChangeResponse } from "@aaif/goose-sdk";
import { authenticateProviderConfig } from "./credentials";

type UnlistenFn = () => void;

export async function authenticateModelProvider(
  providerId: string,
  providerLabel: string,
): Promise<ProviderConfigChangeResponse> {
  void providerLabel;
  return authenticateProviderConfig(providerId);
}

export function onModelSetupOutput(
  _providerId: string,
  _callback: (line: string) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(() => {});
}
