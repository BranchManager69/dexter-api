import { randomUUID } from 'node:crypto';
import { Blob } from 'node:buffer';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import prisma from '../prisma.js';
import { loadManagedWallet } from '../wallets/manager.js';
import { logger } from '../logger.js';

const RPC_URL = (process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com').trim();
const connection = new Connection(RPC_URL, 'confirmed');

const PUMP_FUN_IPFS_ENDPOINT = 'https://pump.fun/api/ipfs';
const PUMPSWAP_CREATE_LOCAL_ENDPOINT = 'https://pumpswapapi.fun/api/create/create-local';

const log = logger.child('solana.pumpfun');

export interface PumpFunImageFromUrl {
  kind: 'url';
  url: string;
  filename?: string;
}

export interface PumpFunImageFromBase64 {
  kind: 'base64';
  base64: string;
  contentType?: string;
  filename?: string;
}

export interface PumpFunImageFromBuffer {
  kind: 'buffer';
  buffer: Buffer;
  contentType?: string;
  filename?: string;
}

export type PumpFunImageInput = PumpFunImageFromUrl | PumpFunImageFromBase64 | PumpFunImageFromBuffer;

export interface PumpFunMetadataInput {
  name: string;
  symbol: string;
  description?: string;
  image: PumpFunImageInput;
  showName?: boolean;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface PumpFunLaunchRequest {
  creatorWalletAddress: string;
  metadata: PumpFunMetadataInput;
  devBuySol?: number;
  slippagePercent?: number;
  priorityFeeLamports?: number;
  simulateOnly?: boolean;
}

export interface PumpFunLaunchResult {
  mintAddress: string;
  mintSecretKey: string;
  metadataUri: string;
  transactionSignature?: string;
  serializedTransaction: string;
  simulateOnly: boolean;
}

function normalizePositiveNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return num;
}

async function resolveImageBlob(image: PumpFunImageInput): Promise<{ blob: Blob; filename: string }> {
  if (image.kind === 'url') {
    const response = await fetch(image.url, { headers: { accept: 'image/*' } });
    if (!response.ok) {
      throw new Error(`pumpfun_metadata_image_fetch_failed:${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const blob = new Blob([arrayBuffer], { type: contentType });
    const filename =
      image.filename ||
      (() => {
        try {
          const url = new URL(image.url);
          const basename = url.pathname.split('/').filter(Boolean).pop();
          if (basename) return basename;
        } catch {}
        return `${randomUUID()}.png`;
      })();
    return { blob, filename };
  }

  if (image.kind === 'base64') {
    const buffer = Buffer.from(image.base64, 'base64');
    if (!buffer.length) {
      throw new Error('pumpfun_metadata_image_empty');
    }
    const blob = new Blob([buffer], { type: image.contentType || 'application/octet-stream' });
    const filename = image.filename || `${randomUUID()}.png`;
    return { blob, filename };
  }

  if (image.kind === 'buffer') {
    if (!Buffer.isBuffer(image.buffer) || !image.buffer.length) {
      throw new Error('pumpfun_metadata_image_empty');
    }
    const blob = new Blob([image.buffer], { type: image.contentType || 'application/octet-stream' });
    const filename = image.filename || `${randomUUID()}.png`;
    return { blob, filename };
  }

  throw new Error(`pumpfun_metadata_image_unsupported:${(image as any)?.kind ?? 'unknown'}`);
}

async function uploadMetadataToPumpFun(metadata: PumpFunMetadataInput): Promise<{ metadataUri: string; metadataJson: any }> {
  const formData = new FormData();
  formData.set('name', metadata.name);
  formData.set('symbol', metadata.symbol);
  formData.set('description', metadata.description || '');
  formData.set('showName', metadata.showName === false ? 'false' : 'true');
  if (metadata.twitter) formData.set('twitter', metadata.twitter);
  if (metadata.telegram) formData.set('telegram', metadata.telegram);
  if (metadata.website) formData.set('website', metadata.website);

  const { blob, filename } = await resolveImageBlob(metadata.image);
  formData.append('file', blob, filename);

  const response = await fetch(PUMP_FUN_IPFS_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`pumpfun_metadata_upload_failed:${response.status}:${text}`);
  }

  const json = await response.json().catch(() => null);
  if (!json) {
    throw new Error('pumpfun_metadata_upload_invalid_json');
  }

  const metadataUri = json?.metadataUri || json?.uri;
  if (!metadataUri || typeof metadataUri !== 'string') {
    throw new Error('pumpfun_metadata_upload_missing_uri');
  }

  const metadataJson = json?.metadata || null;
  return { metadataUri, metadataJson };
}

async function requestCreateLocalTransaction(params: {
  creatorPublicKey: string;
  mintPublicKey: string;
  metadataUri: string;
  metadata: PumpFunMetadataInput;
  devBuySol: number;
  slippagePercent: number;
  priorityFeeLamports: number;
}): Promise<{ serialized: string }> {
  const payload = {
    publicKey: params.creatorPublicKey,
    mint: params.mintPublicKey,
    metadata: {
      name: params.metadata.name,
      symbol: params.metadata.symbol,
      uri: params.metadataUri,
    },
    devBuy: params.devBuySol,
    slippage: params.slippagePercent,
    priorityFee: params.priorityFeeLamports,
  };

  const response = await fetch(PUMPSWAP_CREATE_LOCAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`pumpswap_create_local_failed:${response.status}:${text}`);
  }

  const json = await response.json().catch(() => null);
  if (!json) {
    throw new Error('pumpswap_create_local_invalid_json');
  }

  const serialized =
    json?.serializedTransaction ||
    json?.transaction ||
    json?.transactionBase64 ||
    json?.tx;

  if (!serialized || typeof serialized !== 'string') {
    throw new Error('pumpswap_create_local_missing_transaction');
  }

  return { serialized };
}

export async function launchPumpFunToken(request: PumpFunLaunchRequest): Promise<PumpFunLaunchResult> {
  const creatorAddress = (request.creatorWalletAddress || '').trim();
  if (!creatorAddress) {
    throw new Error('creator_wallet_required');
  }

  const metadata = request.metadata;
  if (!metadata?.name || !metadata?.symbol) {
    throw new Error('metadata_name_symbol_required');
  }

  const walletRecord = await prisma.managed_wallets.findUnique({
    where: { public_key: creatorAddress },
  });

  if (!walletRecord) {
    throw new Error(`managed_wallet_not_found:${creatorAddress}`);
  }

  const { keypair: creatorKeypair } = await loadManagedWallet(creatorAddress);

  const mintKeypair = Keypair.generate();

  const { metadataUri } = await uploadMetadataToPumpFun(metadata);

  const devBuySol = normalizePositiveNumber(request.devBuySol, 0);
  const slippagePercent = normalizePositiveNumber(request.slippagePercent, 1);
  const priorityFeeLamports = normalizePositiveNumber(request.priorityFeeLamports, 0);

  const { serialized } = await requestCreateLocalTransaction({
    creatorPublicKey: creatorAddress,
    mintPublicKey: mintKeypair.publicKey.toBase58(),
    metadataUri,
    metadata,
    devBuySol,
    slippagePercent,
    priorityFeeLamports,
  });

  const transactionBuffer = Buffer.from(serialized, 'base64');
  const transaction = VersionedTransaction.deserialize(transactionBuffer);

  const staticSignerKeys = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures,
  );
  const requiredSigners = new Set(staticSignerKeys.map((key) => key.toBase58()));
  if (!requiredSigners.has(creatorKeypair.publicKey.toBase58())) {
    throw new Error('pumpfun_transaction_missing_creator_signer');
  }
  const signerKeypairs = [creatorKeypair];
  if (requiredSigners.has(mintKeypair.publicKey.toBase58())) {
    signerKeypairs.push(mintKeypair);
  }

  transaction.sign(signerKeypairs);

  const simulateOnly = Boolean(request.simulateOnly);
  let signature: string | undefined;

  if (!simulateOnly) {
    signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    log.info({ signature, creator: creatorAddress, mint: mintKeypair.publicKey.toBase58() }, 'pumpfun_launch_submitted');
  } else {
    log.info({ creator: creatorAddress, mint: mintKeypair.publicKey.toBase58() }, 'pumpfun_launch_simulated');
  }

  return {
    mintAddress: mintKeypair.publicKey.toBase58(),
    mintSecretKey: bs58.encode(mintKeypair.secretKey),
    metadataUri,
    transactionSignature: signature,
    serializedTransaction: serialized,
    simulateOnly,
  };
}
