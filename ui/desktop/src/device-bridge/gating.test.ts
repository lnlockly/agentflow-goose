import { describe, it, expect } from 'vitest';
import { isOptedOut, flowLlmEnabled, deviceBridgeEnabled } from './gating';
import { DEFAULT_WS_URL } from './auth';
import type { DeviceAuth } from './types';

const enrolled: DeviceAuth = {
  apiKey: 'af_live_x',
  deviceId: 'dev-1',
  deviceSecret: 'sek',
  enrollmentToken: '',
  wsUrl: DEFAULT_WS_URL,
};

describe('isOptedOut', () => {
  it('treats "0" and "false" as opt-out', () => {
    expect(isOptedOut('0')).toBe(true);
    expect(isOptedOut('false')).toBe(true);
  });

  it('treats everything else as not opted out', () => {
    expect(isOptedOut(undefined)).toBe(false);
    expect(isOptedOut('1')).toBe(false);
    expect(isOptedOut('true')).toBe(false);
    expect(isOptedOut('')).toBe(false);
  });
});

describe('flowLlmEnabled', () => {
  it('is on by default when a flow gateway env is available', () => {
    expect(flowLlmEnabled(undefined, true)).toBe(true);
  });

  it('stays off when there is no flow gateway env (keyless launch)', () => {
    expect(flowLlmEnabled(undefined, false)).toBe(false);
    expect(flowLlmEnabled('1', false)).toBe(false);
  });

  it('honours the opt-out even when a key is present', () => {
    expect(flowLlmEnabled('0', true)).toBe(false);
    expect(flowLlmEnabled('false', true)).toBe(false);
  });

  it('still enables when forced on with a key present', () => {
    expect(flowLlmEnabled('1', true)).toBe(true);
  });
});

describe('deviceBridgeEnabled', () => {
  it('is on by default when auth.json is enrolled', () => {
    expect(deviceBridgeEnabled(undefined, enrolled)).toBe(true);
  });

  it('stays off when auth is absent or not enrolled', () => {
    expect(deviceBridgeEnabled(undefined, null)).toBe(false);
    expect(deviceBridgeEnabled(undefined, { ...enrolled, deviceSecret: '', enrollmentToken: '' })).toBe(
      false
    );
    expect(deviceBridgeEnabled(undefined, { ...enrolled, apiKey: '' })).toBe(false);
  });

  it('honours the opt-out even when enrolled', () => {
    expect(deviceBridgeEnabled('0', enrolled)).toBe(false);
    expect(deviceBridgeEnabled('false', enrolled)).toBe(false);
  });
});
