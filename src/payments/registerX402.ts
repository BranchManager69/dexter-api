import type { Express, Request, Response } from 'express';
import { paymentMiddleware, type SolanaAddress } from 'x402-express';
import { decodePayment } from 'x402/schemes';
import { settleResponseFromHeader, type RoutesConfig, type FacilitatorConfig, type Resource, type PaymentPayload } from 'x402/types';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import type { Env } from '../env.js';

const PRO_SUBSCRIBE_ROUTE = '/pro/subscribe';
const BILLING_PERIOD_DAYS = 30;
const BILLING_PERIOD_MS = BILLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

function coerceHeaderValue(value: number | string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === 'number') return String(value);
  return value ?? null;
}

function addBillingPeriod(base: Date): Date {
  return new Date(base.getTime() + BILLING_PERIOD_MS);
}

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

  app.post(PRO_SUBSCRIBE_ROUTE, async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        res.status(401).json({ ok: false, error: 'authentication_required' });
        return;
      }

      const paymentHeader = req.get('x-payment');
      if (!paymentHeader) {
        res.status(400).json({ ok: false, error: 'payment_header_missing' });
        return;
      }

      let decodedPayment: PaymentPayload;
      try {
        decodedPayment = decodePayment(paymentHeader);
      } catch (error) {
        console.error('[x402/pro-subscribe] failed to decode payment header', error);
        res.status(400).json({ ok: false, error: 'payment_decode_failed' });
        return;
      }

      const existing = await prisma.user_subscriptions.findUnique({
        where: { supabase_user_id: supabaseUserId },
      });

      const now = new Date();
      const periodBase = existing?.current_period_end && existing.current_period_end > now
        ? existing.current_period_end
        : now;
      const currentPeriodEnd = addBillingPeriod(periodBase);

      const paymentPayloadForStorage = JSON.parse(JSON.stringify(decodedPayment));

      const responsePayload = {
        ok: true,
        tier: 'pro' as const,
        status: 'active' as const,
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        previousPeriodEnd: existing?.current_period_end?.toISOString() ?? null,
      };

      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const paymentResponseHeader = coerceHeaderValue(res.getHeader('X-PAYMENT-RESPONSE'));
          let settleResponse: any = null;
          if (paymentResponseHeader) {
            try {
              settleResponse = settleResponseFromHeader(paymentResponseHeader);
            } catch (error) {
              console.error('[x402/pro-subscribe] failed to decode settlement header', error);
            }
          }

          const lastPaymentReference = settleResponse?.transaction ?? null;

          void prisma.user_subscriptions.upsert({
            where: { supabase_user_id: supabaseUserId },
            create: {
              supabase_user_id: supabaseUserId,
              tier: 'pro',
              status: 'active',
              current_period_end: currentPeriodEnd,
              last_payment_at: now,
              last_payment_reference: lastPaymentReference,
              payment_payload: paymentPayloadForStorage,
            },
            update: {
              tier: 'pro',
              status: 'active',
              current_period_end: currentPeriodEnd,
              last_payment_at: now,
              last_payment_reference: lastPaymentReference,
              payment_payload: paymentPayloadForStorage,
              updated_at: new Date(),
            },
          }).catch((error: unknown) => {
            console.error('[x402/pro-subscribe] failed to persist subscription', error);
          });
        }
      });

      res.json(responsePayload);
    } catch (error) {
      console.error('[x402/pro-subscribe] unexpected error', error);
      res.status(500).json({ ok: false, error: 'subscription_error' });
    }
  });
}
