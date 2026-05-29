import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadAuth,
  saveAuth,
  buildConnectHeaders,
  isEnrolled,
  apiBase,
  DEFAULT_WS_URL,
} from './auth';
import type { DeviceAuth } from './types';

const TMP = path.join(os.tmpdir(), `af-bridge-test-${process.pid}`);
const FILE = path.join(TMP, 'auth.json');

const base: DeviceAuth = {
  apiKey: 'af_live_x',
  deviceId: 'dev-1',
  deviceSecret: 'sek',
  enrollmentToken: '',
  wsUrl: DEFAULT_WS_URL,
};

beforeEach(() => fs.mkdirSync(TMP, { recursive: true }));
afterEach(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('auth file round-trip', () => {
  it('saves with snake_case keys and reloads identically', () => {
    saveAuth(base, FILE);
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    expect(raw).toMatchObject({ api_key: 'af_live_x', device_id: 'dev-1', device_secret: 'sek' });
    expect(loadAuth(FILE)).toEqual(base);
  });

  it('writes the file 0600', () => {
    saveAuth(base, FILE);
    expect(fs.statSync(FILE).mode & 0o777).toBe(0o600);
  });

  it('returns null for missing or malformed files', () => {
    expect(loadAuth(path.join(TMP, 'nope.json'))).toBeNull();
    fs.writeFileSync(FILE, '{ not json');
    expect(loadAuth(FILE)).toBeNull();
  });

  it('defaults ws_url when absent', () => {
    fs.writeFileSync(FILE, JSON.stringify({ api_key: 'a', device_id: 'd', device_secret: 's' }));
    expect(loadAuth(FILE)?.wsUrl).toBe(DEFAULT_WS_URL);
  });
});

describe('buildConnectHeaders', () => {
  it('prefers device_secret', () => {
    expect(buildConnectHeaders(base)).toEqual({
      'x-api-key': 'af_live_x',
      'x-device-id': 'dev-1',
      'x-device-secret': 'sek',
    });
  });

  it('falls back to enrollment_token', () => {
    const a = { ...base, deviceSecret: '', enrollmentToken: 'tok' };
    expect(buildConnectHeaders(a)['x-enrollment-token']).toBe('tok');
    expect(buildConnectHeaders(a)['x-device-secret']).toBeUndefined();
  });

  it('throws when neither secret nor token present', () => {
    expect(() => buildConnectHeaders({ ...base, deviceSecret: '', enrollmentToken: '' })).toThrow();
  });

  it('throws on missing api_key / device_id', () => {
    expect(() => buildConnectHeaders({ ...base, apiKey: '' })).toThrow(/api_key/);
    expect(() => buildConnectHeaders({ ...base, deviceId: '' })).toThrow(/device_id/);
  });
});

describe('isEnrolled', () => {
  it('requires api_key + device_id + (secret or token)', () => {
    expect(isEnrolled(base)).toBe(true);
    expect(isEnrolled(null)).toBe(false);
    expect(isEnrolled({ ...base, deviceSecret: '', enrollmentToken: '' })).toBe(false);
    expect(isEnrolled({ ...base, apiKey: '' })).toBe(false);
  });
});

describe('apiBase', () => {
  it('appends /_agents and trims trailing slash', () => {
    const prev = process.env.AF_API_URL;
    process.env.AF_API_URL = 'https://agentflow.website/';
    expect(apiBase()).toBe('https://agentflow.website/_agents');
    process.env.AF_API_URL = 'https://example.com/_agents';
    expect(apiBase()).toBe('https://example.com/_agents');
    if (prev === undefined) delete process.env.AF_API_URL;
    else process.env.AF_API_URL = prev;
  });
});
