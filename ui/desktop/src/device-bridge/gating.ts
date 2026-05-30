// Default-on-with-opt-out gating for the AgentFlow engine wiring.
//
// A double-clicked packaged app sets no env vars, so the flow-LLM and
// device-bridge wiring must activate from the enrolled auth.json alone.
// Both features stay opt-out so a developer can pin the stock-goose path:
// FF_FLOW_LLM=0 / FF_DEVICE_BRIDGE=0 (also accepts "false").

import { isEnrolled } from './auth';
import type { DeviceAuth } from './types';

/** True when the env flag explicitly disables a feature. */
export function isOptedOut(flag: string | undefined): boolean {
  return flag === '0' || flag === 'false';
}

/**
 * Flow-LLM wiring is on whenever auth.json yields a usable gateway env (i.e. it
 * carries an AgentFlow api_key), unless FF_FLOW_LLM opts out. A keyless launch
 * keeps the user's own provider because `hasFlowEnv` is false.
 */
export function flowLlmEnabled(flag: string | undefined, hasFlowEnv: boolean): boolean {
  if (isOptedOut(flag)) return false;
  return hasFlowEnv;
}

/**
 * Device-bridge is on whenever auth.json is enrolled enough to connect, unless
 * FF_DEVICE_BRIDGE opts out. Enrollment is required because the bridge cannot
 * open the platform tunnel without a device id + secret/enrollment token.
 */
export function deviceBridgeEnabled(flag: string | undefined, auth: DeviceAuth | null): boolean {
  if (isOptedOut(flag)) return false;
  return isEnrolled(auth);
}
