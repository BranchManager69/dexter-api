import { Connection, PublicKey } from '@solana/web3.js';
import { Metadata, PROGRAM_ID as METAPLEX_METADATA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { logger, style } from '../logger.js';

const tokenLog = logger.child('token.config');
const DEFAULT_CHAIN = 'solana';

let cachedConnection: Connection | null = null;

function getRpcEndpoint(): string {
  const candidates = [
    process.env.SOLANA_RPC_ENDPOINT,
    process.env.SOLANA_RPC_URL,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return 'https://api.mainnet-beta.solana.com';
}

function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(getRpcEndpoint(), 'confirmed');
  }
  return cachedConnection;
}

function stripNullish(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.replace(/\0/g, '').trim();
  return trimmed.length ? trimmed : null;
}

async function fetchTokenMetadataJson(uri: string): Promise<Record<string, unknown> | null> {
  const normalized = stripNullish(uri);
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) return null;
  try {
    const response = await fetch(normalized, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      tokenLog.warn(
        `${style.status('metadata', 'warn')} ${style.kv('event', 'fetch_failed')} ${style.kv('uri', normalized)} ${style.kv('status', response.status)}`,
      );
      return null;
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') return null;
    return data as Record<string, unknown>;
  } catch (error: any) {
    tokenLog.warn(
      `${style.status('metadata', 'warn')} ${style.kv('event', 'fetch_error')} ${style.kv('uri', normalized)} ${style.kv('error', error?.message || error)}`,
      error,
    );
    return null;
  }
}

type OnchainTokenSnapshot = {
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  supply: string | null;
  metadataUri: string | null;
  metadataJson: Record<string, unknown> | null;
};

type DexscreenerPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  labels?: string[];
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  quoteToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceNative?: string | number;
  priceUsd?: string | number;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: Record<string, unknown>;
};

type DexscreenerSnapshot = {
  priceUsd: string | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  txns24hBuys: number | null;
  txns24hSells: number | null;
  fdv: number | null;
  marketCap: number | null;
  pairs: DexscreenerPair[];
};

async function fetchOnchainSnapshot(mintAddress: string): Promise<OnchainTokenSnapshot> {
  const connection = getConnection();
  const mint = new PublicKey(mintAddress);

  let symbol: string | null = null;
  let name: string | null = null;
  let metadataUri: string | null = null;
  let metadataJson: Record<string, unknown> | null = null;

  try {
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METAPLEX_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METAPLEX_METADATA_PROGRAM_ID,
    );
    const metadata = await Metadata.fromAccountAddress(connection, metadataPda);
    symbol = stripNullish(metadata.data.symbol);
    name = stripNullish(metadata.data.name);
    metadataUri = stripNullish(metadata.data.uri);
    if (metadataUri) {
      metadataJson = await fetchTokenMetadataJson(metadataUri);
    }
  } catch (error: any) {
    tokenLog.warn(
      `${style.status('metadata', 'warn')} ${style.kv('event', 'load_failed')} ${style.kv('mint', mintAddress)} ${style.kv('error', error?.message || error)}`,
      error,
    );
  }

  let decimals: number | null = null;
  let supply: string | null = null;
  try {
    const supplyInfo = await connection.getTokenSupply(mint);
    decimals = typeof supplyInfo.value.decimals === 'number' ? supplyInfo.value.decimals : null;
    supply = typeof supplyInfo.value.amount === 'string' ? supplyInfo.value.amount : null;
  } catch (error: any) {
    tokenLog.warn(
      `${style.status('snapshot', 'warn')} ${style.kv('event', 'supply_failed')} ${style.kv('mint', mintAddress)} ${style.kv('error', error?.message || error)}`,
      error,
    );
  }

  return { symbol, name, metadataUri, metadataJson, decimals, supply };
}

