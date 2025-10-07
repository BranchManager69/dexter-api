import { logger, style } from '../logger.js';
import type { Env } from '../env.js';
import { refreshTokenConfig } from '../tokens/tokenConfig.js';

const refreshLog = logger.child('token.config.refresh');
const REFRESH_INTERVAL_MS = 10_000;

let refreshTimer: NodeJS.Timeout | null = null;

async function runRefresh(mint: string) {
  try {
    const record = await refreshTokenConfig({ mintAddress: mint });
    refreshLog.info(
      `${style.status('refresh', 'success')} ${style.kv('mint', mint)} ${style.kv('symbol', record?.symbol || 'n/a')} ${style.kv('decimals', record?.decimals ?? 'n/a')}`,
    );
  } catch (error: any) {
    refreshLog.error(
      `${style.status('refresh', 'error')} ${style.kv('mint', mint)} ${style.kv('error', error?.message || error)}`,
      error,
    );
  }
}

export function startTokenConfigRefreshLoop(env: Env) {
  if (refreshTimer) {
    return;
  }

  const mint = env.DEXTER_TOKEN_MINT?.trim();
  if (!mint) {
    refreshLog.warn(`${style.status('refresh', 'warn')} ${style.kv('reason', 'missing_dexter_token_mint')}`);
    return;
  }

  refreshLog.info(`${style.status('refresh', 'start')} ${style.kv('mint', mint)} ${style.kv('interval_ms', REFRESH_INTERVAL_MS)}`);
  runRefresh(mint).catch(() => null);

  refreshTimer = setInterval(() => {
    runRefresh(mint).catch(() => null);
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}
