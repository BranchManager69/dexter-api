import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { randomUUID } from 'crypto';
import prisma from '../prisma.js';
import { loadManagedWallet } from '../wallets/manager.js';
import { fetchQuote, fetchSwapTransaction, QuoteResponse } from './jupiter.js';
import { validateBuyRequest, validateSellRequest } from './txValidator.js';
import { resolveTokenByQuery, ResolvedTokenItem } from './tokenResolver.js';
import { logger, style } from '../logger.js';

const RPC_URL = (process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com').trim();
const connection = new Connection(RPC_URL, 'confirmed');

const TREASURY_ADDRESS = (process.env.DEXTER_SOLANA_TREASURY || '').trim();
const TREASURY_PUBLIC_KEY = TREASURY_ADDRESS ? new PublicKey(TREASURY_ADDRESS) : null;

// Platform fees are deprecated in favour of Jupiter's referral billing – keep zero to avoid
// double-billing users. (2025-10-04)
const FEE_BPS_FREE = 0;
const FEE_BPS_PRO = 0;
const MAX_WALLETS_PRO = 10;
const tradeLog = logger.child('solana.trade');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

const JUPITER_PRICE_ENDPOINT = 'https://price.jup.ag/v6/price';

function isSolMintAddress(mint: string): boolean {
  const normalized = mint?.trim();
  if (!normalized) return false;
  if (normalized === 'native:SOL') return true;
  return normalized.toLowerCase() === SOL_MINT.toLowerCase();
}

function normalizeMintAddress(mint: string): string {
  if (isSolMintAddress(mint)) return SOL_MINT;
  const trimmed = mint?.trim();
  if (!trimmed) {
    throw new Error('mint_required');
  }
  return trimmed;
}

function coerceUiAmount(value: string | number): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid_amount');
    return value.toString();
  }
  const trimmed = (value ?? '').toString().trim();
  if (!trimmed) {
    throw new Error('invalid_amount');
  }
  return trimmed;
}

