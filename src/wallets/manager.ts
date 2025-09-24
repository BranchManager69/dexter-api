import { createDecipheriv } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import prisma from '../prisma.js';

const ENCRYPTION_KEY_HEX = process.env.WALLET_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY_HEX) {
  throw new Error('WALLET_ENCRYPTION_KEY is required to load managed wallets');
}

const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

// Shared helper adapted from the legacy token-ai trade manager
function decryptWalletPayload(encryptedJson: string): Buffer {
  let parsed: any;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch (error) {
    throw new Error('Invalid encrypted wallet payload');
  }

  const version = parsed?.version as string | undefined;

  const performDecrypt = (payload: string, iv: string, tag: string, aad?: string): Buffer => {
    const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    if (aad) {
      decipher.setAAD(Buffer.from(aad, 'hex'));
    }
    return Buffer.concat([decipher.update(Buffer.from(payload, 'hex')), decipher.final()]);
  };

  // v2 seed formats (primary path)
  if (version === 'v2_seed_unified' || version === 'v2_seed' || version === 'v2_seed_vanity') {
    const decrypted = performDecrypt(parsed.encrypted, parsed.nonce, parsed.authTag, parsed.aad);
    return Buffer.from(decrypted);
  }

  // Admin/legacy payloads
  if (version === 'v2_seed_admin_raw' || version === 'v2_seed_admin') {
    const payload = parsed.encrypted_payload ?? parsed.encrypted;
    if (!payload || !parsed.iv || !parsed.tag) {
      throw new Error(`Encrypted wallet payload missing required fields for ${version}`);
    }
    const decrypted = performDecrypt(payload, parsed.iv, parsed.tag, parsed.aad);
    if (decrypted.length === 64) {
      return decrypted.subarray(0, 32);
    }
    if (decrypted.length === 32) {
      return decrypted;
    }
    throw new Error(`Unexpected decrypted payload length ${decrypted.length} for ${version}`);
  }

  // Generic AES-GCM JSON (no version field)
  if (!version && (parsed.encrypted_payload || parsed.encrypted)) {
    const payload = parsed.encrypted_payload ?? parsed.encrypted;
    if (!payload || !parsed.iv || !parsed.tag) {
      throw new Error('Generic encrypted wallet payload missing required fields');
    }
    const decrypted = performDecrypt(payload, parsed.iv, parsed.tag, parsed.aad);
    if (decrypted.length === 64) {
      return decrypted.subarray(0, 32);
    }
    if (decrypted.length === 32) {
      return decrypted;
    }
    throw new Error(`Unexpected decrypted payload length ${decrypted.length}`);
  }

  throw new Error(`Unsupported wallet payload version: ${version ?? 'unknown'}`);
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
