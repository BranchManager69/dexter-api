import { createDecipheriv } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import prisma from '../prisma.js';

const ENCRYPTION_KEY_HEX = process.env.WALLET_ENCRYPTION_KEY;
const PAYLOAD_VERSION = 'dexter_seed_aes256_gcm';

if (!ENCRYPTION_KEY_HEX) {
  throw new Error('WALLET_ENCRYPTION_KEY is required to load managed wallets');
}

if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
  throw new Error('WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}

const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

function decryptWalletPayload(encryptedJson: string): Buffer {
  let parsed: any;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch (error) {
    throw new Error('Invalid encrypted wallet payload');
  }

  if (parsed?.version !== PAYLOAD_VERSION) {
    throw new Error(`unsupported_wallet_payload_version:${parsed?.version ?? 'unknown'}`);
  }

  const ciphertext = typeof parsed.ciphertext === 'string' ? parsed.ciphertext : null;
  const iv = typeof parsed.iv === 'string' ? parsed.iv : null;
  const tag = typeof parsed.tag === 'string' ? parsed.tag : null;
  const aad = typeof parsed.aad === 'string' && parsed.aad ? parsed.aad : null;

  if (!ciphertext || !iv || !tag) {
    throw new Error('encrypted wallet payload missing ciphertext, iv, or tag');
  }

  const ivBuffer = Buffer.from(iv, 'hex');
  if (ivBuffer.length !== 12 && ivBuffer.length !== 16) {
    throw new Error('wallet payload iv must be 12 or 16 bytes');
  }

  const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, ivBuffer);
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  if (aad) {
    decipher.setAAD(Buffer.from(aad, 'hex'));
  }

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);

  if (decrypted.length !== 32) {
    throw new Error(`wallet_seed_invalid_length:${decrypted.length}`);
  }

  return decrypted;
}

export interface LoadedWallet {
  address: string;
  label: string | null;
  publicKey: PublicKey;
  keypair: Keypair;
}

export async function loadManagedWallet(walletPublicKey: string): Promise<LoadedWallet> {
  const wallet = await prisma.managed_wallets.findUnique({
    where: { public_key: String(walletPublicKey) },
  });

  if (!wallet) {
    throw new Error(`managed_wallet_not_found:${walletPublicKey}`);
  }

  if (!wallet.encrypted_private_key) {
    throw new Error(`wallet_missing_secret:${wallet.public_key}`);
  }

  const seed = decryptWalletPayload(wallet.encrypted_private_key);
  if (seed.length !== 32) {
    throw new Error('wallet_seed_invalid_length');
  }

  const keypair = Keypair.fromSeed(seed);
  return {
    address: wallet.public_key,
    label: wallet.label ?? null,
    publicKey: keypair.publicKey,
    keypair,
  };
}

export interface ManagedWalletSummary {
  address: string;
  publicKey: PublicKey;
  label: string | null;
}

export async function listManagedWalletsByAddresses(addresses: string[]): Promise<ManagedWalletSummary[]> {
  if (!addresses.length) return [];
  const records = await prisma.managed_wallets.findMany({
    where: { public_key: { in: addresses } },
  });
  return records.map((record) => ({
    address: record.public_key,
    label: record.label ?? null,
    publicKey: new PublicKey(record.public_key),
  }));
}
