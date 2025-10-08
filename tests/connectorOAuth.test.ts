import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ensureUserWalletMock = vi.fn();
const exchangeRefreshTokenMock = vi.fn();
const getSupabaseUserFromAccessTokenMock = vi.fn();
const getConnectorTokenTTLSecondsMock = vi.fn(() => 3600);

const prismaMock = {
  connector_oauth_requests: {
    create: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  },
  connector_oauth_codes: {
    findUnique: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  mcp_oauth_clients: {
    findUnique: vi.fn(),
  },
};

vi.mock('../src/prisma.js', () => ({
  default: prismaMock,
}));

vi.mock('../src/wallets/allocator.js', () => ({
  ensureUserWallet: ensureUserWalletMock,
}));

vi.mock('../src/utils/supabaseAdmin.js', () => ({
  exchangeRefreshToken: exchangeRefreshTokenMock,
  getSupabaseUserFromAccessToken: getSupabaseUserFromAccessTokenMock,
  getConnectorTokenTTLSeconds: getConnectorTokenTTLSecondsMock,
}));

describe('/api/connector/oauth/token', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prismaMock.connector_oauth_requests.create.mockResolvedValue(null);
    prismaMock.connector_oauth_requests.findUnique.mockResolvedValue(null);
    prismaMock.connector_oauth_requests.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.connector_oauth_codes.findUnique.mockResolvedValue(null);
    prismaMock.connector_oauth_codes.delete.mockResolvedValue({ count: 1 });
    prismaMock.connector_oauth_codes.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.connector_oauth_codes.create.mockResolvedValue(null);
    prismaMock.mcp_oauth_clients.findUnique.mockResolvedValue(null);

    process.env.CONNECTOR_CODE_SALT = 'sufficiently-secret-salt';
    process.env.MCP_JWT_SECRET = 'test-secret-key-that-is-long-enough-abcdef';
    process.env.MCP_URL = 'https://dexter.cash/mcp';
  });

  async function setupApp() {
    const { registerConnectorOAuthRoutes } = await import('../src/routes/connectorOAuth.js');
    const { loadEnv } = await import('../src/env.js');
    const env = loadEnv();
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    registerConnectorOAuthRoutes(app, env);
    return { app };
  }

  it('mint trims supabase_email but retains scope when issuing fallback JWT', async () => {
    const { app } = await setupApp();
    exchangeRefreshTokenMock.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'next-refresh-token',
      expires_in: 1800,
      user: { id: 'user-123' },
    });
    getSupabaseUserFromAccessTokenMock.mockResolvedValue({
      id: 'user-123',
      email: `${'a'.repeat(430)}@dexter.cash`,
      app_metadata: { roles: ['SuperAdmin', 'operator'] },
    });
    ensureUserWalletMock.mockResolvedValue({
      wallet: { public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V' },
      mcpJwt: null,
    });

    const response = await supertest(app)
      .post('/api/connector/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
      })
      .expect(200);

    expect(exchangeRefreshTokenMock).toHaveBeenCalledWith('refresh-token');
    expect(ensureUserWalletMock).toHaveBeenCalledWith(expect.any(Object), {
      supabaseUserId: 'user-123',
      email: `${'a'.repeat(430)}@dexter.cash`,
      roles: ['superadmin', 'operator'],
    });

    const token = response.body.dexter_mcp_jwt;
    expect(token).toBeTruthy();

    const decoded = jwt.verify(token, process.env.MCP_JWT_SECRET!, { algorithms: ['HS256'] }) as Record<string, any>;
    expect(decoded.supabase_user_id).toBe('user-123');
    expect(decoded.supabase_email).toBeUndefined();
    expect(decoded.roles).toEqual(['operator', 'superadmin']);
  });

  it('omits dexter_mcp_jwt when payload cannot fit within header limits', async () => {
    const { app } = await setupApp();
    exchangeRefreshTokenMock.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'next-refresh-token',
      expires_in: 1800,
      user: { id: 'user-123' },
    });
    getSupabaseUserFromAccessTokenMock.mockResolvedValue({
      id: 'user-123',
      email: `${'a'.repeat(430)}@dexter.cash`,
      app_metadata: { roles: Array.from({ length: 80 }, (_value, index) => `role-${index}`) },
    });
    ensureUserWalletMock.mockResolvedValue({
      wallet: { public_key: 'BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V' },
      mcpJwt: null,
    });

    const response = await supertest(app)
      .post('/api/connector/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token',
      })
      .expect(200);

    expect(response.body).not.toHaveProperty('dexter_mcp_jwt');
    expect(response.body.wallet_public_key).toBe('BRANCHVDL53igBiYuvrEfZazXJm24qKQJhyXBUm7z7V');
  });
});
