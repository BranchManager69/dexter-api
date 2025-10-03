const DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search';
const MAX_PAIR_SUMMARIES = 5;

export interface VolumeBreakdown {
  m5?: number;
  h1?: number;
  h6?: number;
  h24?: number;
}

export interface TxnBreakdown {
  m5?: { buys: number; sells: number };
  h1?: { buys: number; sells: number };
  h6?: { buys: number; sells: number };
  h24?: { buys: number; sells: number };
}

export interface ResolvedTokenInfo {
  imageUrl?: string | null;
  headerImageUrl?: string | null;
  openGraphImageUrl?: string | null;
  websites?: { label?: string | null; url: string }[];
  socials?: { type?: string | null; url: string }[];
}

export interface ResolvedTokenPairSummary {
  dexId: string | null;
  pairAddress: string | null;
  labels: string[];
  liquidity: {
    usd: number | null;
    base?: number | null;
    quote?: number | null;
  };
  priceUsd?: number;
  priceNative?: number;
  marketCap?: number;
  fdv?: number;
  volume?: VolumeBreakdown;
  priceChange?: VolumeBreakdown;
  txns?: TxnBreakdown;
  url?: string | null;
  info?: {
    imageUrl?: string | null;
    header?: string | null;
    openGraph?: string | null;
  };
}

export interface ResolvedTokenItem {
  address: string;
  symbol: string;
  name: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  totalVolume: VolumeBreakdown;
  priceUsd?: number;
  priceNative?: number;
  priceChange?: VolumeBreakdown;
  marketCap?: number;
  fdv?: number;
  info?: ResolvedTokenInfo;
  pairs: ResolvedTokenPairSummary[];
}

interface InternalTokenAccumulator extends ResolvedTokenItem {
  score: number;
  primaryPairLiquidity: number;
}

function parseNumber(input: any): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function mergeVolume(base: VolumeBreakdown, delta: VolumeBreakdown | undefined): VolumeBreakdown {
  if (!delta) return base;
  const out: VolumeBreakdown = { ...base };
  for (const key of ['m5', 'h1', 'h6', 'h24'] as const) {
    const existing = out[key] ?? 0;
    const addition = delta[key];
    if (typeof addition === 'number' && Number.isFinite(addition)) {
      out[key] = existing + addition;
    }
  }
  return out;
}

