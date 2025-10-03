import type { Express, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { executeBuy, executeSell, listTokenBalances, previewSellAll, resolveToken } from '../solana/tradingService.js';
import { logger, style } from '../logger.js';

function parseNumber(input: unknown, fallback = 0): number {
  const num = Number(input);
  return Number.isFinite(num) ? num : fallback;
}

const DEXSCREENER_TOKENS_ENDPOINT = 'https://api.dexscreener.com/latest/dex/tokens';
const DEXSCREENER_BATCH_SIZE = 25;
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

interface TokenMetadata {
  address: string;
  symbol: string | null;
  name: string | null;
  priceUsd?: number;
  priceChange24h?: number;
  marketCap?: number;
  fdv?: number;
  liquidityUsd?: number;
  imageUrl?: string | null;
  headerImageUrl?: string | null;
  openGraphImageUrl?: string | null;
  websites?: { label?: string | null; url: string }[];
  socials?: { type?: string | null; url: string }[];
}

const NATIVE_SOL_METADATA: TokenMetadata = {
  address: 'native:SOL',
  symbol: 'SOL',
  name: 'Solana',
  imageUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  headerImageUrl: null,
  openGraphImageUrl: null,
  websites: [{ label: 'Website', url: 'https://solana.com/' }],
  socials: [{ type: 'twitter', url: 'https://x.com/solana' }],
};

function chunkArray<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function parseOptionalNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function mergeTokenMetadata(existing: TokenMetadata | undefined, incoming: TokenMetadata, liquidityCandidate?: number): TokenMetadata {
  if (!existing) return incoming;
  const merged: TokenMetadata = { ...existing };
  const incomingLiquidity = liquidityCandidate ?? incoming.liquidityUsd ?? 0;
  const currentLiquidity = existing.liquidityUsd ?? 0;
  const preferIncoming = incomingLiquidity > currentLiquidity;

  if (preferIncoming) {
    merged.symbol = incoming.symbol ?? merged.symbol;
    merged.name = incoming.name ?? merged.name;
    merged.priceUsd = incoming.priceUsd ?? merged.priceUsd;
    merged.priceChange24h = incoming.priceChange24h ?? merged.priceChange24h;
    merged.marketCap = incoming.marketCap ?? merged.marketCap;
    merged.fdv = incoming.fdv ?? merged.fdv;
    merged.liquidityUsd = incomingLiquidity || merged.liquidityUsd;
    merged.imageUrl = incoming.imageUrl ?? merged.imageUrl;
    merged.headerImageUrl = incoming.headerImageUrl ?? merged.headerImageUrl;
    merged.openGraphImageUrl = incoming.openGraphImageUrl ?? merged.openGraphImageUrl;
  } else {
    merged.symbol = merged.symbol ?? incoming.symbol ?? null;
    merged.name = merged.name ?? incoming.name ?? null;
    merged.priceUsd = merged.priceUsd ?? incoming.priceUsd;
    merged.priceChange24h = merged.priceChange24h ?? incoming.priceChange24h;
    merged.marketCap = merged.marketCap ?? incoming.marketCap;
    merged.fdv = merged.fdv ?? incoming.fdv;
    merged.imageUrl = merged.imageUrl ?? incoming.imageUrl ?? null;
    merged.headerImageUrl = merged.headerImageUrl ?? incoming.headerImageUrl ?? null;
    merged.openGraphImageUrl = merged.openGraphImageUrl ?? incoming.openGraphImageUrl ?? null;
  }

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

async function fetchTokenMetadataFromDexScreener(mints: string[]): Promise<Map<string, TokenMetadata>> {
  const base58Pattern = /^[1-9A-HJ-NP-Za-km-z]{20,}$/;
  const unique = Array.from(
    new Set(
      mints
        .filter((mint) => typeof mint === 'string')
        .map((mint) => mint.trim())
        .filter((mint) => base58Pattern.test(mint)),
    ),
  );
  const map = new Map<string, TokenMetadata>();
  if (!unique.length) return map;

  const batches = chunkArray(unique, DEXSCREENER_BATCH_SIZE);

  for (const batch of batches) {
    const url = `${DEXSCREENER_TOKENS_ENDPOINT}/${batch.join(',')}`;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const json = await response.json().catch(() => null);
      if (!json) continue;
      const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
      for (const pair of pairs) {
        if ((pair?.chainId || '').toLowerCase() !== 'solana') continue;
        const base = pair?.baseToken;
        if (!base?.address) continue;
        const liquidityUsd = parseOptionalNumber(pair?.liquidity?.usd);
        const metadata: TokenMetadata = {
          address: base.address,
          symbol: typeof base.symbol === 'string' ? base.symbol : null,
          name: typeof base.name === 'string' ? base.name : null,
          priceUsd: parseOptionalNumber(pair?.priceUsd),
          priceChange24h: parseOptionalNumber(pair?.priceChange?.h24),
          marketCap: parseOptionalNumber(pair?.marketCap),
          fdv: parseOptionalNumber(pair?.fdv),
          liquidityUsd,
          imageUrl: pair?.info?.imageUrl ?? null,
          headerImageUrl: pair?.info?.header ?? null,
          openGraphImageUrl: pair?.info?.openGraph ?? null,
          websites: Array.isArray(pair?.info?.websites)
            ? pair.info.websites
                .map((site: any) => (site?.url ? { label: site?.label ?? null, url: String(site.url) } : null))
                .filter(Boolean)
            : undefined,
          socials: Array.isArray(pair?.info?.socials)
            ? pair.info.socials
                .map((item: any) => (item?.url ? { type: item?.type ?? null, url: String(item.url) } : null))
                .filter(Boolean)
            : undefined,
        };

        const existing = map.get(base.address);
        map.set(base.address, mergeTokenMetadata(existing, metadata, liquidityUsd));
      }
    } catch (error) {
      logger.warn('[solana-balances] dexScreener fetch failed', error);
    }
  }

  return map;
}

export function registerSolanaRoutes(app: Express) {
  const log = logger.child('solana');
  app.get('/api/solana/balances', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const walletAddress = typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : null;
      if (!walletAddress) {
        return res.status(400).json({ ok: false, error: 'wallet_address_required' });
      }
      const wallet = await prisma.managed_wallets.findUnique({ where: { public_key: walletAddress } });
      if (!wallet) {
        return res.status(404).json({ ok: false, error: 'wallet_not_found' });
      }
      if (wallet.assigned_supabase_user_id && wallet.assigned_supabase_user_id !== supabaseUserId) {
        return res.status(403).json({ ok: false, error: 'forbidden_wallet' });
      }
      const publicKey = new PublicKey(wallet.public_key);
      const balances = await listTokenBalances({
        walletPublicKey: publicKey,
        minimumUi: parseNumber(req.query.minUi, 0),
        limit: parseNumber(req.query.limit, 10),
      });
      let enriched = balances;
      let solPriceUsd: number | null = null;
      try {
        const metadataRequest = balances.map((item) => item.mint);
        if (balances.some((item) => item.isNative)) {
          metadataRequest.push(WRAPPED_SOL_MINT);
        }
        const metadataMap = await fetchTokenMetadataFromDexScreener(metadataRequest);
        const wrappedSol = metadataMap.get(WRAPPED_SOL_MINT);
        if (wrappedSol) {
          const mergedSol = mergeTokenMetadata(
            { ...NATIVE_SOL_METADATA },
            { ...wrappedSol, address: 'native:SOL' },
            wrappedSol.liquidityUsd,
          );
          metadataMap.set('native:SOL', mergedSol);
          if (typeof mergedSol.priceUsd === 'number' && Number.isFinite(mergedSol.priceUsd)) {
            solPriceUsd = mergedSol.priceUsd;
          }
        }
        enriched = balances.map((item) => {
          const metadata = metadataMap.get(item.mint) || (item.isNative ? NATIVE_SOL_METADATA : undefined);
          return metadata ? { ...item, token: metadata } : item;
        });
      } catch (metadataError) {
        log.warn('[solana-balances] metadata enrichment failed', metadataError);
      }

      const withPortfolio = enriched.map((item) => {
        const priceUsd = typeof (item as any)?.token?.priceUsd === 'number' ? (item as any).token.priceUsd : undefined;
        const numericPriceUsd = Number.isFinite(priceUsd) ? priceUsd : undefined;
        const valueUsd = numericPriceUsd !== undefined ? item.amountUi * numericPriceUsd : undefined;
        const priceChangePct = typeof (item as any)?.token?.priceChange24h === 'number' ? (item as any).token.priceChange24h : undefined;
        const changeUsd24h =
          valueUsd !== undefined && priceChangePct !== undefined
            ? (valueUsd * priceChangePct) / 100
            : undefined;
        return {
          ...item,
          portfolio: {
            valueUsd: valueUsd ?? null,
            valueSol:
              valueUsd !== undefined && solPriceUsd && Number.isFinite(solPriceUsd) && solPriceUsd > 0
                ? valueUsd / solPriceUsd
                : null,
            sharePercent: null,
            changeUsd24h: changeUsd24h ?? null,
          },
        };
      });

      const totalValueUsd = withPortfolio.reduce((acc, item) => acc + (item.portfolio?.valueUsd ?? 0), 0);
      const pricedCount = withPortfolio.filter((item) => item.portfolio?.valueUsd != null).length;
      const unpricedCount = withPortfolio.length - pricedCount;

      const balancesWithShare = withPortfolio.map((item) => {
        const share =
          totalValueUsd > 0 && item.portfolio?.valueUsd != null
            ? (item.portfolio.valueUsd / totalValueUsd) * 100
            : null;
        return {
          ...item,
          portfolio: item.portfolio
            ? {
                ...item.portfolio,
                sharePercent: share,
              }
            : item.portfolio,
        };
      });

      return res.json({
        ok: true,
        balances: balancesWithShare,
        user: supabaseUserId,
        portfolio: {
          totalValueUsd: totalValueUsd || null,
          pricedCount,
          unpricedCount,
        },
      });
    } catch (error: any) {
      log.error(`${style.status('balances', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.get('/api/solana/resolve-token', async (req: Request, res: Response) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const results = await resolveToken(query, parseNumber(req.query.limit, 5));
      return res.json({ ok: true, results });
    } catch (error: any) {
      log.error(`${style.status('resolve', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.post('/api/solana/buy', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await executeBuy({
        supabaseUserId,
        walletAddress: typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : null,
        amountSol: parseNumber(req.body?.amountSol, 0),
        mint: String(req.body?.mint || ''),
        slippageBps: req.body?.slippageBps != null ? Number(req.body.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('buy', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'trade_failed' });
    }
  });

  app.post('/api/solana/sell', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await executeSell({
        supabaseUserId,
        walletAddress: typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : null,
        mint: String(req.body?.mint || ''),
        amountRaw: typeof req.body?.amountRaw === 'string' ? req.body.amountRaw : undefined,
        percentage: req.body?.percentage != null ? Number(req.body.percentage) : undefined,
        slippageBps: req.body?.slippageBps != null ? Number(req.body.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('sell', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'trade_failed' });
    }
  });

  app.get('/api/solana/preview-sell', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await previewSellAll({
        supabaseUserId,
        walletAddress: typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : null,
        mint: String(req.query.mint || ''),
        slippageBps: req.query.slippageBps != null ? Number(req.query.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('preview', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'preview_failed' });
    }
  });
}
