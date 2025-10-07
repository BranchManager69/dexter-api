import { describe, it, expect, beforeAll } from 'vitest';
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
    expect(decoded.supabase_email).toBe('user@example.com');
    expect(decoded.scope).toBe('wallet.read');
    expect(decoded.roles).toEqual(['superadmin', 'operator']);
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect(decoded.exp - decoded.iat).toBe(60);
  });

  it('normalizes roles by trimming whitespace and dropping empty entries', () => {
    const env = withOverrides({
      MCP_JWT_SECRET: 'test-secret-key-that-is-long-enough-abcdef',
      MCP_JWT_TTL_SECONDS: '60',
      MCP_URL: 'https://dexter.cash/mcp',
    });

    const token = issueMcpJwt(env, {
      supabase_user_id: 'user-123',
      roles: ['  SuperAdmin  ', '', ' operator ', null as unknown as string],
    });
    expect(token).toBeTruthy();

    const decoded = jwt.verify(String(token), 'test-secret-key-that-is-long-enough-abcdef') as jwt.JwtPayload & {
      roles?: string[];
    };

    expect(decoded.roles).toEqual(['superadmin', 'operator']);
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
