import { describe, it, expect, beforeAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Env } from '../src/env.js';

let loadEnv: typeof import('../src/env.js')['loadEnv'];
let issueMcpJwt: typeof import('../src/utils/mcpJwt.js')['issueMcpJwt'];
let baseEnv: Env;

beforeAll(async () => {
  if (!process.env.MCP_JWT_SECRET) {
    process.env.MCP_JWT_SECRET = 'test-secret-key-that-is-long-enough-123456';
  }
  const envModule = await import('../src/env.js');
  loadEnv = envModule.loadEnv;
  const jwtModule = await import('../src/utils/mcpJwt.js');
  issueMcpJwt = jwtModule.issueMcpJwt;
  baseEnv = loadEnv();
});

describe('issueMcpJwt', () => {
  function withOverrides(overrides: Partial<Env>): Env {
    return {
      ...baseEnv,
      ...overrides,
    } as Env;
  }

  it('throws when MCP_JWT_SECRET is missing', () => {
    const env = withOverrides({ MCP_JWT_SECRET: '' } as unknown as Env);
    expect(() => issueMcpJwt(env, { supabase_user_id: 'user-123', scope: 'wallet.read' })).toThrow(/MCP_JWT_SECRET/);
  });

  it('issues a signed JWT with expected claims when secret is set', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '60',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      supabase_email: 'user@example.com',
      scope: 'wallet.read',
      roles: ['SuperAdmin', 'operator'],
    });
    expect(token).toBeTruthy();

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      supabase_user_id: string | null;
      scope: string | null;
      roles?: string[];
    };

    expect(decoded.iss).toBe('https://dexter.cash/mcp');
    expect(decoded.aud).toBe('https://dexter.cash/mcp');
    expect(decoded.sub).toBe('user-123');
    expect(decoded.supabase_user_id).toBe('user-123');
    expect(decoded.scope).toBe('wallet.read');
    expect(decoded.supabase_email).toBe('user@example.com');
    expect(decoded.roles).toEqual(['operator', 'superadmin']);
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.exp - decoded.iat).toBe(60);
  });

  it('normalizes roles by trimming whitespace, deduplicating, and dropping empty entries', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '60',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      roles: ['  SuperAdmin  ', '', ' operator ', null as unknown as string, 'operator', 'SUPERADMIN'],
    });
    expect(token).toBeTruthy();

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      roles?: string[];
    };

    expect(decoded.roles).toEqual(['operator', 'superadmin']);
  });

  it('keeps encoded token within OpenAI header limits when roles present', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '60',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      supabase_email: 'user@example.com',
      wallet_public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V',
      roles: ['superadmin', 'admin'],
    });

    expect(token).toBeTruthy();
    const headerLength = `Bearer ${token}`.length;
    expect(headerLength).toBeLessThanOrEqual(512);
    expect(String(token).length).toBeLessThanOrEqual(505);
  });

  it('drops supabase_email before scope when trimming is required', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '300',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      supabase_email: `${'a'.repeat(430)}@dexter.cash`,
      scope: 'wallet.manage',
      wallet_public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V',
      roles: ['superadmin', 'admin', 'operator'],
    });

    expect(token).toBeTruthy();
    const headerLength = `Bearer ${token}`.length;
    expect(headerLength).toBeLessThanOrEqual(512);

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      scope?: string | null;
      supabase_email?: string | null;
      roles?: string[];
    };

    expect(decoded.scope).toBe('wallet.manage');
    expect(decoded).not.toHaveProperty('supabase_email');
    expect(decoded.roles).toEqual(['admin', 'operator', 'superadmin']);

    const warnCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('trimmed_claims'),
    );
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(String(warnCalls[0][0])).toContain('claims=supabase_email');

    warnSpy.mockRestore();
  });

  it('drops scope after supabase_email when still oversized', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '300',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      supabase_email: `${'a'.repeat(430)}@dexter.cash`,
      scope: `wallet.${'manage.'.repeat(40)}all`,
      wallet_public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V',
      roles: ['superadmin', 'admin', 'operator'],
    });

    expect(token).toBeTruthy();
    const headerLength = `Bearer ${token}`.length;
    expect(headerLength).toBeLessThanOrEqual(512);

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      scope?: string | null;
      supabase_email?: string | null;
      roles?: string[];
    };

    expect(decoded).not.toHaveProperty('supabase_email');
    expect(decoded).not.toHaveProperty('scope');
    expect(decoded.roles).toEqual(['admin', 'operator', 'superadmin']);

    const warnCalls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('trimmed_claims'),
    );
    expect(warnCalls.length).toBeGreaterThan(0);
    expect(String(warnCalls[warnCalls.length - 1][0])).toContain('claims=supabase_email,scope');

    warnSpy.mockRestore();
  });

  it('returns null and logs an error if trimming cannot reduce size below the header limit', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '300',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      supabase_email: `${'a'.repeat(430)}@dexter.cash`,
      scope: `wallet.${'manage.'.repeat(40)}all`,
      wallet_public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V',
      roles: Array.from({ length: 40 }, (_, idx) => `role-${idx}`),
    });

    expect(token).toBeNull();

    const errorCalls = errorSpy.mock.calls.filter((args) =>
      typeof args[0] === 'string' && args[0].includes('jwt_too_long'),
    );
    expect(errorCalls.length).toBeGreaterThan(0);

    errorSpy.mockRestore();
  });

  it('falls back to guest subject and default ttl when user id missing', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const token = issueMcpJwt(env, { supabase_user_id: null });
    expect(token).toBeTruthy();

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      supabase_user_id: string | null;
    };
    expect(decoded.sub).toBe('guest');
    expect(decoded.supabase_user_id).toBeNull();
    expect(decoded).not.toHaveProperty('roles');
    expect(decoded.exp - decoded.iat).toBe(900);
  });
});
