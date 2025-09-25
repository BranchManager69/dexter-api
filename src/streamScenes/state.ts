import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { logger, style } from '../logger.js';

export const SCENES = ['market-live', 'standby', 'game-show'] as const;
export type SceneName = (typeof SCENES)[number];

export interface SceneState {
  scene: SceneName;
  updatedAt: string;
}

const STATE_DIR = path.join(process.cwd(), 'dextervision');
export const SCENE_STATE_PATH = path.join(STATE_DIR, 'scene-state.json');
const DEFAULT_SCENE: SceneName = 'market-live';
const log = logger.child('streamScenes');

function buildState(scene: SceneName): SceneState {
  return { scene, updatedAt: new Date().toISOString() };
}

function isSceneState(value: unknown): value is SceneState {
  if (!value || typeof value !== 'object') return false;
  const cast = value as Record<string, unknown>;
  if (typeof cast.scene !== 'string') return false;
  if (!SCENES.includes(cast.scene as SceneName)) return false;
  if (typeof cast.updatedAt !== 'string') return false;
  return true;
}

async function ensureStateFile() {
  await mkdir(STATE_DIR, { recursive: true });
  try {
    await access(SCENE_STATE_PATH, fsConstants.F_OK);
  } catch {
    const initial = buildState(DEFAULT_SCENE);
    await writeFile(SCENE_STATE_PATH, JSON.stringify(initial, null, 2) + '\n', 'utf8');
  }
}

export async function readSceneState(): Promise<SceneState> {
  await ensureStateFile();
  try {
    const raw = await readFile(SCENE_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (isSceneState(parsed)) {
      return parsed;
    }
  } catch (error) {
    log.warn(
      `${style.status('read', 'warn')} ${style.kv('path', SCENE_STATE_PATH)} ${style.kv('error', (error as Error)?.message || error)}`,
      error
    );
  }
  const fallback = buildState(DEFAULT_SCENE);
  await writeFile(SCENE_STATE_PATH, JSON.stringify(fallback, null, 2) + '\n', 'utf8');
  return fallback;
}

export async function writeSceneState(scene: SceneName): Promise<SceneState> {
  await ensureStateFile();
  const next = buildState(scene);
  await writeFile(SCENE_STATE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function isSceneName(value: unknown): value is SceneName {
  return typeof value === 'string' && SCENES.includes(value as SceneName);
}
