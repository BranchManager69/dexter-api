const DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search';

export interface ResolvedTokenPairSummary {
  dexId: string | null;
  pairAddress: string | null;
  liquidityUsd: number;
  priceUsd?: number;
  url?: string | null;
}

export interface ResolvedTokenItem {
  address: string;
  symbol: string;
  name: string | null;
  liquidityUsd: number;
  volume24hUsd: number;
  priceUsd?: number;
  pairs: ResolvedTokenPairSummary[];
}

export async function resolveTokenByQuery(query: string, limit = 5): Promise<ResolvedTokenItem[]> {
  const url = `${DEXSCREENER_SEARCH}?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`dexscreener_error:${response.status}`);
  }
  const data = await response.json();
  const pairs: any[] = Array.isArray(data?.pairs) ? data.pairs : [];

  const tokensMap = new Map<string, ResolvedTokenItem & { score: number }>();
  const target = query.trim().toUpperCase();

  for (const pair of pairs) {
    if ((pair?.chainId || '').toLowerCase() !== 'solana') continue;
    const base = pair?.baseToken;
    if (!base?.address) continue;

    const liquidityUsd = Number(pair?.liquidity?.usd || 0);
    const volume24h = Number(pair?.volume?.h24 || 0);
    const priceUsd = pair?.priceUsd ? Number(pair.priceUsd) : undefined;

    const existing = tokensMap.get(base.address) ?? {
      address: base.address,
      symbol: (base.symbol || '').toUpperCase(),
      name: base.name || null,
      liquidityUsd: 0,
      volume24hUsd: 0,
      priceUsd,
      pairs: [] as ResolvedTokenPairSummary[],
      score: 0,
    };

    existing.liquidityUsd += liquidityUsd;
    existing.volume24hUsd += volume24h;
    if (priceUsd) existing.priceUsd = priceUsd;
    if (existing.pairs.length < 3) {
      existing.pairs.push({
        dexId: pair?.dexId ?? null,
        pairAddress: pair?.pairAddress ?? null,
        liquidityUsd,
        priceUsd,
        url: pair?.url ?? null,
      });
    }

    const symbolMatch = existing.symbol === target ? 1 : existing.symbol.includes(target) ? 0.5 : 0;
    const score = Math.log10(1 + existing.liquidityUsd) * 20 + Math.log10(1 + existing.volume24hUsd) * 10 + symbolMatch * 400;
    existing.score = score;

    tokensMap.set(base.address, existing);
  }

  const ranked = Array.from(tokensMap.values())
    .filter((item) => item.liquidityUsd > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);

  return ranked;
}
