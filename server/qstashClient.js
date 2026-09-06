// Ajuda a programar accions retardades (per exemple, engegar/aturar el fancoil
// Tuya uns minuts després del ViCare) fent servir QStash d'Upstash, que és qui
// s'encarrega de "recordar" la crida encara que la nostra app estigui adormida
// (a Vercel no podem simplement esperar N minuts dins d'una petició).
// Importació diferida: si QStash encara no està configurat/instal·lat, la resta
// de l'app (ViCare, panell...) ha de continuar funcionant igualment.
let sdk = null;
function loadSdk() {
  if (!sdk) sdk = require('@upstash/qstash');
  return sdk;
}

function getClient() {
  const { QSTASH_TOKEN } = process.env;
  if (!QSTASH_TOKEN) return null;
  const { Client } = loadSdk();
  return new Client({ token: QSTASH_TOKEN });
}

function isConfigured() {
  return Boolean(process.env.QSTASH_TOKEN && process.env.PUBLIC_BASE_URL);
}

// Publica un missatge perquè QStash cridi `path` (relatiu, ex: /api/tuya/delayed-action)
// d'aquí a `delayMinutes` minuts, amb el `body` indicat.
async function scheduleDelayed(path, body, delayMinutes) {
  const client = getClient();
  if (!client) throw new Error('QStash no configurat (falta QSTASH_TOKEN)');
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) throw new Error('Falta PUBLIC_BASE_URL a les variables d\'entorn');

  const url = baseUrl.replace(/\/$/, '') + path;
  const delaySeconds = Math.max(0, Math.round(Number(delayMinutes) * 60));
  return client.publishJSON({ url, body, delay: `${delaySeconds}s` });
}

// Verifica que una petició entrant realment ve de QStash (signatura HMAC).
// Cal el "raw body" tal qual (string), no l'objecte ja parsejat.
async function verifyIncoming(req) {
  const { QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, PUBLIC_BASE_URL } = process.env;
  if (!QSTASH_CURRENT_SIGNING_KEY || !QSTASH_NEXT_SIGNING_KEY) {
    throw new Error('QStash no configurat (falten les signing keys)');
  }
  const receiver = new (loadSdk().Receiver)({
    currentSigningKey: QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: QSTASH_NEXT_SIGNING_KEY,
  });
  const signature = req.header('Upstash-Signature');
  if (!signature) return false;
  const url = PUBLIC_BASE_URL.replace(/\/$/, '') + req.originalUrl;
  return receiver.verify({ body: req.rawBody || '', signature, url });
}

module.exports = { isConfigured, scheduleDelayed, verifyIncoming };
