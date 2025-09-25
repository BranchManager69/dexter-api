import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import prisma from '../prisma.js';
import { loadManagedWallet } from '../wallets/manager.js';
import { fetchQuote, fetchSwapTransaction, QuoteResponse } from './jupiter.js';
import { validateBuyRequest, validateSellRequest } from './txValidator.js';
import { resolveTokenByQuery, ResolvedTokenItem } from './tokenResolver.js';
import { logger, style } from '../logger.js';

const RPC_URL = (process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com').trim();
const connection = new Connection(RPC_URL, 'confirmed');

const TREASURY_ADDRESS = (process.env.DEXTER_SOLANA_TREASURY || '').trim();
if (!TREASURY_ADDRESS) {
  throw new Error('DEXTER_SOLANA_TREASURY must be set');
}
const TREASURY_PUBLIC_KEY = new PublicKey(TREASURY_ADDRESS);

const FEE_BPS_FREE = Number.parseInt(process.env.DEXTER_PLATFORM_FEE_BPS_FREE || '200', 10);
const FEE_BPS_PRO = Number.parseInt(process.env.DEXTER_PLATFORM_FEE_BPS_PRO || '0', 10);
const MAX_WALLETS_PRO = 10;
const tradeLog = logger.child('solana.trade');

export type UserTier = 'free' | 'pro';

export interface UserWalletLink {
  walletAddress: string;
  isDefault: boolean;
}

async function getUserTier(supabaseUserId: string | null): Promise<UserTier> {
  if (!supabaseUserId) return 'free';
  const subscription = await prisma.user_subscriptions.findUnique({
    where: { supabase_user_id: supabaseUserId },
    select: { tier: true, status: true },
  });
  if (!subscription) return 'free';
  if (subscription.status !== 'active') return 'free';
  return subscription.tier === 'pro' ? 'pro' : 'free';
}

async function getUserWalletLinks(supabaseUserId: string | null): Promise<UserWalletLink[]> {
  if (!supabaseUserId) return [];
  const wallets = await prisma.managed_wallets.findMany({
    where: {
      assigned_supabase_user_id: supabaseUserId,
      status: 'assigned',
    },
    orderBy: { assigned_at: 'asc' },
    select: { public_key: true, metadata: true, assigned_at: true },
  });
  return wallets.map((wallet, index) => {
    const meta = (wallet.metadata as any) ?? {};
    const metaDefault = typeof meta?.default === 'boolean' ? meta.default : false;
    return {
      walletAddress: wallet.public_key,
      isDefault: metaDefault || index === 0,
    };
  });
}

function selectAccessibleWalletAddress(
  requestedWalletAddress: string | null,
  tier: UserTier,
  links: UserWalletLink[],
): string {
  if (tier === 'free') {
    const defaultLink = links.find((link) => link.isDefault) || links[0];
    if (!defaultLink) {
      throw new Error('no_wallet_linked');
    }
    if (requestedWalletAddress && requestedWalletAddress !== defaultLink.walletAddress) {
      throw new Error('wallet_not_allowed_free_tier');
    }
    return defaultLink.walletAddress;
  }

  // pro tier
  if (!links.length) {
    throw new Error('no_wallet_linked');
  }
  if (links.length > MAX_WALLETS_PRO) {
    throw new Error('wallet_limit_exceeded');
  }
  if (requestedWalletAddress) {
    const match = links.find((link) => link.walletAddress === requestedWalletAddress);
    if (!match) {
      throw new Error('wallet_not_linked');
    }
    return requestedWalletAddress;
  }
  const defaultLink = links.find((link) => link.isDefault) || links[0];
  return defaultLink.walletAddress;
}

function feeBpsForTier(tier: UserTier): number {
  return tier === 'pro' ? FEE_BPS_PRO : FEE_BPS_FREE;
}

function calculateFeeLamports(amountLamports: bigint, tier: UserTier): { feeLamports: bigint; swapLamports: bigint } {
  const feeBps = feeBpsForTier(tier);
  if (feeBps <= 0) {
    return { feeLamports: 0n, swapLamports: amountLamports };
  }
  const feeLamports = (amountLamports * BigInt(feeBps)) / 10_000n;
  const swapLamports = amountLamports - feeLamports;
  if (swapLamports <= 0n) {
    throw new Error('amount_too_small_for_fee');
  }
  return { feeLamports, swapLamports };
}

async function getMintDecimals(mint: PublicKey): Promise<number> {
  const info = await connection.getParsedAccountInfo(mint);
  const decimals = (info.value?.data as any)?.parsed?.info?.decimals;
  if (typeof decimals === 'number') return decimals;
  // fallback to 9 if unknown
  return 9;
}

async function sendLamports(fromKeypair: Keypair, to: PublicKey, lamports: bigint): Promise<string> {
  if (lamports <= 0n) {
    throw new Error('invalid_fee_amount');
  }
  const ix = SystemProgram.transfer({ fromPubkey: fromKeypair.publicKey, toPubkey: to, lamports: Number(lamports) });
  const tx = new Transaction().add(ix);
  const signature = await connection.sendTransaction(tx, [fromKeypair], { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

async function submitSwapTransaction(base64: string, signer: Keypair): Promise<string> {
  const raw = Buffer.from(base64, 'base64');
  const transaction = VersionedTransaction.deserialize(raw);
  transaction.sign([signer]);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

export interface TokenBalanceItem {
  mint: string;
  ata: string;
  amountRaw: string;
  amountUi: number;
  decimals: number;
}

export async function listTokenBalances(options: { walletPublicKey: PublicKey; minimumUi?: number; limit?: number }): Promise<TokenBalanceItem[]> {
  const splAccounts = await connection.getParsedTokenAccountsByOwner(options.walletPublicKey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
  const items: TokenBalanceItem[] = [];
  const minUi = options.minimumUi ?? 0;
  for (const entry of splAccounts.value) {
    const info = (entry.account.data as any)?.parsed?.info;
    const tokenAmount = info?.tokenAmount;
    if (!tokenAmount) continue;
    const uiAmount = Number(tokenAmount.uiAmount || 0);
    if (uiAmount <= minUi) continue;
    items.push({
      mint: info.mint,
      ata: entry.pubkey.toBase58(),
      amountRaw: tokenAmount.amount,
      amountUi: uiAmount,
      decimals: Number(tokenAmount.decimals || 0),
    });
  }
  items.sort((a, b) => b.amountUi - a.amountUi);
  const limit = options.limit && options.limit > 0 ? options.limit : items.length;
  return items.slice(0, limit);
}

export async function resolveToken(query: string, limit = 5): Promise<ResolvedTokenItem[]> {
  if (!query || !query.trim()) {
    return [];
  }
  return resolveTokenByQuery(query, limit);
}

export interface BuyRequest {
  supabaseUserId: string | null;
  walletAddress?: string | null;
  amountSol: number;
  mint: string;
  slippageBps?: number;
}

export interface TradeResult {
  signature: string;
  walletAddress: string;
  feeLamports: string;
  swapLamports: string;
  solscanUrl: string;
  warnings: string[];
}

export async function executeBuy(request: BuyRequest): Promise<TradeResult> {
  const tier = await getUserTier(request.supabaseUserId);
  const links = await getUserWalletLinks(request.supabaseUserId);
  const walletAddress = selectAccessibleWalletAddress(request.walletAddress ?? null, tier, links);
  const loaded = await loadManagedWallet(walletAddress);

  const balanceLamports = BigInt(await connection.getBalance(loaded.publicKey, 'confirmed'));
 const amountLamports = BigInt(Math.floor(request.amountSol * LAMPORTS_PER_SOL));
  if (amountLamports <= 0n) {
    throw new Error('invalid_amount');
  }
  const { feeLamports, swapLamports } = calculateFeeLamports(amountLamports, tier);

  const validation = validateBuyRequest({
    walletBalanceLamports: balanceLamports,
    spendLamports: amountLamports,
    slippageBps: request.slippageBps ?? 100,
    mint: request.mint,
  });
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.code).join(','));
  }

  const lamportsForSwap = swapLamports;
  const quote = await fetchQuote({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: request.mint,
    amount: lamportsForSwap.toString(),
    slippageBps: request.slippageBps ?? 100,
    swapMode: 'ExactIn',
  });

  const swap = await fetchSwapTransaction({
    quoteResponse: quote,
    userPublicKey: loaded.publicKey.toBase58(),
    computeUnitPriceMicroLamports: 10_000,
  });

  if (!swap.swapTransaction) {
    const err = swap.error || swap.simulationError || 'swap_failed';
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }

  const signature = await submitSwapTransaction(swap.swapTransaction, loaded.keypair);

  if (feeLamports > 0n) {
    try {
      await sendLamports(loaded.keypair, TREASURY_PUBLIC_KEY, feeLamports);
    } catch (error) {
      tradeLog.warn(
        `${style.status('fee', 'warn')} ${style.kv('operation', 'executeBuy')} ${style.kv('lamports', feeLamports.toString())}`,
        error
      );
    }
  }

  return {
    signature,
    walletAddress,
    feeLamports: feeLamports.toString(),
    swapLamports: lamportsForSwap.toString(),
    solscanUrl: `https://solscan.io/tx/${signature}`,
    warnings: validation.warnings.map((w) => w.code),
  };
}

export interface SellRequest {
  supabaseUserId: string | null;
  walletAddress?: string | null;
  mint: string;
  amountRaw?: string;
  percentage?: number;
  slippageBps?: number;
}

export async function executeSell(request: SellRequest): Promise<TradeResult> {
  const tier = await getUserTier(request.supabaseUserId);
  const links = await getUserWalletLinks(request.supabaseUserId);
  const walletAddress = selectAccessibleWalletAddress(request.walletAddress ?? null, tier, links);
  const loaded = await loadManagedWallet(walletAddress);

  const mintKey = new PublicKey(request.mint);
  const ata = await getAssociatedTokenAddress(mintKey, loaded.publicKey, false);
  const tokenAccountInfo = await getAccount(connection, ata).catch(() => null);
  if (!tokenAccountInfo) {
    throw new Error('token_account_not_found');
  }
  const mintDecimals = await getMintDecimals(mintKey);
  const balanceRaw = BigInt(tokenAccountInfo.amount.toString());

  let sellRaw = request.amountRaw ? BigInt(request.amountRaw) : 0n;
  if (!sellRaw || sellRaw <= 0n) {
    const pct = request.percentage ?? 100;
    sellRaw = (balanceRaw * BigInt(Math.round(pct * 100))) / 10_000n;
    if (sellRaw <= 0n) sellRaw = balanceRaw;
  }

  const validation = validateSellRequest({
    tokenBalanceRaw: balanceRaw,
    sellRaw,
    slippageBps: request.slippageBps ?? 100,
    mint: request.mint,
  });

  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.code).join(','));
  }

  const quote = await fetchQuote({
    inputMint: request.mint,
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: sellRaw.toString(),
    slippageBps: request.slippageBps ?? 100,
    swapMode: 'ExactIn',
  });

  const swap = await fetchSwapTransaction({
    quoteResponse: quote,
    userPublicKey: loaded.publicKey.toBase58(),
    computeUnitPriceMicroLamports: 10_000,
  });

  if (!swap.swapTransaction) {
    const err = swap.error || swap.simulationError || 'swap_failed';
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }

  const signature = await submitSwapTransaction(swap.swapTransaction, loaded.keypair);

  // After swap we assume SOL increased by quote.outAmount
  const outLamports = BigInt(quote.outAmount);
  const { feeLamports } = calculateFeeLamports(outLamports, tier);
  if (feeLamports > 0n) {
    try {
      await sendLamports(loaded.keypair, TREASURY_PUBLIC_KEY, feeLamports);
    } catch (error) {
      tradeLog.warn(
        `${style.status('fee', 'warn')} ${style.kv('operation', 'executeSell')} ${style.kv('lamports', feeLamports.toString())}`,
        error
      );
    }
  }

  return {
    signature,
    walletAddress,
    feeLamports: feeLamports.toString(),
    swapLamports: sellRaw.toString(),
    solscanUrl: `https://solscan.io/tx/${signature}`,
    warnings: validation.warnings.map((w) => w.code),
  };
}

