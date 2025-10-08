import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

const creatorKeypair = Keypair.generate();

const prismaManagedWalletFindUnique = vi.fn(async () => ({
  public_key: creatorKeypair.publicKey.toBase58(),
  encrypted_private_key: '{}',
}));

vi.mock('../src/prisma.js', () => ({
  default: {
    managed_wallets: {
      findUnique: prismaManagedWalletFindUnique,
    },
  },
}));

vi.mock('../src/wallets/manager.js', () => ({
  loadManagedWallet: vi.fn(async () => ({
    address: creatorKeypair.publicKey.toBase58(),
    label: null,
    publicKey: creatorKeypair.publicKey,
    keypair: creatorKeypair,
  })),
}));

// Mock logger to avoid noisy output during tests.
vi.mock('../src/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
    }),
  },
  style: {
    status: () => '',
    kv: () => '',
  },
}));

describe('launchPumpFunToken', () => {
  beforeEach(() => {
    prismaManagedWalletFindUnique.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads metadata, requests local transaction, and signs it in simulate mode', async () => {
    const metadataResponse = {
      metadataUri: 'https://pump.fun/ipfs/test',
      metadata: { name: 'Test', symbol: 'TEST' },
    };

    const compiledMessage = new TransactionMessage({
      payerKey: creatorKeypair.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(compiledMessage);
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(metadataResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ transaction: serialized }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    const { launchPumpFunToken } = await import('../src/solana/pumpfunService.js');

    const result = await launchPumpFunToken({
      creatorWalletAddress: creatorKeypair.publicKey.toBase58(),
      metadata: {
        name: 'Test Token',
        symbol: 'TEST',
        description: 'Example',
        image: {
          kind: 'base64',
          base64: Buffer.from([0, 0, 0, 0]).toString('base64'),
          contentType: 'image/png',
          filename: 'test.png',
        },
      },
      devBuySol: 0.01,
      slippagePercent: 2,
      priorityFeeLamports: 5000,
      simulateOnly: true,
    });

    expect(result.simulateOnly).toBe(true);
    expect(typeof result.mintAddress).toBe('string');
    expect(typeof result.mintSecretKey).toBe('string');
    expect(result.metadataUri).toBe(metadataResponse.metadataUri);
    expect(result.transactionSignature).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prismaManagedWalletFindUnique).toHaveBeenCalledTimes(1);
  });
});
