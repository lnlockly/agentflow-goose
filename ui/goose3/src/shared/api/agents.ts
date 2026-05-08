// goose3: Persona/agent management does not yet have ACP coverage. These
// stubs preserve the public API shape used by the rest of the UI but throw
// when called, so consumers can detect unavailable features and disable
// affected UI surfaces. See docs/UNSUPPORTED_FEATURES.md.
import type {
  Persona,
  CreatePersonaRequest,
  UpdatePersonaRequest,
} from "@/shared/types/agents";

const NOT_SUPPORTED =
  "Persona management is not available in goose3 yet (no ACP coverage).";

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_SUPPORTED));
}

export async function listPersonas(): Promise<Persona[]> {
  // Return an empty list rather than throwing so the UI can render a
  // "no personas" empty-state instead of an error screen.
  return [];
}

export async function createPersona(
  _request: CreatePersonaRequest,
): Promise<Persona> {
  return unsupported();
}

export async function updatePersona(
  _id: string,
  _request: UpdatePersonaRequest,
): Promise<Persona> {
  return unsupported();
}

export async function deletePersona(_id: string): Promise<void> {
  return unsupported();
}

export async function refreshPersonas(): Promise<Persona[]> {
  return [];
}

export interface ExportResult {
  json: string;
  suggestedFilename: string;
}

export async function exportPersona(_id: string): Promise<ExportResult> {
  return unsupported();
}

export async function importPersonas(
  _fileBytes: number[],
  _fileName: string,
): Promise<Persona[]> {
  return unsupported();
}

export interface ImportFileReadResult {
  fileBytes: number[];
  fileName: string;
}

export async function readImportPersonaFile(
  _sourcePath: string,
): Promise<ImportFileReadResult> {
  return unsupported();
}

export async function savePersonaAvatar(
  _personaId: string,
  _sourcePath: string,
): Promise<string> {
  return unsupported();
}

export async function savePersonaAvatarBytes(
  _personaId: string,
  _bytes: number[],
  _extension: string,
): Promise<string> {
  return unsupported();
}

export async function getAvatarsDir(): Promise<string> {
  return unsupported();
}
