import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';

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

type ManagedWalletRecord = {
  public_key: string;
  label: string | null;
  status: string;
  metadata: unknown;
};

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

      const walletKeySet = new Set<string>();
      for (const link of userLinks) {
        if (link.wallet_public_key) {
          walletKeySet.add(link.wallet_public_key);
        }
      }
      const walletKeys = Array.from(walletKeySet);
      const wallets = await prisma.managed_wallets.findMany({
        where: { public_key: { in: walletKeys } },
      });

      const walletByKey = new Map<string, ManagedWalletRecord>();
      for (const wallet of wallets) {
        walletByKey.set(wallet.public_key, wallet as unknown as ManagedWalletRecord);
      }

      let defaultWalletKey = walletKeys[0];
      for (const link of userLinks) {
        if (link.default_wallet && link.wallet_public_key) {
          defaultWalletKey = link.wallet_public_key;
          break;
        }
      }

      const walletsSerialized: SerializedWallet[] = walletKeys
        .map((key) => {
          const record = walletByKey.get(key);
          if (!record) return null;
          return serializeWallet(record, { isDefault: record.public_key === defaultWalletKey });
        })
        .filter(Boolean) as SerializedWallet[];

      return res.json({ ok: true, user: { id: supabaseUserId }, wallets: walletsSerialized });
    } catch (error: any) {
      console.error('[wallets/resolver] error', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
