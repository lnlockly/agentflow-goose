import { revealItemInDir } from "@/shared/lib/tauriShims";

export async function revealInFileManager(path: string): Promise<void> {
  await revealItemInDir(path);
}
