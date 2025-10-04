#!/usr/bin/env tsx
import 'dotenv/config';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs';
import { PrismaClient } from '@prisma/client';
import { ensureEncryptionKey, deriveSeed, encryptSeed } from './utils.js';
import { Worker } from 'node:worker_threads';
import os from 'node:os';

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
  count: number;
  prefix: string;
  labelPrefix?: string;
  memo?: string;
  metadata?: string;
  dryRun: boolean;
  workers?: number;
  exactMatch?: boolean;
}

type WalletRecord = {
  public_key: string;
  encrypted_private_key: string;
  label: string | null;
  status: 'available';
  metadata: any;
  memo: string | null;
  assigned_supabase_user_id: null;
  assigned_provider: null;
  assigned_subject: null;
  assigned_email: null;
  assigned_at: null;
};

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('wallet-generate')
    .option('count', {
      type: 'number',
      describe: 'Number of wallets to generate',
      default: 1,
    })
    .option('prefix', {
      type: 'string',
      describe: 'Prefix the public key must start with',
      default: 'Dex',
    })
    .option('label-prefix', {
      type: 'string',
      describe: 'Optional label prefix stored with each wallet record',
    })
    .option('memo', {
      type: 'string',
      describe: 'Optional memo note stored with each wallet record',
    })
    .option('metadata', {
      type: 'string',
      describe: 'JSON blob stored on managed_wallets.metadata',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Generate wallets but do not insert them into the database',
    })
    .option('exact-match', {
      type: 'boolean',
      default: true,
      describe: 'Require exact case match for the prefix',
    })
    .option('workers', {
      type: 'number',
      describe: 'Number of worker threads to use (defaults to min(count, available CPU cores))',
    })
    .check((opts) => {
      if (opts.count !== undefined && (!Number.isFinite(opts.count) || opts.count <= 0)) {
        throw new Error('--count must be a positive number');
      }
      return true;
    })
    .help()
    .parseSync() as CliArgs;

  const count = Math.max(1, Math.floor(argv.count));
  const prefix = argv.prefix || '';
  const labelPrefix = argv.labelPrefix?.trim() || null;
  const memo = argv.memo?.trim() || null;
  const dryRun = Boolean(argv.dryRun);
  const exactMatch = argv.exactMatch !== undefined ? Boolean(argv.exactMatch) : true;

  const cpuCount = Math.max(1, os.cpus()?.length ?? 1);
  let workerCount = argv.workers !== undefined ? Math.floor(argv.workers) : Math.min(count, cpuCount);
  workerCount = Math.max(1, workerCount);
  workerCount = Math.min(workerCount, count);

  console.log(
    `[wallet-generate] Starting generation of ${count} wallet(s) with prefix "${prefix}" (${exactMatch ? 'case-sensitive' : 'case-insensitive'}) using ${workerCount} worker(s).`
  );

  let metadata: any = {};
  if (argv.metadata) {
    try {
      metadata = JSON.parse(argv.metadata);
    } catch (error: any) {
      throw new Error(`Failed to parse metadata JSON: ${error?.message || error}`);
    }
  }

  const encryptionKey = ensureEncryptionKey();

  const records: WalletRecord[] = [];

  let completed = 0;
  let finished = false;
  let stopWorkers: (() => Promise<void>) | null = null;
  let nextOrdinal = 1;

  const progressInterval = setInterval(() => {
    console.log(`[wallet-generate] ${completed}/${count} wallet(s) generated so far...`);
  }, 5000);

  const completionPromise = new Promise<void>((resolve, reject) => {
    const workers: Worker[] = [];

    stopWorkers = async () => {
      for (const worker of workers) {
        try {
          worker.postMessage({ type: 'stop' });
        } catch {}
      }
      await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
    };

    const handleError = async (error: unknown) => {
      if (finished) return;
      finished = true;
      clearInterval(progressInterval);
      await stopWorkers?.();
      await prisma.$disconnect().catch(() => {});
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const handleWallet = async (message: any) => {
      if (finished) return;
      if (!message || message.type !== 'wallet') return;

      const { publicKey, secretKey, attempts } = message;

      if (!publicKey || !secretKey) {
        return;
      }

      try {
        const existing = await prisma.managed_wallets.findUnique({ where: { public_key: publicKey } });
        if (existing) {
          return;
        }

        if (finished || nextOrdinal > count) {
          return;
        }

        const ordinal = nextOrdinal;
        nextOrdinal += 1;

        const secretBytes = secretKey instanceof Uint8Array ? secretKey : Uint8Array.from(secretKey);
        const seed = deriveSeed(secretBytes);
        const encrypted = encryptSeed(seed, encryptionKey);

        const record: WalletRecord = {
          public_key: publicKey,
          encrypted_private_key: JSON.stringify(encrypted),
          label: labelPrefix ? `${labelPrefix} ${ordinal}` : null,
          status: 'available',
          metadata,
          memo,
          assigned_supabase_user_id: null,
          assigned_provider: null,
          assigned_subject: null,
          assigned_email: null,
          assigned_at: null,
        };

        if (dryRun) {
          records.push(record);
          console.log(`[wallet-generate] (dry-run) Prepared wallet ${publicKey} after ${attempts} attempts.`);
        } else {
          await prisma.managed_wallets.create({ data: record });
          console.log(`[wallet-generate] Inserted wallet ${publicKey} after ${attempts} attempts.`);
        }

        completed += 1;

        if (completed >= count) {
          finished = true;
          clearInterval(progressInterval);
          await stopWorkers?.();
          if (!dryRun) {
            console.log(`[wallet-generate] Successfully inserted ${completed} wallet(s).`);
          } else {
            console.log('[wallet-generate] Dry run complete. Preview of generated records:');
            console.log(JSON.stringify(records, null, 2));
          }
          await prisma.$disconnect();
          resolve();
        }
      } catch (error) {
        await handleError(error);
      }
    };

    const workerExecArgv = process.execArgv.slice();

    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(new URL('./generateWorker.ts', import.meta.url), {
        workerData: { prefix, exactMatch },
        execArgv: workerExecArgv,
      });

      worker.on('message', (message) => {
        if (message && message.type === 'wallet') {
          void handleWallet(message);
        } else if (message && message.type === 'stopped' && !finished) {
          // Swallow
        }
      });

      worker.on('error', (error) => {
        void handleError(error);
      });

      worker.on('exit', (code) => {
        if (!finished && code !== 0) {
          void handleError(new Error(`worker exited with code ${code}`));
        }
      });

      workers.push(worker);
    }
  });

  await completionPromise.catch(async (error) => {
    if (!finished) {
      finished = true;
      clearInterval(progressInterval);
      await stopWorkers?.();
    }
    throw error;
  });
}

main().catch(async (error) => {
  console.error('[wallet-generate] failed:', error instanceof Error ? error.message : error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
