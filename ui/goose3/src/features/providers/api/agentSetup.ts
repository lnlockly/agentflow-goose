// goose3: Native agent setup (installing CLIs, running auth subprocesses)
// is not exposed over ACP yet. The UI should treat agents as not-installed
// and surface a manual setup hint. See docs/UNSUPPORTED_FEATURES.md.

type UnlistenFn = () => void;

export async function checkAgentInstalled(
  _providerId: string,
): Promise<boolean> {
  return false;
}

export async function checkAgentAuth(_providerId: string): Promise<boolean> {
  return false;
}

export async function installAgent(_providerId: string): Promise<void> {
  return Promise.reject(
    new Error("Installing agent CLIs is not available in goose3 yet."),
  );
}

export async function authenticateAgent(_providerId: string): Promise<void> {
  return Promise.reject(
    new Error("Native agent authentication is not available in goose3 yet."),
  );
}

export function onAgentSetupOutput(
  _providerId: string,
  _callback: (line: string) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(() => {});
}
