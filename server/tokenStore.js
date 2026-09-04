// Magatzem persistent de tokens (ViCare) fent servir Upstash Redis.
// Necessari a Vercel perquè les funcions serverless no mantenen estat en
// memòria entre invocacions (cada petició pot anar a una instància diferent).
//
// Variables d'entorn necessàries (les proporciona Upstash / la integració de Vercel):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const TOKENS_KEY = 'vicare:tokens';
const PKCE_PREFIX = 'vicare:pkce:';
const PKCE_TTL_SECONDS = 600; // 10 minuts, igual que abans amb Vercel KV

// --- Tokens (access_token / refresh_token) ---

async function saveTokens(tokens) {
  await redis.set(TOKENS_KEY, tokens);
  return tokens;
}

async function loadTokens() {
  const tokens = await redis.get(TOKENS_KEY);
  return tokens || {};
}

// --- PKCE verifier (viu només durant el login, 10 min) ---

async function savePkceVerifier(state, verifier) {
  await redis.set(PKCE_PREFIX + state, verifier, { ex: PKCE_TTL_SECONDS });
}

// "take" = llegeix i esborra alhora, perquè no es pugui reutilitzar el mateix state
async function takePkceVerifier(state) {
  const key = PKCE_PREFIX + state;
  const verifier = await redis.get(key);
  if (verifier) await redis.del(key);
  return verifier || null;
}

module.exports = { saveTokens, loadTokens, savePkceVerifier, takePkceVerifier };
