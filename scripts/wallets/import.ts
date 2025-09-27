#!/usr/bin/env tsx
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL_SESSION || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL or DATABASE_URL_SESSION must be set');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

interface CliArgs {
  secret: string;
  label?: string;
  memo?: string;
  status: 'available' | 'assigned' | 'retired';
  metadata?: string;
  assign?: string;
  dryRun: boolean;
}

function ensureEncryptionKey(): Buffer {
  const keyHex = (process.env.WALLET_ENCRYPTION_KEY || '').trim();
  if (!keyHex) {
    throw new Error('WALLET_ENCRYPTION_KEY env var is required');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

async function readSecretSource(input: string): Promise<Uint8Array> {
  const trimmed = input.trim();
  // Path to a file?
  try {
    const candidatePath = path.resolve(trimmed);
    const stat = await fs.stat(candidatePath);
    if (stat.isFile()) {
      const raw = await fs.readFile(candidatePath, 'utf8');
      return parseSecret(raw, candidatePath);
    }
  } catch {
    // not a file, fall through
  }
  return parseSecret(trimmed, '<inline>');
}

function parseSecret(raw: string, source: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Secret from ${source} is empty`);
  }

  // JSON array (like Solana id.json)
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
    try {
      const value = JSON.parse(trimmed);
      if (!Array.isArray(value)) {
        throw new Error('Expected an array of numbers');
      }
      const bytes = Uint8Array.from(value.map((n) => {
        if (typeof n !== 'number') {
          throw new Error('Array must contain numbers only');
        }
        if (n < 0 || n > 255) {
          throw new Error('Array values must be 0-255');
        }
        return n;
      }));
      return bytes;
    } catch (error: any) {
      throw new Error(`Failed to parse JSON secret (${source}): ${error?.message || error}`);
    }
  }

  // Base58 string
  try {
    return bs58.decode(trimmed);
  } catch {
    throw new Error(`Secret from ${source} is not valid base58 or JSON array`);
  }
}

function deriveSeed(secretKey: Uint8Array): Buffer {
  if (secretKey.length === 64) {
    return Buffer.from(secretKey.slice(0, 32));
  }
  if (secretKey.length === 32) {
    return Buffer.from(secretKey);
  }
  throw new Error(`Secret key must be 32 or 64 bytes; received ${secretKey.length}`);
}

function encryptSeed(seed: Buffer, key: Buffer) {
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

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('wallet-import')
    .option('secret', {
      type: 'string',
      demandOption: true,
      describe: 'Path to Solana secret key file or base58-encoded secret key',
    })
    .option('label', {
      type: 'string',
      describe: 'Friendly label for the wallet',
    })
    .option('memo', {
      type: 'string',
      describe: 'Optional memo/notes stored with the wallet record',
    })
    .option('status', {
      type: 'string',
      choices: ['available', 'assigned', 'retired'] as const,
      default: 'available',
      describe: 'Initial status for the wallet',
    })
    .option('metadata', {
      type: 'string',
      describe: 'JSON blob stored in managed_wallets.metadata',
    })
    .option('assign', {
      type: 'string',
      describe: 'Supabase user ID to pre-assign the wallet to',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Encrypt and preview the record without writing to the database',
    })
    .help()
    .parseSync() as CliArgs;

  const encryptionKey = ensureEncryptionKey();
  const secretBytes = await readSecretSource(argv.secret);
  const seed = deriveSeed(secretBytes);
  const keypair = Keypair.fromSeed(seed);

  const payload = encryptSeed(seed, encryptionKey);
  const encryptedJson = JSON.stringify(payload);

  let metadata: any = {};
  if (argv.metadata) {
    try {
      metadata = JSON.parse(argv.metadata);
    } catch (error: any) {
      throw new Error(`Failed to parse metadata JSON: ${error?.message || error}`);
    }
  }

  const existing = await prisma.managed_wallets.findUnique({
    where: { public_key: keypair.publicKey.toBase58() },
  });

  if (existing) {
    throw new Error(`Wallet ${existing.public_key} already exists (status=${existing.status})`);
  }

  const finalStatus = argv.assign ? 'assigned' : argv.status;

  const record = {
    public_key: keypair.publicKey.toBase58(),
    encrypted_private_key: encryptedJson,
    label: argv.label ?? null,
    status: finalStatus,
    metadata,
    memo: argv.memo ?? null,
    assigned_supabase_user_id: argv.assign ?? null,
    assigned_at: argv.assign ? new Date() : null,
  };

  if (argv.dryRun) {
    console.log('Dry run – generated wallet payload:');
    console.log(JSON.stringify(record, null, 2));
    await prisma.$disconnect();
    return;
  }

  await prisma.managed_wallets.create({ data: record });
  await prisma.$disconnect();

  console.log('Wallet inserted successfully.');
  console.log(` public_key: ${record.public_key}`);
  if (record.label) {
    console.log(` label:      ${record.label}`);
  }
  if (record.assigned_supabase_user_id) {
    console.log(` assigned:   ${record.assigned_supabase_user_id}`);
  }
}

main().catch(async (error) => {
  console.error('[wallet-import] failed:', error.message || error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
