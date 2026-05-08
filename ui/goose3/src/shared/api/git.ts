// goose3: Git operations are not available without a Tauri command bridge.
// These stubs return safe defaults or throw when an action is attempted.
// See docs/UNSUPPORTED_FEATURES.md.
import type {
  ChangedFile,
  CreatedWorktree,
  GitState,
} from "@/shared/types/git";

const NOT_SUPPORTED = "Git integration is not available in goose3 yet.";

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(NOT_SUPPORTED));
}

export async function getGitState(_path: string): Promise<GitState> {
  // Returning a "not a repo" shape lets project UI render without crashing.
  return {
    isRepo: false,
    currentBranch: null,
    branches: [],
    isDirty: false,
    hasRemote: false,
    aheadCount: 0,
    behindCount: 0,
  } as unknown as GitState;
}

export async function switchBranch(
  _path: string,
  _branch: string,
): Promise<void> {
  return unsupported();
}

export async function stashChanges(_path: string): Promise<void> {
  return unsupported();
}

export async function initRepo(_path: string): Promise<void> {
  return unsupported();
}

export async function fetchRepo(_path: string): Promise<void> {
  return unsupported();
}

export async function pullRepo(_path: string): Promise<void> {
  return unsupported();
}

export async function createBranch(
  _path: string,
  _name: string,
  _baseBranch: string,
): Promise<void> {
  return unsupported();
}

export async function getChangedFiles(_path: string): Promise<ChangedFile[]> {
  return [];
}

export async function createWorktree(
  _path: string,
  _name: string,
  _branch: string,
  _createBranch: boolean,
  _baseBranch?: string,
): Promise<CreatedWorktree> {
  return unsupported();
}
