import { URLSearchParams } from 'node:url';

const DEFAULT_LITE_HOST = 'https://lite-api.jup.ag';

const configuredApiHost = (process.env.JUPITER_API_HOST || '').trim().replace(/\/$/, '');
const JUPITER_API_HOST = configuredApiHost || DEFAULT_LITE_HOST;
const JUPITER_LITE_HOST = DEFAULT_LITE_HOST;
const JUPITER_API_KEY = (process.env.JUPITER_API_KEY || '').trim();

function buildHeaders(host: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (host.includes('api.jup.ag') && JUPITER_API_KEY) {
    headers['x-api-key'] = JUPITER_API_KEY;
  }
  return headers;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; body: any }> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {}
    return { ok: false, status: response.status, body };
  }
  return { ok: true, data: JSON.parse(text) as T };
}

function buildQuoteUrl(host: string, params: QuoteParams): string {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
  });
  if (params.slippageBps != null) qs.set('slippageBps', params.slippageBps.toString());
  if (params.onlyDirectRoutes != null) qs.set('onlyDirectRoutes', String(params.onlyDirectRoutes));
  if (params.swapMode) qs.set('swapMode', params.swapMode);
  return `${host}/swap/v1/quote?${qs.toString()}`;
}

function buildSwapUrl(host: string): string {
  return `${host}/swap/v1/swap`;
}

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number | string;
  slippageBps?: number;
  onlyDirectRoutes?: boolean;
  swapMode?: 'ExactIn' | 'ExactOut';
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct?: string;
  swapMode: 'ExactIn' | 'ExactOut';
  [key: string]: any;
}

export interface SwapRequestOptions {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  computeUnitPriceMicroLamports?: number;
  prioritizationMicroLamports?: number;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
  simulationError?: any;
  [key: string]: any;
}

function shouldRetryOnLite(result: { ok: false; status: number; body: any }): boolean {
  if (result.status === 401 || result.status === 403) return true;
  if (result.status === 400 && result.body?.message?.toString().includes('not authorized')) return true;
  return false;
}

export async function fetchQuote(params: QuoteParams): Promise<QuoteResponse> {
  const apiUrl = buildQuoteUrl(JUPITER_API_HOST, params);
  const apiAttempt = await fetchJson<QuoteResponse>(apiUrl, {
    method: 'GET',
    headers: buildHeaders(JUPITER_API_HOST),
  });
  if (apiAttempt.ok) {
    return apiAttempt.data;
  }

  if (!shouldRetryOnLite(apiAttempt)) {
    throw new Error(`jupiter_quote_failed:${apiAttempt.status}`);
  }

  const liteUrl = buildQuoteUrl(JUPITER_LITE_HOST, params);
  const liteAttempt = await fetchJson<QuoteResponse>(liteUrl, {
    method: 'GET',
    headers: buildHeaders(JUPITER_LITE_HOST),
  });
  if (!liteAttempt.ok) {
    throw new Error(`jupiter_quote_failed:${liteAttempt.status}`);
  }
  return liteAttempt.data;
}

export async function fetchSwapTransaction(options: SwapRequestOptions): Promise<SwapResponse> {
  const body = {
    quoteResponse: options.quoteResponse,
    userPublicKey: options.userPublicKey,
    wrapAndUnwrapSol: options.wrapAndUnwrapSol ?? true,
    dynamicComputeUnitLimit: options.dynamicComputeUnitLimit ?? true,
    computeUnitPriceMicroLamports: options.computeUnitPriceMicroLamports ?? options.prioritizationMicroLamports ?? 10_000,
  };

  const attempt = await fetchJson<SwapResponse>(buildSwapUrl(JUPITER_API_HOST), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildHeaders(JUPITER_API_HOST),
    },
    body: JSON.stringify(body),
  });

  if (attempt.ok) {
    return attempt.data;
  }

  if (!shouldRetryOnLite(attempt)) {
    const errorCode = attempt.body?.error ?? attempt.body?.message ?? 'swap_failed';
    throw new Error(String(errorCode));
  }

  const fallback = await fetchJson<SwapResponse>(buildSwapUrl(JUPITER_LITE_HOST), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildHeaders(JUPITER_LITE_HOST),
    },
    body: JSON.stringify(body),
  });

  if (!fallback.ok) {
    const errorCode = fallback.body?.error ?? fallback.body?.message ?? 'swap_failed';
    throw new Error(String(errorCode));
  }

  return fallback.data;
}
