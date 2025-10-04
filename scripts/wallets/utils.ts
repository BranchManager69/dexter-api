import 'dotenv/config';
import { createCipheriv, randomBytes } from 'node:crypto';

export type EncryptedSeedPayload = {
  version: 'dexter_seed_aes256_gcm';
  ciphertext: string;
  iv: string;
  tag: string;
};

export function ensureEncryptionKey(): Buffer {
  const keyHex = (process.env.WALLET_ENCRYPTION_KEY || '').trim();
  if (!keyHex) {
    throw new Error('WALLET_ENCRYPTION_KEY env var is required');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function deriveSeed(secretKey: Uint8Array): Buffer {
  if (secretKey.length === 64) {
    return Buffer.from(secretKey.slice(0, 32));
  }
  if (secretKey.length === 32) {
    return Buffer.from(secretKey);
  }
  throw new Error(`Secret key must be 32 or 64 bytes; received ${secretKey.length}`);
}

export function encryptSeed(seed: Buffer, key: Buffer): EncryptedSeedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(seed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 'dexter_seed_aes256_gcm',
    ciphertext: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}
