import type { Express, Request, Response } from 'express';
import {
  SCENES,
  isSceneName,
  readSceneState,
  writeSceneState,
  type SceneName,
} from '../streamScenes/state.js';
import type { Env } from '../env.js';
import { logger, style } from '../logger.js';
import { getSupabaseUserFromAccessToken } from '../utils/supabaseAdmin.js';

interface SceneResponse {
  ok: boolean;
  scene: SceneName;
  updatedAt: string;
  scenes?: readonly SceneName[];
}

function sendScene(res: Response, state: { scene: SceneName; updatedAt: string }, extra?: Partial<SceneResponse>) {
  const payload: SceneResponse = {
    ok: true,
    scene: state.scene,
    updatedAt: state.updatedAt,
    ...extra,
  };
  res.json(payload);
}

export function registerStreamSceneRoutes(app: Express, env: Env) {
  const log = logger.child('stream.scene');
  const scenePassword = String(env.STREAM_SCENE_PASSWORD || '').trim();

  app.get('/stream/scene', async (_req: Request, res: Response) => {
    const state = await readSceneState();
    log.debug(
      `${style.status('read', 'debug')} ${style.kv('scene', state.scene)} ${style.kv('updated', state.updatedAt)}`,
      state
    );
    sendScene(res, state, { scenes: SCENES });
  });

  app.post('/stream/scene', async (req: Request, res: Response) => {
    const providedPassword = typeof req.body?.password === 'string'
      ? req.body.password.trim()
      : typeof req.headers['x-dextervision-password'] === 'string'
        ? String(req.headers['x-dextervision-password']).trim()
        : '';

    let isAuthorised = false;

    if (scenePassword && providedPassword === scenePassword) {
      isAuthorised = true;
    }

    if (!isAuthorised) {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      try {
        const user = await getSupabaseUserFromAccessToken(bearerToken);
        const roles = extractRoles(user.app_metadata?.roles);
        const isSuperAdmin = roles.includes('superadmin') || normalizeBoolean(user.user_metadata?.isSuperAdmin);
        const isPro = roles.includes('pro') || normalizeBoolean(user.user_metadata?.isProMember);

        if (!isSuperAdmin && !isPro) {
          return res.status(403).json({ ok: false, error: 'pro_membership_required' });
        }

        isAuthorised = true;
      } catch (error: any) {
        log.warn(
          `${style.status('auth', 'warn')} ${style.kv('event', 'pro_access_check_failed')} ${style.kv('error', error?.message || error)}`,
          { error: error?.message || error }
        );
        return res.status(403).json({ ok: false, error: 'pro_membership_required' });
      }
    }

    const candidate = typeof req.body?.scene === 'string' ? req.body.scene.trim().toLowerCase() : '';
    if (!isSceneName(candidate)) {
      log.warn(
        `${style.status('invalid', 'warn')} ${style.kv('scene', candidate || '∅')}`,
        { scene: candidate }
      );
      return res.status(400).json({
        ok: false,
        error: 'Invalid scene',
        scenes: SCENES,
      });
    }

    const state = await writeSceneState(candidate as SceneName);
    log.success(
      `${style.status('ok', 'success')} ${style.kv('scene', state.scene)} ${style.kv('updated', state.updatedAt)}`,
      state
    );
    sendScene(res, state);
  });
}

function extractBearerToken(req: Request): string | null {
  const rawAuth = req.headers['authorization'] || req.headers['Authorization'];
  if (!rawAuth) return null;
  const header = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function extractRoles(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null) return '';
        return String(entry).trim().toLowerCase();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered ? [lowered] : [];
  }
  return [];
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === '1' || lowered === 'yes';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}
