#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { config as loadEnv } from 'dotenv';
import { x402Version } from 'x402';
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client';
import {
  createSigner,
  isSvmSignerWallet,
  settleResponseFromHeader,
} from 'x402/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const facilitatorEnvPath = path.resolve(__dirname, '../../x402-facilitator/.env');

if (fs.existsSync(facilitatorEnvPath)) {
  loadEnv({ path: facilitatorEnvPath, override: false });
}
loadEnv({ override: false });

const PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('SOLANA_PRIVATE_KEY not set. Export it or populate x402-facilitator/.env.');
  process.exit(1);
}

const API_BASE = process.env.X402_TEST_API_BASE ?? 'https://api.dexter.cash';
const PAID_ROUTE = '/paid/test';
const endpoint = new URL(PAID_ROUTE, API_BASE).toString();

async function requestWithoutPayment() {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (res.status !== 402) {
    throw new Error(`Expected 402, received ${res.status}. Body: ${await res.text()}`);
  }

  const body = await res.json();
  if (!Array.isArray(body.accepts) || body.accepts.length === 0) {
    throw new Error('No payment requirements returned in 402 response.');
  }

  return { body, paymentRequirements: selectPaymentRequirements(body.accepts, 'solana', 'exact') ?? body.accepts[0] };
}

async function main() {
  console.log(`Requesting ${endpoint} (expecting 402)...`);
  const { body, paymentRequirements } = await requestWithoutPayment();
  console.log('Payment requirements received:', {
    network: paymentRequirements.network,
    asset: paymentRequirements.asset,
    amount: paymentRequirements.maxAmountRequired,
    description: paymentRequirements.description,
  });

  if (!paymentRequirements.extra?.feePayer) {
    throw new Error('Facilitator did not advertise a fee payer in paymentRequirements.extra.');
  }

  console.log('Preparing Solana signer...');
  const signer = await createSigner(paymentRequirements.network, PRIVATE_KEY);
  if (!isSvmSignerWallet(signer)) {
    throw new Error('Loaded signer is not a valid Solana wallet.');
  }

  console.log('Creating payment header...');
  const header = await createPaymentHeader(signer, body.x402Version ?? x402Version, paymentRequirements);

  console.log('Retrying request with X-PAYMENT header...');
  const payoff = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-PAYMENT': header,
    },
    body: JSON.stringify({}),
  });

  const settlementHeader = payoff.headers.get('X-PAYMENT-RESPONSE');
  if (!payoff.ok) {
    const errorBody = await payoff.text();
    throw new Error(`Paid request failed: status=${payoff.status}, body=${errorBody}`);
  }

  const json = await payoff.json();
  console.log('Paid endpoint responded:', json);

  if (settlementHeader) {
    const settlement = settleResponseFromHeader(settlementHeader);
    console.log('Settlement details:', settlement);
  } else {
    console.warn('No X-PAYMENT-RESPONSE header found; settlement details unavailable.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
