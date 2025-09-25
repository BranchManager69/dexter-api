import { Prisma, managed_wallets as ManagedWallet } from '@prisma/client';
import prisma from '../prisma.js';
import { logger, style } from '../logger.js';
import type { Env } from '../env.js';
import { issueMcpJwt } from '../utils/mcpJwt.js';

const log = logger.child('walletAllocator');

export type WalletAssignmentOptions = {
  supabaseUserId: string | null;
  email?: string | null;
  provider?: string | null;
  subject?: string | null;
};

export type WalletAssignmentResult = {
  wallet: ManagedWallet;
  mcpJwt: string | null;
};

async function findAssignedWallet(supabaseUserId: string): Promise<ManagedWallet | null> {
  return prisma.managed_wallets.findFirst({
    where: {
      assigned_supabase_user_id: supabaseUserId,
      status: 'assigned',
    },
    orderBy: { assigned_at: 'asc' },
  });
}

async function claimNextAvailableWallet(
  tx: Prisma.TransactionClient,
  data: {
    supabaseUserId: string;
    email?: string | null;
    provider?: string | null;
    subject?: string | null;
  },
): Promise<ManagedWallet | null> {
  const candidate = await tx.$queryRaw<Pick<ManagedWallet, 'public_key'>[]>`
    SELECT public_key
    FROM managed_wallets
    WHERE status = 'available'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;

  const selected = candidate?.[0]?.public_key;
  if (!selected) {
    return null;
  }

  const now = new Date();
  const updated = await tx.managed_wallets.update({
    where: { public_key: selected },
    data: {
      status: 'assigned',
      assigned_supabase_user_id: data.supabaseUserId,
      assigned_provider: data.provider || null,
      assigned_subject: data.subject || null,
      assigned_email: data.email || null,
      assigned_at: now,
    },
  });

  return updated;
}

export async function ensureUserWallet(env: Env, options: WalletAssignmentOptions): Promise<WalletAssignmentResult | null> {
  const supabaseUserId = options.supabaseUserId?.trim();
  if (!supabaseUserId) {
    log.warn(`${style.status('wallet', 'warn')} ${style.kv('reason', 'missing_supabase_user_id')}`);
    return null;
  }

  const existing = await findAssignedWallet(supabaseUserId);
  let wallet = existing;

  if (!wallet) {
    wallet = await prisma.$transaction(
      async (tx) =>
        claimNextAvailableWallet(tx, {
          supabaseUserId,
          email: options.email || null,
          provider: options.provider || null,
          subject: options.subject || null,
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  if (!wallet) {
    log.error(
      `${style.status('wallet', 'error')} ${style.kv('error', 'no_wallet_available')} ${style.kv('user', supabaseUserId)}`,
      { supabaseUserId }
    );
    return null;
  }

  let mcpJwt: string | null = null;
  try {
    mcpJwt = issueMcpJwt(env, {
      supabase_user_id: supabaseUserId,
      supabase_email: options.email ?? null,
      wallet_public_key: wallet.public_key,
    });
  } catch (error: any) {
    log.error(
      `${style.status('wallet', 'error')} ${style.kv('error', error?.message || error)} ${style.kv('wallet', wallet.public_key)}`,
      {
        supabaseUserId,
        wallet: wallet.public_key,
        error: error?.message || error,
      }
    );
  }

  return { wallet, mcpJwt };
}
