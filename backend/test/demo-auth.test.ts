import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';
import { buildApiApp } from '../src/api/app.js';
import type { Database } from '../src/lib/db.js';
import type { ReviewService } from '../src/services/reviewService.js';
import type { DocumentService } from '../src/services/documentService.js';
import type { GenLayerAdapter } from '../src/services/genlayerAdapter.js';

const BRADBURY_CONTRACT = '0x5c708DF3382123d12eC7110F203653E90f12eC57';

function demoEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'demo',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/lotcheck_test',
    AUTH_MODE: 'demo',
    DEMO_AUTH_PASSCODE: 'test-only-passphrase-for-demo',
    DEMO_AUTH_SIGNING_SECRET: Buffer.alloc(32, 42).toString('base64url'),
    CORS_ORIGINS: 'https://demo.example',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'test-only-evidence-bucket',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'test-only-access-key',
    S3_SECRET_ACCESS_KEY: 'test-only-not-a-real-secret',
    S3_SERVER_SIDE_ENCRYPTION: 'AES256',
    GENLAYER_MODE: 'live',
    GENLAYER_NETWORK: 'testnetBradbury',
    GENLAYER_RPC: 'https://rpc-bradbury.genlayer.com',
    GENLAYER_CONTRACT_ADDRESS: BRADBURY_CONTRACT,
    GENLAYER_PRIVATE_KEY: `0x${Buffer.alloc(32, 17).toString('hex')}`,
    ...overrides,
  };
}

function buildDemoApp(config: AppConfig) {
  const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database;
  const reviews = { listSites: vi.fn(async () => []) } as unknown as ReviewService;
  const documents = {} as DocumentService;
  const genlayer = {} as GenLayerAdapter;
  return buildApiApp({ config, db, reviews, documents, genlayer });
}

describe('isolated Railway demo authentication', () => {
  it('loads only with explicit demo mode, reviewer credentials, persistent S3, and the existing live Bradbury contract', () => {
    const config = loadConfig(demoEnvironment());
    expect(config).toMatchObject({
      nodeEnv: 'demo',
      authMode: 'demo',
      storageDriver: 's3',
      genlayerMode: 'live',
      genlayerNetwork: 'testnetBradbury',
      genlayerRpc: 'https://rpc-bradbury.genlayer.com',
      genlayerContractAddress: BRADBURY_CONTRACT,
    });
  });

  it('rejects demo authentication in NODE_ENV=production so the production OIDC gate remains in force', () => {
    expect(() => loadConfig(demoEnvironment({ NODE_ENV: 'production' }))).toThrow(/Production requires AUTH_MODE=oidc/);
  });

  it('rejects demo settings that omit live Bradbury, S3 encryption, or the demo signing credentials', () => {
    expect(() => loadConfig(demoEnvironment({ GENLAYER_MODE: 'disabled' }))).toThrow(/Demo mode requires GENLAYER_MODE=live/);
    expect(() => loadConfig(demoEnvironment({ S3_SERVER_SIDE_ENCRYPTION: undefined }))).toThrow(/Demo mode S3 storage requires server-side encryption/);
    expect(() => loadConfig(demoEnvironment({ DEMO_AUTH_SIGNING_SECRET: '' }))).toThrow(/DEMO_AUTH_SIGNING_SECRET/);
  });

  it('exposes a public auth-mode probe, rejects an incorrect passcode, and verifies a signed reviewer session', async () => {
    const config = loadConfig(demoEnvironment());
    const app = await buildDemoApp(config);
    try {
      const mode = await app.inject({ method: 'GET', url: '/api/auth/mode' });
      expect(mode.statusCode).toBe(200);
      expect(mode.json()).toEqual({ mode: 'demo' });

      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/auth/session',
        headers: {
          origin: 'https://demo.example',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://demo.example');
      expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');

      const rejected = await app.inject({
        method: 'POST',
        url: '/api/auth/demo-login',
        payload: { passcode: 'incorrect-demo-passcode' },
      });
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json()).toMatchObject({ code: 'INVALID_DEMO_CREDENTIALS' });

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo-login',
        payload: { passcode: config.demoAuthPasscode },
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers['cache-control']).toBe('private, no-store');
      const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn } = login.json();
      expect(tokenType).toBe('Bearer');
      expect(expiresIn).toBe(4 * 60 * 60);
      expect(accessToken).toEqual(expect.any(String));

      const session = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(session.statusCode).toBe(200);
      expect(session.headers['cache-control']).toBe('private, no-store');
      expect(session.json()).toMatchObject({
        authenticated: true,
        actor: { roles: ['lotcheck:reviewer'] },
      });
      expect(session.json().actor.id).toMatch(/^demo:/);

      const protectedWithoutToken = await app.inject({ method: 'GET', url: '/api/sites' });
      expect(protectedWithoutToken.statusCode).toBe(401);
      const protectedWithToken = await app.inject({
        method: 'GET',
        url: '/api/sites',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(protectedWithToken.statusCode).toBe(200);
      expect(protectedWithToken.json()).toEqual({ sites: [] });
    } finally {
      await app.close();
    }
  });

  it('does not expose the demo login endpoint when demo auth is not explicitly selected', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/lotcheck_test' });
    const app = await buildDemoApp(config);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/demo-login',
        payload: { passcode: 'not-used-outside-demo-mode' },
      });
      expect(login.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
