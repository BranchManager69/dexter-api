import type { Express, Request, Response } from 'express';
import prisma from '../../../../config/prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';

type SerializedWallet = {
  walletId: string;
  publicAddress: string;
  label: string | null;
  status: string;
  metadata: unknown;
  isDefault: boolean;
  permissions: {
    trade: boolean;
    view: boolean;
  };
};

type ManagedWalletRecord = {
  id: string;
  public_key: string;
  label: string | null;
  status: string;
  metadata: unknown;
};

function serializeWallet(record: ManagedWalletRecord, opts: { isDefault: boolean }): SerializedWallet {
  return {
    walletId: record.id,
    publicAddress: record.public_key,
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

export function registerWalletRoutes(app: Express) {
  app.get('/api/wallets/resolver', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const userLinks = await prisma.oauth_user_wallets.findMany({
        where: { supabase_user_id: supabaseUserId },
        orderBy: { created_at: 'asc' },
      });

      if (!userLinks.length) {
        return res.json({ ok: true, user: { id: supabaseUserId }, wallets: [] });
      }

      const walletIds = [...new Set(userLinks.map((link) => link.wallet_id))];
      const wallets = await prisma.managed_wallets.findMany({
        where: { id: { in: walletIds } },
      });

      const walletById = new Map<string, ManagedWalletRecord>(
        wallets.map((wallet) => [wallet.id, wallet as ManagedWalletRecord]),
      );

      const defaultWalletId = userLinks.find((link) => link.default_wallet)?.wallet_id || walletIds[0];

      const serialized = walletIds
        .map((id) => walletById.get(id))
        .filter((wallet): wallet is ManagedWalletRecord => Boolean(wallet))
        .map((wallet) => serializeWallet(wallet, { isDefault: wallet.id === defaultWalletId }));

      return res.json({ ok: true, user: { id: supabaseUserId }, wallets: serialized });
    } catch (error: any) {
      console.error('[wallets/resolver] error', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
