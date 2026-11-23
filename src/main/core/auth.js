'use strict';
// Přihlášení Microsoft účtem: OAuth 2.0 (PKCE) → Xbox Live → XSTS → Minecraft.
// Vyžaduje vlastní Azure aplikaci (clientId) schválenou Mojangem pro Minecraft API.

const crypto = require('crypto');
const { getJson, postJson, request } = require('./http');

const AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const SCOPE = 'XboxLive.signin offline_access';

const XERR = {
  2148916233: 'Tento Microsoft účet nemá Xbox profil. Přihlas se jednou na minecraft.net a zkus to znovu.',
  2148916235: 'Xbox Live není v tvé zemi dostupný.',
  2148916236: 'Účet vyžaduje ověření dospělosti (Jižní Korea).',
  2148916237: 'Účet vyžaduje ověření dospělosti (Jižní Korea).',
  2148916238: 'Jde o dětský účet – musí ho přidat dospělý do rodinné skupiny Microsoft.'
};

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function authorizeUrl(clientId, redirectUri, challenge, state) {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPE,
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });
  return `${AUTHORIZE}?${q}`;
}

async function tokenRequest(params) {
  const res = await request(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Microsoft přihlášení selhalo (${res.status}).`);
  return data;
}

function exchangeCode(clientId, redirectUri, code, verifier) {
  return tokenRequest({ client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, scope: SCOPE });
}

function refresh(clientId, refreshToken) {
  return tokenRequest({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE });
}

async function xbox(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    });
  } catch (e) {
    let code;
    try {
      code = JSON.parse(e.body || '{}').XErr;
    } catch {
      /* ignore */
    }
    throw new Error(XERR[code] || `Xbox přihlášení selhalo${code ? ` (${code})` : ''}.`);
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  return { uhs, xsts: xsts.Token };
}

async function minecraft(uhs, xstsToken) {
  let mc;
  try {
    mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${uhs};${xstsToken}`
    });
  } catch (e) {
    if (e.status === 403 && /Invalid app registration/i.test(e.body || e.message)) {
      throw new Error('Mojang přihlášení přes launcher zatím nepustil (schválení se může pár hodin propisovat). Zkus to prosím později, mezitím hraj přes klasický Minecraft Launcher.');
    }
    if (e.status === 429) throw new Error('Příliš mnoho pokusů o přihlášení. Zkus to znovu za pár minut.');
    throw e;
  }
  const headers = { Authorization: `Bearer ${mc.access_token}` };
  let profile;
  try {
    profile = await getJson('https://api.minecraftservices.com/minecraft/profile', { headers });
  } catch (e) {
    if (e.status === 404) throw new Error('Tento účet nevlastní Minecraft: Java Edition.');
    throw e;
  }
  const activeSkin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || (profile.skins || [])[0];
  return {
    uuid: profile.id,
    name: profile.name,
    accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
    skin: activeSkin ? { url: activeSkin.url, variant: activeSkin.variant } : null
  };
}

/** Kompletní řetězec od Microsoft tokenu k Minecraft profilu. */
async function fromMicrosoft(ms) {
  const { uhs, xsts } = await xbox(ms.access_token);
  const mc = await minecraft(uhs, xsts);
  return { ...mc, refreshToken: ms.refresh_token };
}

module.exports = { pkce, authorizeUrl, exchangeCode, refresh, fromMicrosoft, SCOPE };