function uiAmountToRaw(amountUi: string | number, decimals: number): bigint {
  const normalized = coerceUiAmount(amountUi);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) {
    throw new Error('invalid_amount');
  }
  const [wholePart, fractionPart = ''] = normalized.split('.');
  const paddedFraction = (fractionPart + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${wholePart}${decimals > 0 ? paddedFraction : ''}`;
  return BigInt(combined || '0');
}

function rawAmountToUi(raw: bigint, decimals: number): string {
  if (decimals === 0) {
    return raw.toString();
  }
  const rawStr = raw.toString();
  const padded = rawStr.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  let fraction = padded.slice(-decimals);
  fraction = fraction.replace(/0+$/, '');
  return fraction.length ? `${whole}.${fraction}` : whole;
}

export type UserTier = 'free' | 'pro';

export interface UserWalletLink {
  walletAddress: string;
  isDefault: boolean;
}

async function fetchTokenPricesUsd(mints: string[]): Promise<Map<string, number>> {
  const unique = Array.from(
    new Set(
      mints
        .map((mint) => mint?.trim())
        .filter((mint): mint is string => Boolean(mint) && mint !== 'native:SOL'),
    ),
  );
  const map = new Map<string, number>();
  if (!unique.length) return map;

  try {
    const url = `${JUPITER_PRICE_ENDPOINT}?ids=${unique.join(',')}`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return map;
    const json = await response.json();
    const data = json?.data || {};
    for (const mint of unique) {
      const entry = data[mint];
      if (entry && typeof entry.price === 'number' && Number.isFinite(entry.price)) {
        map.set(mint, entry.price);
      }
    }
  } catch (error) {
    tradeLog.warn(`${style.status('price', 'warn')} ${style.kv('event', 'jupiter_price_fetch_failed')}`, error);
  }
  return map;
}

type SwapDirection = 'SOL_TO_TOKEN' | 'TOKEN_TO_SOL';

type ExtendedSwapDirection = SwapDirection | 'TOKEN_TO_TOKEN';

class SwapError extends Error {
  code: string;
  details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'SwapError';
    this.code = code;
    this.details = details;
  }
}

export interface SwapPreviewRequest {
  supabaseUserId: string | null;
  walletAddress?: string | null;
  inputMint: string;
  outputMint: string;
  amountUi?: string | number;
  desiredOutputUi?: string | number;
  slippageBps?: number;
  mode: 'ExactIn' | 'ExactOut';
}

export interface SwapAmountBreakdown {
  mint: string;
  amountRaw: string;
  amountUi: string;
  decimals: number;
}

export interface SwapPreviewResult {
  walletAddress: string;
  direction: ExtendedSwapDirection;
  mode: 'ExactIn' | 'ExactOut';
  input: SwapAmountBreakdown & {
    effectiveAmountRaw: string;
    effectiveAmountUi: string;
  };
  output: SwapAmountBreakdown;
  netOutput: SwapAmountBreakdown;
  fee: SwapAmountBreakdown | null;
  quote: QuoteResponse;
  warnings: string[];
  priceImpactPct: number | null;
  otherAmountThreshold: string;
  valuations: {
    inputUsd: number | null;
    outputUsd: number | null;
    netOutputUsd: number | null;
  };
}

export interface SwapExecuteResult extends SwapPreviewResult {
  signature: string;
  solscanUrl: string;
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
  void tier; // platform fee temporarily disabled – see note above.
  return { feeLamports: 0n, swapLamports: amountLamports };
}

interface SwapContext {
  tier: UserTier;
  walletAddress: string;
  walletPublicKey: PublicKey;
  loadedWallet?: Awaited<ReturnType<typeof loadManagedWallet>>;
  inputMint: string;
  outputMint: string;
  direction: ExtendedSwapDirection;
  inputDecimals: number;
  outputDecimals: number;
  inputAmountRaw: bigint;
  swapAmountRaw: bigint;
  desiredOutputRaw?: bigint;
  preSwapFeeLamports: bigint;
  slippageBps: number;
  validationWarnings: string[];
  balanceLamports?: bigint;
  tokenBalanceRaw?: bigint;
  swapMode: 'ExactIn' | 'ExactOut';
}

interface SwapQuoteContext extends SwapContext {
  quote: QuoteResponse;
  outAmountRaw: bigint;
  netOutAmountRaw: bigint;
  postSwapFeeLamports: bigint;
  priceMap: Map<string, number>;
  resolvedInputRaw: bigint;
  targetOutputRaw: bigint;
}

async function prepareSwapContext(
  request: SwapPreviewRequest,
  options: { requireLoadedWallet?: boolean } = {},
): Promise<SwapContext> {
  const slippageBps = request.slippageBps != null ? Number(request.slippageBps) : 100;
  if (!Number.isFinite(slippageBps) || slippageBps <= 0) {
    throw new SwapError('invalid_slippage', 'Slippage must be a positive number.');
  }

  if (!request.mode) {
    throw new SwapError('mode_required', 'mode must be provided (ExactIn or ExactOut).');
  }

  const tier = await getUserTier(request.supabaseUserId);
  const links = await getUserWalletLinks(request.supabaseUserId);
  const walletAddress = selectAccessibleWalletAddress(request.walletAddress ?? null, tier, links);
  const walletPublicKey = new PublicKey(walletAddress);
  const loadedWallet = options.requireLoadedWallet ? await loadManagedWallet(walletAddress) : undefined;

  const inputMint = normalizeMintAddress(request.inputMint);
  const outputMint = normalizeMintAddress(request.outputMint);
  if (inputMint === outputMint) {
    throw new SwapError('identical_mints', 'Input and output mint must differ.');
  }

  const inputIsSol = isSolMintAddress(inputMint);
  const outputIsSol = isSolMintAddress(outputMint);

  let direction: ExtendedSwapDirection;
  if (inputIsSol && !outputIsSol) {
    direction = 'SOL_TO_TOKEN';
  } else if (!inputIsSol && outputIsSol) {
    direction = 'TOKEN_TO_SOL';
  } else if (!inputIsSol && !outputIsSol) {
    direction = 'TOKEN_TO_TOKEN';
  } else {
    throw new SwapError('unsupported_pair', 'Unsupported mint combination.');
  }
  const inputDecimals = inputIsSol ? 9 : await getMintDecimals(new PublicKey(inputMint));
  const outputDecimals = outputIsSol ? 9 : await getMintDecimals(new PublicKey(outputMint));

  const swapMode: 'ExactIn' | 'ExactOut' = request.mode;

  let inputAmountRaw = 0n;
  let swapAmountRaw = 0n;
  let desiredOutputRaw: bigint | undefined;
  let preSwapFeeLamports = 0n;
  let validationWarnings: string[] = [];
  let balanceLamports: bigint | undefined;
  let tokenBalanceRaw: bigint | undefined;

  if (swapMode === 'ExactIn') {
    if (request.amountUi == null) {
      throw new SwapError('amount_required', 'amountUi is required for ExactIn swaps.');
    }
    inputAmountRaw = uiAmountToRaw(request.amountUi, inputDecimals);
    if (inputAmountRaw <= 0n) {
      throw new SwapError('invalid_amount', 'Swap amount must be greater than zero.');
    }
    swapAmountRaw = inputAmountRaw;
  } else {
    const desired = request.desiredOutputUi;
    if (desired == null) {
      throw new SwapError('desired_output_required', 'desiredOutputUi is required for ExactOut swaps.');
    }
    desiredOutputRaw = uiAmountToRaw(desired, outputDecimals);
    if (desiredOutputRaw <= 0n) {
      throw new SwapError('invalid_amount', 'Swap amount must be greater than zero.');
    }
    swapAmountRaw = desiredOutputRaw;
  }

  if (direction === 'SOL_TO_TOKEN') {
    balanceLamports = BigInt(await connection.getBalance(walletPublicKey, 'confirmed'));
    const { feeLamports, swapLamports } = calculateFeeLamports(
      swapMode === 'ExactIn' ? inputAmountRaw : swapAmountRaw,
      tier,
    );
    preSwapFeeLamports = feeLamports;
    if (swapMode === 'ExactIn') {
      swapAmountRaw = swapLamports;
      const validation = validateBuyRequest({
        walletBalanceLamports: balanceLamports,
        spendLamports: inputAmountRaw,
        slippageBps,
        mint: outputMint,
      });
      validationWarnings = validation.warnings.map((w) => w.code);
      if (!validation.valid) {
        throw new SwapError('validation_failed', validation.errors.map((e) => e.code).join(','), {
          errors: validation.errors,
        });
      }
    }
  } else {
    const mintKey = new PublicKey(inputMint);
    const ata = await getAssociatedTokenAddress(mintKey, walletPublicKey, false);
    const tokenAccountInfo = await getAccount(connection, ata).catch(() => null);
    if (!tokenAccountInfo) {
      throw new SwapError('token_account_not_found', 'Token account not found for requested mint.');
    }
    tokenBalanceRaw = BigInt(tokenAccountInfo.amount.toString());
    if (tokenBalanceRaw <= 0n) {
      throw new SwapError('token_balance_zero', 'Token balance is zero.');
    }
    if (swapMode === 'ExactIn' && inputAmountRaw > tokenBalanceRaw) {
      throw new SwapError('insufficient_balance', 'Insufficient token balance for swap.', {
        requiredRaw: inputAmountRaw.toString(),
        requiredUi: rawAmountToUi(inputAmountRaw, inputDecimals),
        availableRaw: tokenBalanceRaw.toString(),
        availableUi: rawAmountToUi(tokenBalanceRaw, inputDecimals),
        mint: inputMint,
      });
    }
    if (swapMode === 'ExactIn') {
      const validation = validateSellRequest({
        tokenBalanceRaw,
        sellRaw: inputAmountRaw,
        slippageBps,
        mint: inputMint,
      });
      validationWarnings = validation.warnings.map((w) => w.code);
      if (!validation.valid) {
        throw new SwapError('validation_failed', validation.errors.map((e) => e.code).join(','), {
          errors: validation.errors,
        });
      }
    }
  }

  return {
    tier,
    walletAddress,
    walletPublicKey,
    loadedWallet,
    inputMint,
    outputMint,
    direction,
    inputDecimals,
    outputDecimals,
    inputAmountRaw,
    swapAmountRaw,
    desiredOutputRaw,
    preSwapFeeLamports,
    slippageBps,
    validationWarnings,
    balanceLamports,
    tokenBalanceRaw,
    swapMode,
  };
}

async function buildSwapQuote(
  request: SwapPreviewRequest,
  options: { requireLoadedWallet?: boolean } = {},
): Promise<SwapQuoteContext> {
  const context = await prepareSwapContext(request, options);

  const quoteAmountRaw = context.swapMode === 'ExactIn'
    ? context.swapAmountRaw
    : (context.desiredOutputRaw ?? 0n);
  if (context.swapMode === 'ExactOut' && quoteAmountRaw <= 0n) {
    throw new Error('invalid_amount');
  }

  const quote = await fetchQuote({
    inputMint: context.inputMint,
    outputMint: context.outputMint,
    amount: quoteAmountRaw.toString(),
    slippageBps: context.slippageBps,
    swapMode: context.swapMode,
  });

  const outAmountRaw = BigInt(quote.outAmount);
  if (outAmountRaw <= 0n) {
    throw new SwapError('quote_out_zero', 'Quote produced no output.');
  }

  const resolvedInputRaw = context.swapMode === 'ExactOut'
    ? BigInt(quote.inAmount)
    : context.inputAmountRaw;

  let updatedWarnings = [...context.validationWarnings];

  if (context.direction === 'SOL_TO_TOKEN') {
      const balance = context.balanceLamports ?? BigInt(await connection.getBalance(context.walletPublicKey, 'confirmed'));
      if (resolvedInputRaw > balance) {
        throw new SwapError('insufficient_balance', 'Insufficient SOL balance for swap.', {
          requiredRaw: resolvedInputRaw.toString(),
          requiredUi: rawAmountToUi(resolvedInputRaw, 9),
          availableRaw: balance.toString(),
          availableUi: rawAmountToUi(balance, 9),
          mint: SOL_MINT,
        });
      }
    const validation = validateBuyRequest({
      walletBalanceLamports: balance,
      spendLamports: resolvedInputRaw,
      slippageBps: context.slippageBps,
      mint: context.outputMint,
    });
    updatedWarnings = [...new Set([...updatedWarnings, ...validation.warnings.map((w) => w.code)])];
    if (!validation.valid) {
      throw new SwapError('validation_failed', validation.errors.map((e) => e.code).join(','), {
        errors: validation.errors,
      });
    }
  } else {
    const balance = context.tokenBalanceRaw ?? (() => {
      throw new SwapError('token_balance_unknown', 'Token balance not available.');
    })();
    if (resolvedInputRaw > balance) {
      const decimals = context.inputDecimals;
      throw new SwapError('insufficient_balance', 'Insufficient token balance for swap.', {
        requiredRaw: resolvedInputRaw.toString(),
        requiredUi: rawAmountToUi(resolvedInputRaw, decimals),
        availableRaw: balance.toString(),
        availableUi: rawAmountToUi(balance, decimals),
        mint: context.inputMint,
      });
    }
    const validation = validateSellRequest({
      tokenBalanceRaw: balance,
      sellRaw: resolvedInputRaw,
      slippageBps: context.slippageBps,
      mint: context.inputMint,
    });
    updatedWarnings = [...new Set([...updatedWarnings, ...validation.warnings.map((w) => w.code)])];
    if (!validation.valid) {
      throw new SwapError('validation_failed', validation.errors.map((e) => e.code).join(','), {
        errors: validation.errors,
      });
    }
  }

  let postSwapFeeLamports = 0n;
  let netOutAmountRaw = outAmountRaw;

  if (context.direction === 'TOKEN_TO_SOL') {
    const feeInfo = calculateFeeLamports(outAmountRaw, context.tier);
    postSwapFeeLamports = feeInfo.feeLamports;
    netOutAmountRaw = feeInfo.swapLamports;
  }

  if (netOutAmountRaw <= 0n) {
    throw new SwapError('amount_too_small_for_fee', 'Amount too small after fees.');
  }

  const targetOutputRaw = context.swapMode === 'ExactOut'
    ? (context.desiredOutputRaw ?? outAmountRaw)
    : outAmountRaw;

  const priceKeys = [context.inputMint, context.outputMint];
  const priceMap = await fetchTokenPricesUsd(priceKeys);
  const solPrice = priceMap.get(SOL_MINT);
  if (isSolMintAddress(context.inputMint) && solPrice != null) {
    priceMap.set(context.inputMint, solPrice);
  }
  if (isSolMintAddress(context.outputMint) && solPrice != null) {
    priceMap.set(context.outputMint, solPrice);
  }

  return {
    ...context,
    quote,
    outAmountRaw,
    netOutAmountRaw,
    postSwapFeeLamports,
    priceMap,
    resolvedInputRaw,
    targetOutputRaw,
    validationWarnings: updatedWarnings,
  };
}

function formatSwapResult(context: SwapQuoteContext): SwapPreviewResult {
  const inputAmountUi = rawAmountToUi(context.resolvedInputRaw, context.inputDecimals);
  const effectiveInputRaw = context.swapMode === 'ExactOut' ? context.resolvedInputRaw : context.swapAmountRaw;
  const effectiveInputUi = rawAmountToUi(effectiveInputRaw, context.inputDecimals);
  const outputAmountUi = rawAmountToUi(context.outAmountRaw, context.outputDecimals);
  const netOutputAmountUi = rawAmountToUi(context.netOutAmountRaw, context.outputDecimals);
  const feeLamports = context.direction === 'SOL_TO_TOKEN' ? context.preSwapFeeLamports : context.postSwapFeeLamports;
  const fee = feeLamports > 0n
    ? {
        mint: SOL_MINT,
        amountRaw: feeLamports.toString(),
        amountUi: rawAmountToUi(feeLamports, 9),
        decimals: 9,
      }
    : null;

  const priceImpact = (() => {
    const value = context.quote.priceImpactPct;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  })();

  const computeUsd = (mint: string, amountUiStr: string): number | null => {
    const price = context.priceMap.get(mint);
    const amount = Number(amountUiStr);
    if (price == null || !Number.isFinite(price) || !Number.isFinite(amount)) return null;
    return price * amount;
  };

  const inputUsd = computeUsd(context.inputMint, inputAmountUi);
  const outputUsd = computeUsd(context.outputMint, outputAmountUi);
  const netOutputUsd = computeUsd(context.outputMint, netOutputAmountUi);

  return {
    walletAddress: context.walletAddress,
    direction: context.direction,
    mode: context.swapMode,
    input: {
      mint: context.inputMint,
      amountRaw: context.resolvedInputRaw.toString(),
      amountUi: inputAmountUi,
      decimals: context.inputDecimals,
      effectiveAmountRaw: effectiveInputRaw.toString(),
      effectiveAmountUi: effectiveInputUi,
    },
    output: {
      mint: context.outputMint,
      amountRaw: context.outAmountRaw.toString(),
      amountUi: outputAmountUi,
      decimals: context.outputDecimals,
    },
    netOutput: {
      mint: context.outputMint,
      amountRaw: context.netOutAmountRaw.toString(),
      amountUi: netOutputAmountUi,
      decimals: context.outputDecimals,
    },
    fee,
    quote: context.quote,
    warnings: context.validationWarnings,
    priceImpactPct: priceImpact,
    otherAmountThreshold: context.quote.otherAmountThreshold,
    valuations: {
      inputUsd,
      outputUsd,
      netOutputUsd,
    },
  };
}

export async function previewSwap(request: SwapPreviewRequest): Promise<SwapPreviewResult> {
  const context = await buildSwapQuote(request);
  return formatSwapResult(context);
}

export async function executeSwap(request: SwapPreviewRequest): Promise<SwapExecuteResult> {
  const tradeId = randomUUID();
  const startedAt = Date.now();
  let resolvedWallet = request.walletAddress ?? null;

  tradeLog.info({
    event: 'swap.start',
    tradeId,
    supabaseUserId: request.supabaseUserId ?? null,
    walletAddress: resolvedWallet,
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    mode: request.mode ?? 'ExactIn',
    amountUi: request.amountUi ?? null,
    desiredOutputUi: request.desiredOutputUi ?? null,
    slippageBps: request.slippageBps ?? 100,
  });

  try {
    const context = await buildSwapQuote(request, { requireLoadedWallet: true });
    if (!context.loadedWallet) {
      throw new Error('wallet_load_failed');
    }
    resolvedWallet = context.walletAddress ?? context.loadedWallet.publicKey.toBase58();

    const swap = await fetchSwapTransaction({
      quoteResponse: context.quote,
      userPublicKey: context.loadedWallet.publicKey.toBase58(),
      computeUnitPriceMicroLamports: 10_000,
    });

    if (!swap.swapTransaction) {
      const err = swap.error || swap.simulationError || 'swap_failed';
      throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
    }

    const signature = await submitSwapTransaction(swap.swapTransaction, context.loadedWallet.keypair);

    const feeLamports = context.direction === 'SOL_TO_TOKEN' ? context.preSwapFeeLamports : context.postSwapFeeLamports;
    if (feeLamports > 0n && TREASURY_PUBLIC_KEY) {
      try {
        await sendLamports(context.loadedWallet.keypair, TREASURY_PUBLIC_KEY, feeLamports);
      } catch (error) {
        tradeLog.warn(
          `${style.status('fee', 'warn')} ${style.kv('operation', 'swap')} ${style.kv('lamports', feeLamports.toString())}`,
          error,
        );
      }
    }

    const base = formatSwapResult(context);
    const result: SwapExecuteResult = {
      ...base,
      signature,
      solscanUrl: `https://solscan.io/tx/${signature}`,
    };

    tradeLog.info({
      event: 'swap.success',
      tradeId,
      walletAddress: result.walletAddress,
      signature: result.signature,
      direction: result.direction,
      mode: result.mode,
      priceImpactPct: result.priceImpactPct ?? null,
      warnings: result.warnings,
      durationMs: Date.now() - startedAt,
    });

    return result;
  } catch (error: any) {
    tradeLog.error({
      event: 'swap.failure',
      tradeId,
      walletAddress: resolvedWallet,
      supabaseUserId: request.supabaseUserId ?? null,
      message: error?.message || String(error),
      code: error?.code,
      details: error?.details,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
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
  ata: string | null;
  amountRaw: string;
  amountUi: number;
  decimals: number;
  isNative?: boolean;
}

export async function listTokenBalances(options: { walletPublicKey: PublicKey; minimumUi?: number; limit?: number }): Promise<TokenBalanceItem[]> {
  const items: TokenBalanceItem[] = [];

  const lamports = await connection.getBalance(options.walletPublicKey, 'confirmed');
  const solAmount = lamports / LAMPORTS_PER_SOL;
  const minUi = options.minimumUi ?? 0;
  if (solAmount > minUi) {
    items.push({
      mint: 'native:SOL',
      ata: null,
      amountRaw: String(lamports),
      amountUi: solAmount,
      decimals: 9,
      isNative: true,
    });
  }

  const splAccounts = await connection.getParsedTokenAccountsByOwner(options.walletPublicKey, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') });
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
  const tradeId = randomUUID();
  const startedAt = Date.now();
  const slippageBps = request.slippageBps ?? 100;
  let walletAddress: string | null = request.walletAddress ?? null;

  tradeLog.info({
    event: 'buy.start',
    tradeId,
    supabaseUserId: request.supabaseUserId ?? null,
    walletAddress,
    mint: request.mint,
    amountSol: request.amountSol,
    slippageBps,
  });

  try {
    const tier = await getUserTier(request.supabaseUserId);
    const links = await getUserWalletLinks(request.supabaseUserId);
    walletAddress = selectAccessibleWalletAddress(request.walletAddress ?? null, tier, links);
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
      slippageBps,
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
      slippageBps,
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

    if (feeLamports > 0n && TREASURY_PUBLIC_KEY) {
      try {
        await sendLamports(loaded.keypair, TREASURY_PUBLIC_KEY, feeLamports);
      } catch (error) {
        tradeLog.warn(
          `${style.status('fee', 'warn')} ${style.kv('operation', 'executeBuy')} ${style.kv('lamports', feeLamports.toString())}`,
          error
        );
      }
    }

    const result: TradeResult = {
      signature,
      walletAddress,
      feeLamports: feeLamports.toString(),
      swapLamports: lamportsForSwap.toString(),
      solscanUrl: `https://solscan.io/tx/${signature}`,
      warnings: validation.warnings.map((w) => w.code),
    };

    tradeLog.info({
      event: 'buy.success',
      tradeId,
      walletAddress,
      signature: result.signature,
      durationMs: Date.now() - startedAt,
      warnings: result.warnings,
      solscanUrl: result.solscanUrl,
    });

    return result;
  } catch (error: any) {
    tradeLog.error({
      event: 'buy.failure',
      tradeId,
      walletAddress,
      supabaseUserId: request.supabaseUserId ?? null,
      message: error?.message || String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
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
  const tradeId = randomUUID();
  const startedAt = Date.now();
  const slippageBps = request.slippageBps ?? 100;
  let walletAddress: string | null = request.walletAddress ?? null;

  tradeLog.info({
    event: 'sell.start',
    tradeId,
    supabaseUserId: request.supabaseUserId ?? null,
    walletAddress,
    mint: request.mint,
    amountRaw: request.amountRaw ?? null,
    percentage: request.percentage ?? null,
    slippageBps,
  });

  try {
    const tier = await getUserTier(request.supabaseUserId);
    const links = await getUserWalletLinks(request.supabaseUserId);
    walletAddress = selectAccessibleWalletAddress(request.walletAddress ?? null, tier, links);
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
      slippageBps,
      mint: request.mint,
    });

    if (!validation.valid) {
      throw new Error(validation.errors.map((e) => e.code).join(','));
    }

    const quote = await fetchQuote({
      inputMint: request.mint,
      outputMint: 'So11111111111111111111111111111111111111112',
      amount: sellRaw.toString(),
      slippageBps,
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
    if (feeLamports > 0n && TREASURY_PUBLIC_KEY) {
      try {
        await sendLamports(loaded.keypair, TREASURY_PUBLIC_KEY, feeLamports);
      } catch (error) {
        tradeLog.warn(
          `${style.status('fee', 'warn')} ${style.kv('operation', 'executeSell')} ${style.kv('lamports', feeLamports.toString())}`,
          error
        );
      }
    }

    const result: TradeResult = {
      signature,
      walletAddress,
      feeLamports: feeLamports.toString(),
      swapLamports: sellRaw.toString(),
      solscanUrl: `https://solscan.io/tx/${signature}`,
      warnings: validation.warnings.map((w) => w.code),
    };

    tradeLog.info({
      event: 'sell.success',
      tradeId,
      walletAddress,
      signature: result.signature,
      durationMs: Date.now() - startedAt,
      warnings: result.warnings,
      solscanUrl: result.solscanUrl,
    });

    return result;
  } catch (error: any) {
    tradeLog.error({
      event: 'sell.failure',
      tradeId,
      walletAddress,
      supabaseUserId: request.supabaseUserId ?? null,
      message: error?.message || String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
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
