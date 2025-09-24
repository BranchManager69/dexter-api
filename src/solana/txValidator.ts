import bs58 from 'bs58';

export interface ValidationMessage {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

const MIN_SOL_BUFFER_LAMPORTS = BigInt(150_000); // keep ~0.00015 SOL for fees by default
const MAX_SLIPPAGE_BPS = 500;
const MIN_SLIPPAGE_BPS = 1;

function isValidBase58(input: string): boolean {
  try {
    const decoded = bs58.decode(input);
    return decoded.length >= 32 && decoded.length <= 64;
  } catch {
    return false;
  }
}

export function validateBuyRequest(params: {
  walletBalanceLamports: bigint;
  spendLamports: bigint;
  slippageBps: number;
  mint: string;
}): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  if (!isValidBase58(params.mint)) {
    errors.push({ code: 'invalid_mint', message: 'Invalid token mint address', suggestion: 'Provide a valid Solana mint address.' });
  }

  if (params.slippageBps < MIN_SLIPPAGE_BPS || params.slippageBps > MAX_SLIPPAGE_BPS) {
    errors.push({ code: 'invalid_slippage', message: `Slippage must be between ${MIN_SLIPPAGE_BPS} and ${MAX_SLIPPAGE_BPS} bps.` });
  } else if (params.slippageBps > 200) {
    warnings.push({ code: 'high_slippage', message: 'High slippage tolerance', suggestion: 'Consider lowering slippage to reduce price impact.' });
  }

  const remaining = params.walletBalanceLamports - params.spendLamports;
  if (remaining < 0n) {
    errors.push({ code: 'insufficient_sol', message: 'Insufficient SOL balance for requested amount.' });
  } else if (remaining < MIN_SOL_BUFFER_LAMPORTS) {
    warnings.push({ code: 'low_sol_buffer', message: 'Wallet will have very little SOL remaining after this buy.', suggestion: 'Leave additional SOL for future fees.' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateSellRequest(params: {
  tokenBalanceRaw: bigint;
  sellRaw: bigint;
  slippageBps: number;
  mint: string;
}): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  if (!isValidBase58(params.mint)) {
    errors.push({ code: 'invalid_mint', message: 'Invalid token mint address', suggestion: 'Provide a valid Solana mint address.' });
  }

  if (params.slippageBps < MIN_SLIPPAGE_BPS || params.slippageBps > MAX_SLIPPAGE_BPS) {
    errors.push({ code: 'invalid_slippage', message: `Slippage must be between ${MIN_SLIPPAGE_BPS} and ${MAX_SLIPPAGE_BPS} bps.` });
  } else if (params.slippageBps > 200) {
    warnings.push({ code: 'high_slippage', message: 'High slippage tolerance', suggestion: 'Consider lowering slippage to reduce price impact.' });
  }

  if (params.sellRaw <= 0n) {
    errors.push({ code: 'invalid_amount', message: 'Sell amount must be greater than zero.' });
  } else if (params.sellRaw > params.tokenBalanceRaw) {
    errors.push({ code: 'insufficient_tokens', message: 'Insufficient token balance for requested sell amount.' });
  }

  return { valid: errors.length === 0, errors, warnings };
}
