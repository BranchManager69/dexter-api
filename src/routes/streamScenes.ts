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
    if (scenePassword) {
      const provided =
        typeof req.body?.password === 'string'
          ? req.body.password.trim()
          : typeof req.headers['x-dextervision-password'] === 'string'
            ? String(req.headers['x-dextervision-password']).trim()
            : '';
      if (provided !== scenePassword) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
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
