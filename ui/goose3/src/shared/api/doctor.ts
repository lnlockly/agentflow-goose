// goose3: Doctor diagnostics aren't exposed over ACP yet.
// See docs/UNSUPPORTED_FEATURES.md.

export type FixType = "command" | "bridge";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fixUrl: string | null;
  fixCommand: string | null;
  fixType: FixType | null;
  path: string | null;
  bridgePath: string | null;
  rawOutput: string | null;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

export async function runDoctor(): Promise<DoctorReport> {
  return { checks: [] };
}

export async function runDoctorFix(
  _checkId: string,
  _fixType: FixType,
): Promise<void> {
  return Promise.reject(
    new Error("Doctor fixes are not available in goose3 yet."),
  );
}