function normaliseNumber(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickPrimaryPair(pairs: DexscreenerPair[]): DexscreenerPair | null {
  if (!pairs.length) return null;
  let best: DexscreenerPair | null = null;
  let bestLiquidity = -Infinity;
  for (const pair of pairs) {
    const liquidity = normaliseNumber(pair?.liquidity?.usd) ?? -Infinity;
    if (liquidity > bestLiquidity) {
      best = pair;
      bestLiquidity = liquidity;
    }
  }
  return best ?? pairs[0] ?? null;
}

async function fetchDexscreenerSnapshot(mintAddress: string): Promise<DexscreenerSnapshot | null> {
  const endpoint = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mintAddress)}`;
  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      tokenLog.warn(
        `${style.status('market', 'warn')} ${style.kv('event', 'dexscreener_failed')} ${style.kv('mint', mintAddress)} ${style.kv('status', response.status)}`,
      );
      return null;
    }
    const json = (await response.json().catch(() => null)) as { pairs?: DexscreenerPair[] } | null;
    const pairs = Array.isArray(json?.pairs) ? json!.pairs : [];
    if (!pairs.length) {
      return { priceUsd: null, priceChange24h: null, liquidityUsd: null, volume24hUsd: null, txns24hBuys: null, txns24hSells: null, fdv: null, marketCap: null, pairs: [] };
    }
    const primary = pickPrimaryPair(pairs);
    if (!primary) {
      return { priceUsd: null, priceChange24h: null, liquidityUsd: null, volume24hUsd: null, txns24hBuys: null, txns24hSells: null, fdv: null, marketCap: null, pairs };
    }

    const priceUsd = (() => {
      if (typeof primary.priceUsd === 'number') return primary.priceUsd.toString();
      if (typeof primary.priceUsd === 'string' && primary.priceUsd.trim()) return primary.priceUsd.trim();
      return null;
    })();

    const priceChange24h = normaliseNumber(primary.priceChange?.h24);
    const liquidityUsd = normaliseNumber(primary.liquidity?.usd);
    const volume24hUsd = normaliseNumber(primary.volume?.h24);
    const txns24h = primary.txns?.h24;
    const fdv = normaliseNumber(primary.fdv);
    const marketCap = normaliseNumber(primary.marketCap);

    return {
      priceUsd,
      priceChange24h,
      liquidityUsd,
      volume24hUsd,
      txns24hBuys: txns24h?.buys ?? null,
      txns24hSells: txns24h?.sells ?? null,
      fdv,
      marketCap,
      pairs,
    };
  } catch (error: any) {
    tokenLog.warn(
      `${style.status('market', 'warn')} ${style.kv('event', 'dexscreener_error')} ${style.kv('mint', mintAddress)} ${style.kv('error', error?.message || error)}`,
      error,
    );
    return null;
  }
}

export type TokenConfigRecord = Awaited<ReturnType<typeof prisma.token_config.findUnique>>;

export type TokenConfigResponse = ReturnType<typeof serializeTokenConfig>;

export function serializeTokenConfig(record: TokenConfigRecord | null) {
  if (!record) return null;
  return {
    id: record.id,
    chain: record.chain,
    mintAddress: record.mint_address,
    symbol: record.symbol,
    name: record.name,
    status: record.status,
    metadataSource: record.metadata_source,
    decimals: record.decimals,
    supply: record.supply ? record.supply.toString() : null,
    logoUrl: record.logo_url,
    coingeckoId: record.coingecko_id,
    metadataUri: record.metadata_uri,
    metadata: record.metadata_json ?? null,
    lastSyncedAt: record.last_synced_at ? record.last_synced_at.toISOString() : null,
    priceUsd: record.price_usd ? record.price_usd.toString() : null,
    liquidityUsd: record.liquidity_usd ? record.liquidity_usd.toString() : null,
    volume24hUsd: record.volume_24h_usd ? record.volume_24h_usd.toString() : null,
    priceChange24h: record.price_change_24h ? Number(record.price_change_24h) : null,
    txns24h: record.txns_24h_buys == null && record.txns_24h_sells == null ? null : {
      buys: record.txns_24h_buys,
      sells: record.txns_24h_sells,
    },
    fdv: record.fdv ? record.fdv.toString() : null,
    marketCap: record.market_cap ? record.market_cap.toString() : null,
    marketData: record.market_data_json ?? null,
    marketDataLastRefreshedAt: record.market_data_last_refreshed_at ? record.market_data_last_refreshed_at.toISOString() : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

export type GetTokenConfigOptions = {
  chain?: string;
  mintAddress: string;
  refresh?: boolean;
};

export async function getTokenConfig(options: GetTokenConfigOptions) {
  const chain = (options.chain ?? DEFAULT_CHAIN).trim().toLowerCase();
  const mintAddress = options.mintAddress.trim();
  if (!mintAddress) {
    throw new Error('token_config_mint_required');
  }

  const existing = await prisma.token_config.findUnique({
    where: { chain_mint_address: { chain, mint_address: mintAddress } },
  });

  if (!existing || options.refresh) {
    return refreshTokenConfig({ chain, mintAddress });
  }

  return existing;
}

export async function refreshTokenConfig({
  chain,
  mintAddress,
}: {
  chain?: string;
  mintAddress: string;
}) {
  const normalizedChain = (chain ?? DEFAULT_CHAIN).trim().toLowerCase();
  const normalizedMint = mintAddress.trim();
  if (!normalizedMint) {
    throw new Error('token_config_mint_required');
  }

  const snapshot = await fetchOnchainSnapshot(normalizedMint);
  const supplyDecimal = snapshot.supply ? new Prisma.Decimal(snapshot.supply) : null;
  const logoUrl =
    snapshot.metadataJson && typeof snapshot.metadataJson === 'object'
      ? ((): string | null => {
          const image = (snapshot.metadataJson as any)?.image;
          if (typeof image === 'string' && image.trim()) {
            return image.trim();
          }
          return null;
        })()
      : null;
  const metadataJsonValue = snapshot.metadataJson
    ? (snapshot.metadataJson as unknown as Prisma.JsonObject)
    : null;

  const marketSnapshot = await fetchDexscreenerSnapshot(normalizedMint);
  const marketJsonValue = marketSnapshot?.pairs
    ? (marketSnapshot.pairs as unknown as Prisma.JsonArray)
    : null;

  const now = new Date();

  const createData: Prisma.token_configCreateInput = {
    chain: normalizedChain,
    mint_address: normalizedMint,
    symbol: snapshot.symbol,
    name: snapshot.name,
    status: 'draft',
    metadata_source: 'onchain',
    decimals: snapshot.decimals ?? null,
    logo_url: logoUrl,
    supply: supplyDecimal,
    metadata_uri: snapshot.metadataUri ?? null,
    metadata_json: metadataJsonValue ?? Prisma.JsonNull,
    last_synced_at: now,
    price_usd: marketSnapshot?.priceUsd ? new Prisma.Decimal(marketSnapshot.priceUsd) : null,
    liquidity_usd: marketSnapshot?.liquidityUsd != null ? new Prisma.Decimal(marketSnapshot.liquidityUsd) : null,
    volume_24h_usd: marketSnapshot?.volume24hUsd != null ? new Prisma.Decimal(marketSnapshot.volume24hUsd) : null,
    price_change_24h: marketSnapshot?.priceChange24h != null ? new Prisma.Decimal(marketSnapshot.priceChange24h) : null,
    txns_24h_buys: marketSnapshot?.txns24hBuys ?? null,
    txns_24h_sells: marketSnapshot?.txns24hSells ?? null,
    fdv: marketSnapshot?.fdv != null ? new Prisma.Decimal(marketSnapshot.fdv) : null,
    market_cap: marketSnapshot?.marketCap != null ? new Prisma.Decimal(marketSnapshot.marketCap) : null,
    market_data_json: marketJsonValue ?? Prisma.JsonNull,
    market_data_last_refreshed_at: marketSnapshot ? now : null,
  };

  const updateData: Prisma.token_configUpdateInput = {
    metadata_source: 'onchain',
    last_synced_at: now,
    metadata_uri: snapshot.metadataUri ?? null,
    metadata_json: metadataJsonValue ?? Prisma.JsonNull,
    market_data_last_refreshed_at: marketSnapshot ? now : undefined,
  };

  if (snapshot.symbol !== null) {
    updateData.symbol = snapshot.symbol;
  }
  if (snapshot.name !== null) {
    updateData.name = snapshot.name;
  }
  if (snapshot.decimals !== null) {
    updateData.decimals = snapshot.decimals;
  }
  if (supplyDecimal !== null) {
    updateData.supply = supplyDecimal;
  }
  if (logoUrl !== null) {
    updateData.logo_url = logoUrl;
  }
  if (marketSnapshot?.priceUsd) {
    updateData.price_usd = new Prisma.Decimal(marketSnapshot.priceUsd);
  }
  if (marketSnapshot?.liquidityUsd != null) {
    updateData.liquidity_usd = new Prisma.Decimal(marketSnapshot.liquidityUsd);
  }
  if (marketSnapshot?.volume24hUsd != null) {
    updateData.volume_24h_usd = new Prisma.Decimal(marketSnapshot.volume24hUsd);
  }
  if (marketSnapshot?.priceChange24h != null) {
    updateData.price_change_24h = new Prisma.Decimal(marketSnapshot.priceChange24h);
  }
  if (marketSnapshot?.txns24hBuys != null) {
    updateData.txns_24h_buys = marketSnapshot.txns24hBuys;
  }
  if (marketSnapshot?.txns24hSells != null) {
    updateData.txns_24h_sells = marketSnapshot.txns24hSells;
  }
  if (marketSnapshot?.fdv != null) {
    updateData.fdv = new Prisma.Decimal(marketSnapshot.fdv);
  }
  if (marketSnapshot?.marketCap != null) {
    updateData.market_cap = new Prisma.Decimal(marketSnapshot.marketCap);
  }
  if (marketSnapshot?.pairs) {
    updateData.market_data_json = marketJsonValue ?? Prisma.JsonNull;
  }

  const result = await prisma.token_config.upsert({
    where: { chain_mint_address: { chain: normalizedChain, mint_address: normalizedMint } },
    create: createData,
    update: updateData,
  });

  tokenLog.info(
    `${style.status('snapshot', 'info')} ${style.kv('event', 'refreshed')} ${style.kv('chain', normalizedChain)} ${style.kv('mint', normalizedMint)} ${style.kv('symbol', snapshot.symbol || 'n/a')}`,
  );

  return result;
}
