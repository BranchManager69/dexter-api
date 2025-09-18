import type { Express } from 'express';
import { paymentMiddleware, type SolanaAddress } from 'x402-express';
import type { RoutesConfig, FacilitatorConfig, Resource } from 'x402/types';
import type { Env } from '../env.js';

const PRO_SUBSCRIBE_ROUTE = '/pro/subscribe';

export function registerX402Routes(app: Express, env: Env) {
  if (!env.X402_ENABLED) {
    return;
  }

  const facilitator: FacilitatorConfig = {
    url: env.X402_FACILITATOR_URL as Resource,
  };

  const routes: RoutesConfig = {
    [`POST ${PRO_SUBSCRIBE_ROUTE}`]: {
      price: {
        amount: env.X402_PRICE_AMOUNT,
        asset: {
          address: env.X402_ASSET_MINT,
          decimals: env.X402_ASSET_DECIMALS,
        },
      },
      network: 'solana',
      config: {
        description: env.X402_PRICE_DESCRIPTION,
        discoverable: false,
      },
    },
  };

  app.use(paymentMiddleware(env.X402_PAY_TO as SolanaAddress, routes, facilitator));

  app.post(PRO_SUBSCRIBE_ROUTE, (_req, res) => {
    res.json({ ok: true, resource: 'Pro subscription activated (test stub)' });
  });
}
