import type { Express, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { executeBuy, executeSell, listTokenBalances, previewSellAll, resolveToken } from '../solana/tradingService.js';
import { logger, style } from '../logger.js';

function parseNumber(input: unknown, fallback = 0): number {
  const num = Number(input);
  return Number.isFinite(num) ? num : fallback;
}

export function registerSolanaRoutes(app: Express) {
  const log = logger.child('solana');
  app.get('/api/solana/balances', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const walletAddress = typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : null;
      if (!walletAddress) {
        return res.status(400).json({ ok: false, error: 'wallet_address_required' });
      }
      const wallet = await prisma.managed_wallets.findUnique({ where: { public_key: walletAddress } });
      if (!wallet) {
        return res.status(404).json({ ok: false, error: 'wallet_not_found' });
      }
      if (wallet.assigned_supabase_user_id && wallet.assigned_supabase_user_id !== supabaseUserId) {
        return res.status(403).json({ ok: false, error: 'forbidden_wallet' });
      }
      const publicKey = new PublicKey(wallet.public_key);
      const balances = await listTokenBalances({
        walletPublicKey: publicKey,
        minimumUi: parseNumber(req.query.minUi, 0),
        limit: parseNumber(req.query.limit, 10),
      });
      return res.json({ ok: true, balances, user: supabaseUserId });
    } catch (error: any) {
      log.error(`${style.status('balances', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.get('/api/solana/resolve-token', async (req: Request, res: Response) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const results = await resolveToken(query, parseNumber(req.query.limit, 5));
      return res.json({ ok: true, results });
    } catch (error: any) {
      log.error(`${style.status('resolve', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.post('/api/solana/buy', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await executeBuy({
        supabaseUserId,
        walletAddress: typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : null,
        amountSol: parseNumber(req.body?.amountSol, 0),
        mint: String(req.body?.mint || ''),
        slippageBps: req.body?.slippageBps != null ? Number(req.body.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('buy', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'trade_failed' });
    }
  });

  app.post('/api/solana/sell', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await executeSell({
        supabaseUserId,
        walletAddress: typeof req.body?.walletAddress === 'string' ? req.body.walletAddress.trim() : null,
        mint: String(req.body?.mint || ''),
        amountRaw: typeof req.body?.amountRaw === 'string' ? req.body.amountRaw : undefined,
        percentage: req.body?.percentage != null ? Number(req.body.percentage) : undefined,
        slippageBps: req.body?.slippageBps != null ? Number(req.body.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('sell', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'trade_failed' });
    }
  });

  app.get('/api/solana/preview-sell', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      const result = await previewSellAll({
        supabaseUserId,
        walletAddress: typeof req.query.walletAddress === 'string' ? req.query.walletAddress.trim() : null,
        mint: String(req.query.mint || ''),
        slippageBps: req.query.slippageBps != null ? Number(req.query.slippageBps) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (error: any) {
      log.error(`${style.status('preview', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(400).json({ ok: false, error: error?.message || 'preview_failed' });
    }
  });
}
