import { parentPort, workerData } from 'node:worker_threads';
import { Keypair } from '@solana/web3.js';

if (!parentPort) {
  throw new Error('wallet generate worker requires a parent port');
}

const prefixRaw: string = typeof workerData?.prefix === 'string' ? workerData.prefix : '';
const exactMatch = Boolean(workerData?.exactMatch);

const normalizedPrefix = exactMatch ? prefixRaw.trim() : prefixRaw.trim().toLowerCase();

function matchesPrefix(publicKey: string): boolean {
  if (!normalizedPrefix) return true;
  const prefix = publicKey.slice(0, normalizedPrefix.length);
  if (exactMatch) {
    return prefix === normalizedPrefix;
  }
  return prefix.toLowerCase() === normalizedPrefix.toLowerCase();
}

let running = true;

parentPort.on('message', (message: any) => {
  if (message && message.type === 'stop') {
    running = false;
  }
});

let attempts = 0;

while (running) {
  attempts += 1;
  const candidate = Keypair.generate();
  const publicKey = candidate.publicKey.toBase58();
  if (!matchesPrefix(publicKey)) {
    continue;
  }

  const secretKey = Buffer.from(candidate.secretKey);
  parentPort.postMessage({
    type: 'wallet',
    publicKey,
    secretKey,
    attempts,
  });
  attempts = 0;
}

parentPort.postMessage({ type: 'stopped' });
