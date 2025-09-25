import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { logger, style } from '../logger.js';

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

export function registerWalletRoutes(app: Express) {
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
}
