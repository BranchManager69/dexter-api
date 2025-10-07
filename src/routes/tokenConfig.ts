import type { Express, Request, Response } from 'express';
import type { Env } from '../env.js';
import { logger, style } from '../logger.js';
import { getTokenConfig, serializeTokenConfig } from '../tokens/tokenConfig.js';

const routeLog = logger.child('token.config.route');

export function registerTokenConfigRoutes(app: Express, env: Env) {
  app.get('/api/token/config', async (req: Request, res: Response) => {
    const chain =
      typeof req.query.chain === 'string' && req.query.chain.trim()
        ? req.query.chain.trim().toLowerCase()
        : 'solana';

    const mint =
      typeof req.query.mint === 'string' && req.query.mint.trim()
        ? req.query.mint.trim()
        : env.DEXTER_TOKEN_MINT?.trim()
          ? env.DEXTER_TOKEN_MINT.trim()
          : null;

    if (!mint) {
      return res.status(400).json({ ok: false, error: 'mint_required' });
    }

    try {
      const record = await getTokenConfig({ chain, mintAddress: mint, refresh: false });
      const payload = serializeTokenConfig(record);
      if (!payload) {
        return res.status(404).json({ ok: false, error: 'token_config_not_found' });
      }
      return res.json({ ok: true, token: payload });
    } catch (error: any) {
      routeLog.error(
        `${style.status('token-config', 'error')} ${style.kv('event', 'fetch_failed')} ${style.kv('mint', mint)} ${style.kv('error', error?.message || error)}`,
        error,
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
