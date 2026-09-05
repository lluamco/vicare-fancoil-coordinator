// Abstracció per guardar els tokens de ViCare i el "code_verifier" PKCE temporal.
//
// A Vercel les funcions serverless no tenen disc persistent, així que si hi ha
// Upstash Redis configurat el fem servir. La integració concreta d'aquest projecte
// exposa la URL/token REST amb els noms UPSTASH_REDIS_REST_KV_REST_API_URL i
// UPSTASH_REDIS_REST_KV_REST_API_TOKEN (comprova-ho a Vercel → Settings →
// Environment Variables si mai canvia); també s'accepten els noms "estàndard"
// UPSTASH_REDIS_REST_URL/TOKEN o KV_REST_API_URL/TOKEN per si un dia es reconnecta
// amb una altra integració.
//
// En local (npm run dev), si no hi ha Redis configurat, cau automàticament al fitxer
// .tokens.vicare.json de sempre, perquè el flux de desenvolupament no canviï.
const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', '.tokens.vicare.json');
const TOKENS_KEY = 'vicare:tokens';
const PKCE_PREFIX = 'vicare:pkce:';
const PKCE_TTL_SECONDS = 600; // 10 min: temps de sobres per completar el login OAuth

let redis = null;
let redisChecked = false;

function resolveRedisEnv() {
  const candidates = [
    ['UPSTASH_REDIS_REST_KV_REST_API_URL', 'UPSTASH_REDIS_REST_KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
  ];
  for (const [urlKey, tokenKey] of candidates) {
    if (process.env[urlKey] && process.env[tokenKey]) {
      return { url: process.env[urlKey], token: process.env[tokenKey] };
    }
  }
  return null;
}

function getRedis() {
  if (redisChecked) return redis;
  redisChecked = true;
  const env = resolveRedisEnv();
  if (env) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis(env);
  }
  return redis;
}

// --- Tokens ViCare (access_token / refresh_token) ---

async function loadTokens() {
  const r = getRedis();
  if (r) {
    const data = await r.get(TOKENS_KEY);
    return data || { access_token: null, refresh_token: null };
  }
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return { access_token: null, refresh_token: null };
  }
}

async function saveTokens(tokens) {
  const r = getRedis();
  if (r) {
    await r.set(TOKENS_KEY, tokens);
    return;
  }
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// --- PKCE verifier temporal (entre /auth/vicare i /auth/vicare/callback) ---
// Es guarda per "state" (identificador aleatori d'aquest intent de login concret),
// necessari perquè a Vercel cada petició pot anar a una instància diferent i ja
// no podem confiar en una variable en memòria del procés.

async function savePkceVerifier(state, verifier) {
  const r = getRedis();
  if (r) {
    await r.set(PKCE_PREFIX + state, verifier, { ex: PKCE_TTL_SECONDS });
    return;
  }
  global.__pkceMem = global.__pkceMem || new Map();
  global.__pkceMem.set(state, verifier);
}

async function takePkceVerifier(state) {
  const r = getRedis();
  if (r) {
    const v = await r.get(PKCE_PREFIX + state);
    if (v) await r.del(PKCE_PREFIX + state);
    return v || null;
  }
  global.__pkceMem = global.__pkceMem || new Map();
  const v = global.__pkceMem.get(state) || null;
  global.__pkceMem.delete(state);
  return v;
}

module.exports = { loadTokens, saveTokens, savePkceVerifier, takePkceVerifier };
