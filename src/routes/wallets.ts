import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { logger, style } from '../logger.js';
import type { Env } from '../env.js';
import { ensureUserWallet } from '../wallets/allocator.js';
import { getSupabaseUserFromAccessToken } from '../utils/supabaseAdmin.js';
import { loadManagedWallet } from '../wallets/manager.js';
import bs58 from 'bs58';

type SerializedWallet = {
  publicKey: string;
  label: string | null;
  status: string;
  metadata: unknown;
  isDefault: boolean;
  permissions: {
    trade: boolean;
    view: boolean;
  };
};

type ManagedWalletRecord = Awaited<ReturnType<typeof prisma.managed_wallets.findMany>>[number];

function serializeWallet(record: ManagedWalletRecord, opts: { isDefault: boolean }): SerializedWallet {
  return {
    publicKey: record.public_key,
    label: record.label || null,
    status: record.status,
    metadata: record.metadata ?? null,
    isDefault: opts.isDefault,
    permissions: {
      trade: true,
      view: true,
    },
  };
}

export function registerWalletRoutes(app: Express, env: Env) {
  const log = logger.child('wallets.resolver');
  app.get('/api/wallets/resolver', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const assignedWallets = await prisma.managed_wallets.findMany({
        where: {
          assigned_supabase_user_id: supabaseUserId,
          status: 'assigned',
        },
        orderBy: { assigned_at: 'asc' },
      });

      if (!assignedWallets.length) {
        return res.json({ ok: true, user: { id: supabaseUserId }, wallets: [] });
      }

      const defaultWalletKey = assignedWallets[0].public_key;

      const walletsSerialized: SerializedWallet[] = assignedWallets.map((wallet) =>
        serializeWallet(wallet, { isDefault: wallet.public_key === defaultWalletKey }),
      );

      return res.json({ ok: true, user: { id: supabaseUserId }, wallets: walletsSerialized });
    } catch (error: any) {
      log.error(`${style.status('resolver', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/wallets/active', async (req: Request, res: Response) => {
    try {
      const authHeader = String(req.headers['authorization'] || '');
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';

      if (!bearerToken) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      let email: string | null = null;
      try {
        const user = await getSupabaseUserFromAccessToken(bearerToken);
        email = user.email ?? null;
      } catch (error: any) {
        log.warn(
          `${style.status('wallet', 'warn')} ${style.kv('event', 'supabase_user_lookup_failed')} ${style.kv('reason', error?.message || error)}`,
          { error: error?.message || error }
        );
      }

      const assignment = await ensureUserWallet(env, {
        supabaseUserId,
        email,
      });

      if (!assignment) {
        return res.status(404).json({ ok: false, error: 'wallet_unavailable' });
      }

      return res.json({
        ok: true,
        wallet: {
          public_key: assignment.wallet.public_key,
          label: assignment.wallet.label,
        },
        mcp_jwt: assignment.mcpJwt,
      });
    } catch (error: any) {
      log.error(
        `${style.status('wallet', 'error')} ${style.kv('event', 'active_wallet_failed')} ${style.kv('error', error?.message || error)}`,
        error
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/wallets/export', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const walletRecord = await prisma.managed_wallets.findFirst({
        where: {
          assigned_supabase_user_id: supabaseUserId,
          status: 'assigned',
        },
        orderBy: { assigned_at: 'asc' },
      });

      if (!walletRecord) {
        return res.status(404).json({ ok: false, error: 'wallet_not_found' });
      }

      const loaded = await loadManagedWallet(walletRecord.public_key);
      const secretKeyBytes = Buffer.from(loaded.keypair.secretKey);
      const secretKeyBase58 = bs58.encode(secretKeyBytes);

      log.info(
        `${style.status('wallet', 'success')} ${style.kv('event', 'wallet_export_generated')} ${style.kv('wallet', walletRecord.public_key)} ${style.kv('user', supabaseUserId)}`,
      );

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ok: true, secret_key: secretKeyBase58 });
    } catch (error: any) {
      log.error(
        `${style.status('wallet', 'error')} ${style.kv('event', 'wallet_export_failed')} ${style.kv('error', error?.message || error)}`,
        error
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
