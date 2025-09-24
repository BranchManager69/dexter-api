#!/usr/bin/env ts-node
import { Command } from 'commander';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { useReferral } from '@jup-ag/referral';
import bs58 from 'bs58';
import fs from 'node:fs';

const program = new Command();

program
  .option('--rpc <url>', 'Solana RPC endpoint', process.env.SOLANA_RPC_ENDPOINT)
  .option('--admin-key <path>', 'Path to admin keypair JSON')
  .option('--admin-secret <base58>', 'Base58-encoded admin secret key')
  .option('--project-base <base58>', 'Base key for the project PDA (defaults to admin public key)')
  .option('--project-name <name>', 'Project name', 'Dexter')
  .option('--default-share-bps <bps>', 'Default share for referrers in basis points', '0')
  .option('--referral-name <name>', 'Referral account name', 'dexter-platform')
  .option('--mint <mint...>', 'One or more token mints to initialize (exact in/withdrawal mints)')
  .option('--payer-same-as-admin', 'Use the admin keypair as payer', false)
  .option('--payer-key <path>', 'Optional separate payer keypair JSON')
  .option('--payer-secret <base58>', 'Optional separate payer base58 secret')
  .option('--skip-project', 'Skip project initialization if already created', false)
  .option('--skip-referral', 'Skip referral account initialization', false)
  .parse(process.argv);

const opts = program.opts();

if (!opts.rpc) {
  console.error('RPC endpoint is required (pass --rpc or set SOLANA_RPC_ENDPOINT).');
  process.exit(1);
}

function loadKeypairFromPath(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'));
  const secretKey = new Uint8Array(raw);
  return Keypair.fromSecretKey(secretKey);
}

function loadKeypairFromSecret(secret: string): Keypair {
  const decoded = bs58.decode(secret);
  return Keypair.fromSecretKey(decoded);
}

function resolveKeypair(path?: string, secret?: string): Keypair | null {
  if (path) return loadKeypairFromPath(path);
  if (secret) return loadKeypairFromSecret(secret);
  return null;
}

async function main() {
  const connection = new Connection(opts.rpc, 'confirmed');
  console.log(`[referral] RPC endpoint: ${opts.rpc}`);

  const adminKeypair = resolveKeypair(opts.adminKey, opts.adminSecret);
  if (!adminKeypair) {
    console.error('Admin keypair is required (--admin-key or --admin-secret).');
    process.exit(1);
  }
  console.log(`[referral] Admin: ${adminKeypair.publicKey.toBase58()}`);

  let payerKeypair: Keypair;
  if (opts.payerSameAsAdmin || (!opts.payerKey && !opts.payerSecret)) {
    payerKeypair = adminKeypair;
  } else {
    const payer = resolveKeypair(opts.payerKey, opts.payerSecret);
    if (!payer) {
      console.error('Failed to load payer keypair.');
      process.exit(1);
    }
    payerKeypair = payer;
  }
  console.log(`[referral] Payer: ${payerKeypair.publicKey.toBase58()}`);

  const projectBase = opts.projectBase
    ? new PublicKey(opts.projectBase)
    : adminKeypair.publicKey;

  const referral = useReferral(connection);

  // Derive PDAs
  const projectPubKey = PublicKey.findProgramAddressSync(
    [Buffer.from('project'), projectBase.toBuffer()],
    referral.program.programId,
  )[0];

  const referralAccountPubKey = referral.getReferralAccountWithNamePubKey({
    projectPubKey,
    name: opts.referralName,
  });

  const mints: PublicKey[] = (opts.mint && opts.mint.length)
    ? opts.mint.map((mint: string) => new PublicKey(mint))
    : [new PublicKey('So11111111111111111111111111111111111111112')];

  console.log(`[referral] Project PDA: ${projectPubKey.toBase58()}`);
  console.log(`[referral] Referral account PDA: ${referralAccountPubKey.toBase58()}`);
  console.log(`[referral] Mints: ${mints.map((pk) => pk.toBase58()).join(', ')}`);

  if (!opts.skipProject) {
    try {
      console.log('[referral] Initializing project (if needed)...');
      await referral.initializeProject({
        adminPubKey: adminKeypair.publicKey,
        basePubKey: projectBase,
        name: opts.projectName,
        defaultShareBps: Number(opts.defaultShareBps || '0'),
      }, adminKeypair);
      console.log('[referral] Project initialized.');
    } catch (error: any) {
      if (error.message?.includes('already initialized')) {
        console.log('[referral] Project already exists, skipping.');
      } else {
        console.error('[referral] Project initialization failed:', error.message || error);
        process.exit(1);
      }
    }
  }

  if (!opts.skipReferral) {
    try {
      console.log('[referral] Initializing referral account (if needed)...');
      await referral.initializeReferralAccountWithName({
        projectPubKey,
        partnerPubKey: adminKeypair.publicKey,
        payerPubKey: payerKeypair.publicKey,
        name: opts.referralName,
      }, adminKeypair, payerKeypair);
      console.log('[referral] Referral account initialized.');
    } catch (error: any) {
      if (error.message?.includes('already initialized')) {
        console.log('[referral] Referral account already exists, skipping.');
      } else {
        console.error('[referral] Referral account initialization failed:', error.message || error);
        process.exit(1);
      }
    }
  }

  for (const mint of mints) {
    const referralTokenAccountPubKey = referral.getReferralTokenAccountPubKey({
      referralAccountPubKey,
      mint,
    });
    console.log(`[referral] Token account PDA for ${mint.toBase58()}: ${referralTokenAccountPubKey.toBase58()}`);

    try {
      console.log(`[referral] Initializing referral token account for ${mint.toBase58()}...`);
      await referral.initializeReferralTokenAccount({
        payerPubKey: payerKeypair.publicKey,
        referralAccountPubKey,
        mint,
      }, payerKeypair);
      console.log('[referral] Token account initialized.');
    } catch (error: any) {
      if (error.message?.includes('already in use')) {
        console.log('[referral] Token account already exists, skipping.');
      } else {
        console.error('[referral] Token account initialization failed:', error.message || error);
        process.exit(1);
      }
    }
  }

  console.log('Referral setup complete. Values:');
  console.log(`PROJECT_PUBKEY=${projectPubKey.toBase58()}`);
  console.log(`REFERRAL_ACCOUNT=${referralAccountPubKey.toBase58()}`);
  mints.forEach((mint) => {
    const tokenPda = referral.getReferralTokenAccountPubKey({
      referralAccountPubKey,
      mint,
    });
    console.log(`REFERRAL_TOKEN_ACCOUNT_${mint.toBase58()}=${tokenPda.toBase58()}`);
  });
}

main().catch((error) => {
  console.error('[referral] fatal error', error);
  process.exit(1);
});
