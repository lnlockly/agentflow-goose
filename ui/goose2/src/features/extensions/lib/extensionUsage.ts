import type { Message, ToolRequestContent } from "@/shared/types/messages";
import type { SessionExtensionStatus } from "../types";
import { normalizeExtensionKey } from "./extensionKeys";

export interface ExtensionUsage {
  count: number;
  lastUsedAt: number;
}

function toolOwnerFromName(name: string): string | null {
  const [owner] = name.split("__");
  return owner && owner !== name ? normalizeExtensionKey(owner) : null;
}

function getToolOwnerFromName(
  toolName: string,
  toolToExtension: Map<string, string>,
): string | null {
  return (
    toolToExtension.get(normalizeExtensionKey(toolName)) ??
    toolOwnerFromName(toolName)
  );
}

export function buildToolToExtensionMap(
  extensions: SessionExtensionStatus[],
): Map<string, string> {
  const byTool = new Map<string, string>();
  for (const extension of extensions) {
    for (const tool of extension.tools) {
      byTool.set(normalizeExtensionKey(tool), extension.config_key);
      const unprefixedName = tool.split("__").pop();
      const unprefixedKey = unprefixedName
        ? normalizeExtensionKey(unprefixedName)
        : null;
      if (unprefixedKey && !byTool.has(unprefixedKey)) {
        byTool.set(unprefixedKey, extension.config_key);
      }
    }
  }
  return byTool;
}

export function getToolOwner(
  toolRequest: ToolRequestContent,
  toolToExtension: Map<string, string>,
): string | null {
  if (toolRequest.extensionName) {
    return normalizeExtensionKey(toolRequest.extensionName);
  }
  if (toolRequest.toolName) {
    return getToolOwnerFromName(toolRequest.toolName, toolToExtension);
  }
  return getToolOwnerFromName(toolRequest.name, toolToExtension);
}

export function getExtensionUsageByConfigKey(
  messages: Message[],
  toolToExtension: Map<string, string>,
): Map<string, ExtensionUsage> {
  const usage = new Map<string, ExtensionUsage>();
  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "toolRequest") continue;
      const owner = getToolOwner(content, toolToExtension);
      if (!owner) continue;
      const previous = usage.get(owner);
      usage.set(owner, {
        count: (previous?.count ?? 0) + 1,
        lastUsedAt: Math.max(previous?.lastUsedAt ?? 0, message.created),
      });
    }
  }
  return usage;
}

export function getUsedSessionExtensions(
  extensions: SessionExtensionStatus[],
  messages: Message[],
): SessionExtensionStatus[] {
  const toolToExtension = buildToolToExtensionMap(extensions);
  const usageByExtension = getExtensionUsageByConfigKey(
    messages,
    toolToExtension,
  );

  return extensions
    .filter((extension) => usageByExtension.has(extension.config_key))
    .sort((a, b) => {
      const aUsage = usageByExtension.get(a.config_key)?.lastUsedAt ?? 0;
      const bUsage = usageByExtension.get(b.config_key)?.lastUsedAt ?? 0;
      return bUsage - aUsage;
    });
}