function normalisePriceChange(input: any): VolumeBreakdown | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const result: VolumeBreakdown = {};
  for (const key of ['m5', 'h1', 'h6', 'h24'] as const) {
    const value = parseNumber(input[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normaliseVolume(input: any): VolumeBreakdown | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const result: VolumeBreakdown = {};
  for (const key of ['m5', 'h1', 'h6', 'h24'] as const) {
    const value = parseNumber(input[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normaliseTxns(input: any): TxnBreakdown | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const result: TxnBreakdown = {};
  for (const key of ['m5', 'h1', 'h6', 'h24'] as const) {
    const bucket = input[key];
    const buys = parseNumber(bucket?.buys);
    const sells = parseNumber(bucket?.sells);
    if (buys !== undefined || sells !== undefined) {
      (result as any)[key] = {
        buys: buys ?? 0,
        sells: sells ?? 0,
      };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normaliseTokenInfo(info: any): ResolvedTokenInfo | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const result: ResolvedTokenInfo = {};
  if (info.imageUrl) result.imageUrl = String(info.imageUrl);
  if (info.header) result.headerImageUrl = String(info.header);
  if (info.openGraph) result.openGraphImageUrl = String(info.openGraph);
  if (Array.isArray(info.websites)) {
    const websites = info.websites
      .map((site: any) => {
        if (!site?.url) return null;
        return {
          label: site?.label ?? null,
          url: String(site.url),
        };
      })
      .filter(Boolean) as { label?: string | null; url: string }[];
    if (websites.length) result.websites = websites;
  }
  if (Array.isArray(info.socials)) {
    const socials = info.socials
      .map((social: any) => {
        if (!social?.url) return null;
        return {
          type: social?.type ?? null,
          url: String(social.url),
        };
      })
      .filter(Boolean) as { type?: string | null; url: string }[];
    if (socials.length) result.socials = socials;
  }
  return Object.keys(result).length ? result : undefined;
}

function mergeTokenInfo(base: ResolvedTokenInfo | undefined, incoming: ResolvedTokenInfo | undefined): ResolvedTokenInfo | undefined {
  if (!incoming) return base;
  if (!base) return { ...incoming };
  const merged: ResolvedTokenInfo = { ...base };
  if (incoming.imageUrl && !merged.imageUrl) merged.imageUrl = incoming.imageUrl;
  if (incoming.headerImageUrl && !merged.headerImageUrl) merged.headerImageUrl = incoming.headerImageUrl;
  if (incoming.openGraphImageUrl && !merged.openGraphImageUrl) merged.openGraphImageUrl = incoming.openGraphImageUrl;
  if (incoming.websites?.length) {
    const existingUrls = new Set((merged.websites || []).map((site) => site.url));
    merged.websites = [...(merged.websites || [])];
    for (const site of incoming.websites) {
      if (!existingUrls.has(site.url)) {
        merged.websites.push(site);
        existingUrls.add(site.url);
      }
    }
  }
  if (incoming.socials?.length) {
    const existingUrls = new Set((merged.socials || []).map((item) => item.url));
    merged.socials = [...(merged.socials || [])];
    for (const social of incoming.socials) {
      if (!existingUrls.has(social.url)) {
        merged.socials.push(social);
        existingUrls.add(social.url);
      }
    }
  }
  return merged;
}

export async function resolveTokenByQuery(query: string, limit = 5): Promise<ResolvedTokenItem[]> {
  const url = `${DEXSCREENER_SEARCH}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`dexscreener_error:${response.status}`);
  }
  const data = await response.json();
  const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : [];

  const tokensMap = new Map<string, InternalTokenAccumulator>();
  const target = query.trim().toUpperCase();

  for (const pair of pairs) {
    if ((pair?.chainId || '').toLowerCase() !== 'solana') continue;
    const base = pair?.baseToken;
    if (!base?.address) continue;

    const liquidityUsd = parseNumber(pair?.liquidity?.usd) ?? 0;
    const liquidityBase = parseNumber(pair?.liquidity?.base) ?? null;
    const liquidityQuote = parseNumber(pair?.liquidity?.quote) ?? null;
    const priceUsd = parseNumber(pair?.priceUsd);
    const priceNative = parseNumber(pair?.priceNative);
    const marketCap = parseNumber(pair?.marketCap);
    const fdv = parseNumber(pair?.fdv);
    const volumeBuckets = normaliseVolume(pair?.volume);
    const priceChangeBuckets = normalisePriceChange(pair?.priceChange);
    const txns = normaliseTxns(pair?.txns);
    const info = normaliseTokenInfo(pair?.info);

    const existing = tokensMap.get(base.address) ?? {
      address: base.address,
      symbol: (base.symbol || '').toUpperCase(),
      name: base.name || null,
      liquidityUsd: 0,
      volume24hUsd: 0,
      totalVolume: {},
      priceUsd,
      priceNative,
      priceChange: priceChangeBuckets,
      marketCap,
      fdv,
      info,
      pairs: [] as ResolvedTokenPairSummary[],
      score: 0,
      primaryPairLiquidity: liquidityUsd,
    } as InternalTokenAccumulator;

    existing.liquidityUsd += liquidityUsd;
    if (volumeBuckets && volumeBuckets.h24 !== undefined) {
      existing.volume24hUsd += volumeBuckets.h24;
    } else {
      const fallbackVolume24h = parseNumber(pair?.volume?.h24);
      if (fallbackVolume24h !== undefined) existing.volume24hUsd += fallbackVolume24h;
    }
    existing.totalVolume = mergeVolume(existing.totalVolume, volumeBuckets);

    const incomingInfo = info;
    existing.info = mergeTokenInfo(existing.info, incomingInfo);

    const isPrimaryPair = liquidityUsd > existing.primaryPairLiquidity;
    if (isPrimaryPair) {
      existing.primaryPairLiquidity = liquidityUsd;
      if (priceUsd !== undefined) existing.priceUsd = priceUsd;
      if (priceNative !== undefined) existing.priceNative = priceNative;
      if (priceChangeBuckets) existing.priceChange = priceChangeBuckets;
      if (marketCap !== undefined) existing.marketCap = marketCap;
      if (fdv !== undefined) existing.fdv = fdv;
    } else {
      if (priceUsd !== undefined && existing.priceUsd === undefined) existing.priceUsd = priceUsd;
      if (priceNative !== undefined && existing.priceNative === undefined) existing.priceNative = priceNative;
      if (!existing.priceChange && priceChangeBuckets) existing.priceChange = priceChangeBuckets;
      if (existing.marketCap === undefined && marketCap !== undefined) existing.marketCap = marketCap;
      if (existing.fdv === undefined && fdv !== undefined) existing.fdv = fdv;
    }

    if (existing.pairs.length < MAX_PAIR_SUMMARIES) {
      existing.pairs.push({
        dexId: pair?.dexId ?? null,
        pairAddress: pair?.pairAddress ?? null,
        labels: Array.isArray(pair?.labels) ? pair.labels.map((label: any) => String(label)) : [],
        liquidity: {
          usd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
          base: liquidityBase,
          quote: liquidityQuote,
        },
        priceUsd,
        priceNative,
        marketCap,
        fdv,
        volume: volumeBuckets,
        priceChange: priceChangeBuckets,
        txns,
        url: pair?.url ?? null,
        info: pair?.info
          ? {
              imageUrl: pair.info.imageUrl ?? null,
              header: pair.info.header ?? null,
              openGraph: pair.info.openGraph ?? null,
            }
          : undefined,
      });
    }

    const symbolMatch = existing.symbol === target ? 1 : existing.symbol.includes(target) ? 0.5 : 0;
    const liquidityScore = Math.log10(1 + existing.liquidityUsd) * 20;
    const volumeScore = Math.log10(1 + existing.volume24hUsd) * 10;
    const marketCapScore = existing.marketCap ? Math.log10(1 + existing.marketCap) * 5 : 0;
    existing.score = liquidityScore + volumeScore + marketCapScore + symbolMatch * 400;

    tokensMap.set(base.address, existing);
  }

  const ranked = Array.from(tokensMap.values())
    .filter((item) => item.liquidityUsd > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, primaryPairLiquidity, ...rest }) => rest);

  return ranked;
}