export async function previewSellAll(params: {
  supabaseUserId: string | null;
  walletAddress?: string | null;
  mint: string;
  slippageBps?: number;
}): Promise<{ expectedSol: string; warnings: string[] }> {
  const tier = await getUserTier(params.supabaseUserId);
  const links = await getUserWalletLinks(params.supabaseUserId);
  const walletAddress = selectAccessibleWalletAddress(params.walletAddress ?? null, tier, links);
  const loaded = await loadManagedWallet(walletAddress);

  const mintKey = new PublicKey(params.mint);
  const ata = await getAssociatedTokenAddress(mintKey, loaded.publicKey, false);
  const tokenAccountInfo = await getAccount(connection, ata).catch(() => null);
  if (!tokenAccountInfo) {
    throw new Error('token_account_not_found');
  }
  const balanceRaw = BigInt(tokenAccountInfo.amount.toString());
  if (balanceRaw <= 0n) {
    throw new Error('token_balance_zero');
  }

  const validation = validateSellRequest({
    tokenBalanceRaw: balanceRaw,
    sellRaw: balanceRaw,
    slippageBps: params.slippageBps ?? 100,
    mint: params.mint,
  });
  if (!validation.valid) {
    throw new Error(validation.errors.map((e) => e.code).join(','));
  }

  const quote = await fetchQuote({
    inputMint: params.mint,
    outputMint: 'So11111111111111111111111111111111111111112',
    amount: balanceRaw.toString(),
    slippageBps: params.slippageBps ?? 100,
    swapMode: 'ExactIn',
  });

  return {
    expectedSol: quote.outAmount,
    warnings: validation.warnings.map((w) => w.code),
  };
}
