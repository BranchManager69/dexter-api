#!/usr/bin/env node
// End-to-end OAuth probe using a disposable Supabase user.
// 1) Create test user via admin API
// 2) Sign in with password to get refresh_token
// 3) /authorize -> request_id, /exchange -> code, /token -> success
// 4) Delete test user

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

function loadEnv() {
  const here = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const candidates = [
    path.resolve(here, '../../dexter-ops/.env'),
    path.resolve(here, '../.env'),
    path.resolve(here, '../../.env'),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) dotenv.config({ path: f });
  }
}

function assertEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

async function main() {
  loadEnv();
  const SUPABASE_URL = assertEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = assertEnv('SUPABASE_SERVICE_ROLE_KEY');
  const SUPABASE_ANON_KEY = assertEnv('SUPABASE_ANON_KEY');
  assertEnv('CONNECTOR_CODE_SALT');

  const rawBase = process.env.API_BASE_URL || process.env.DEXTER_API_BASE_URL || 'https://api.dexter.cash/api/';
  const API_BASE = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  console.log('[probe] API_BASE', API_BASE);
  const CLIENT_ID = process.env.TOKEN_AI_OIDC_CLIENT_ID || 'cid_a859560609a6448aa2f3a1c29f6ab496';
  const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';

  const uniq = crypto.randomBytes(6).toString('hex');
  const email = `probe_${uniq}@dexter.cash`;
  const password = `Pw_${crypto.randomBytes(12).toString('hex')}`;

  const adminHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };

  const signInHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };

  let userId = null;
  let refreshToken = null;
  try {
    // 1) Create user (email confirmed)
    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST', headers: adminHeaders,
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!createResp.ok) throw new Error(`admin create failed ${createResp.status}`);
    const createJson = await createResp.json();
    userId = createJson?.user?.id || createJson?.id || null;
    if (!userId) throw new Error('user id missing');
    console.log('[probe] created user', email, userId);

    // 2) Sign in with password (anon key)
    const tokenResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: signInHeaders,
      body: JSON.stringify({ email, password }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok) throw new Error(`password sign-in failed ${tokenResp.status}: ${JSON.stringify(tokenJson)}`);
    refreshToken = tokenJson?.refresh_token;
    if (!refreshToken) throw new Error('refresh_token missing');
    console.log('[probe] got refresh_token');

    // 3) /authorize
    const url = new URL('connector/oauth/authorize', API_BASE);
    url.searchParams.set('client_id', CLIENT_ID);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('response_mode', 'json');
    const authResp = await fetch(url.toString());
    console.log('[probe] authorize status', authResp.status, authResp.headers.get('content-type'));
    const authText = await authResp.text();
    let authJson;
    try {
      authJson = JSON.parse(authText);
    } catch (err) {
      throw new Error(`authorize response not JSON: ${authResp.status}: ${authText.slice(0, 200)}`);
    }
    if (!authResp.ok || !authJson?.request_id) throw new Error(`authorize failed ${authResp.status}: ${JSON.stringify(authJson)}`);
    const requestId = authJson.request_id;
    console.log('[probe] authorize ok request_id=', requestId);

    // 4) /exchange
    const exResp = await fetch(new URL('connector/oauth/exchange', API_BASE), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, refresh_token: refreshToken }),
    });
    console.log('[probe] exchange status', exResp.status, exResp.headers.get('content-type'));
    const exText = await exResp.text();
    let exJson;
    try {
      exJson = JSON.parse(exText);
    } catch (err) {
      throw new Error(`exchange response not JSON: ${exResp.status}: ${exText.slice(0, 200)}`);
    }
    if (!exResp.ok || !exJson?.ok || !exJson?.code) throw new Error(`exchange failed ${exResp.status}: ${JSON.stringify(exJson)}`);
    console.log('[probe] exchange ok code=', exJson.code);

    // 5) /token (authorization_code)
    const tkResp = await fetch(new URL('connector/oauth/token', API_BASE), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: exJson.code }),
    });
    console.log('[probe] token status', tkResp.status, tkResp.headers.get('content-type'));
    const tkText = await tkResp.text();
    let tkJson;
    try {
      tkJson = JSON.parse(tkText);
    } catch (err) {
      throw new Error(`token response not JSON: ${tkResp.status}: ${tkText.slice(0, 200)}`);
    }
    if (!tkResp.ok || !tkJson?.access_token) throw new Error(`token failed ${tkResp.status}: ${JSON.stringify(tkJson)}`);
    console.log('[probe] token ok supabase_user_id=', tkJson.supabase_user_id || 'n/a');

    // 6) userinfo sanity
    const uiResp = await fetch(new URL('connector/oauth/userinfo', API_BASE), {
      headers: { Authorization: `Bearer ${tkJson.access_token}` },
    });
    console.log('[probe] userinfo status', uiResp.status, uiResp.headers.get('content-type'));
    const uiText = await uiResp.text();
    let uiJson;
    try {
      uiJson = JSON.parse(uiText);
    } catch (err) {
      throw new Error(`userinfo response not JSON: ${uiResp.status}: ${uiText.slice(0, 200)}`);
    }
    if (!uiResp.ok || !uiJson?.sub) throw new Error(`userinfo failed ${uiResp.status}: ${JSON.stringify(uiJson)}`);
    console.log('[probe] userinfo ok sub=', uiJson.sub);

    console.log('[probe] SUCCESS');
  } catch (e) {
    console.error('[probe] FAILED', e?.message || e);
    process.exitCode = 1;
  } finally {
    // Cleanup user
    if (userId) {
      try {
        const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
          method: 'DELETE', headers: adminHeaders,
        });
        console.log('[probe] deleted user', userId, del.status);
      } catch {}
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
