const express = require('express');
const path = require('path');
const crypto = require('crypto');
const vicare = require('./vicareClient');
const tuya = require('./tuyaClient');
const coordinator = require('./coordinator');
const qstash = require('./qstashClient');

const app = express();
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// --- Protecció d'accés: usuari + contrasenya (Basic Auth) ---
// Configura APP_USER i APP_PASSWORD a les variables d'entorn (Vercel i .env local).
// Si no estan configurades, l'app queda oberta (per no tancar-te fora per un oblit),
// però es mostra un avís pel terminal en arrencar.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- Sessió persistent via cookie ---
// El Basic Auth del navegador només es recorda mentre el navegador queda obert;
// si el tanques (o passa una estona), torna a demanar credencials. Per evitar-ho,
// un cop l'usuari/contrasenya són correctes deixem una cookie signada de llarga
// durada, i les properes visites es validen contra la cookie en lloc de tornar
// a demanar Basic Auth.
const AUTH_COOKIE = 'vicare_session';
const COOKIE_MAX_AGE_DAYS = 400; // límit màxim que permeten els navegadors (Chrome, etc.)

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function cookieSecret() {
  // Deriva el secret de les mateixes credencials, així no cal cap variable nova.
  return `${process.env.APP_USER}:${process.env.APP_PASSWORD}`;
}

function signExpiry(expiry) {
  return crypto.createHmac('sha256', cookieSecret()).update(String(expiry)).digest('hex');
}

function isValidSessionCookie(value) {
  if (!value) return false;
  const [expiryStr, sig] = value.split('.');
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry || !sig) return false;
  return safeEqual(sig, signExpiry(expiry));
}

function setSessionCookie(res) {
  const expiry = Date.now() + COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const value = `${expiry}.${signExpiry(expiry)}`;
  const maxAgeSeconds = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`
  );
}

function checkAuth(req, res, next) {
  // Aquesta ruta la crida QStash, no una persona: no coneix la contrasenya,
  // però es verifica amb la seva pròpia signatura (vegeu verifyIncoming).
  if (req.path === '/api/tuya/delayed-action') return next();

  const { APP_USER, APP_PASSWORD } = process.env;
  if (!APP_USER || !APP_PASSWORD) return next();

  // 1) Sessió ja validada anteriorment (cookie vàlida) -> no calen credencials.
  const cookies = parseCookies(req);
  if (isValidSessionCookie(cookies[AUTH_COOKIE])) return next();

  // 2) Si no, comprova Basic Auth i, si és correcte, deixa la cookie per la propera vegada.
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, APP_USER) && safeEqual(pass, APP_PASSWORD)) {
      setSessionCookie(res);
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="ViCare Fancoil"');
  return res.status(401).send('Autenticació necessària');
}

if (!process.env.APP_USER || !process.env.APP_PASSWORD) {
  console.warn('AVÍS: APP_USER/APP_PASSWORD no configurades — el panell queda accessible sense contrasenya.');
}

app.use(checkAuth);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Retorna un JSON d'error amb el detall real de la resposta de l'API (si n'hi ha)
function sendError(res, err) {
  const status = err.response ? err.response.status : 500;
  res.status(status).json({
    error: err.message,
    details: err.response ? err.response.data : undefined,
  });
}

// --- Login ViCare (només cal fer-ho una vegada) ---
app.get('/auth/vicare', async (req, res) => {
  try {
    res.redirect(await vicare.buildAuthUrl());
  } catch (err) {
    res.status(500).send('Error iniciant login amb ViCare: ' + err.message);
  }
});

app.get('/auth/vicare/callback', async (req, res) => {
  try {
    await vicare.exchangeCodeForToken(req.query.code, req.query.state);
    res.send('ViCare connectat correctament. Ja pots tancar aquesta pestanya.');
  } catch (err) {
    res.status(500).send('Error connectant amb ViCare: ' + err.message);
  }
});

// --- ViCare: estat + engegar/aturar ---
app.get('/api/vicare/status', async (req, res) => {
  try {
    res.json(await vicare.getFeatures());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/vicare/start', async (req, res) => {
  try {
    res.json(await vicare.start());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/vicare/stop', async (req, res) => {
  try {
    res.json(await vicare.stop());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/vicare/temperature', async (req, res) => {
  try {
    const { temperature } = req.body;
    if (typeof temperature !== 'number') {
      return res.status(400).json({ error: 'Cal enviar { "temperature": <number> }' });
    }
    res.json(await vicare.setProgramTemperature(temperature));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/vicare/room-temperature', async (req, res) => {
  try {
    res.json(await vicare.getRoomTemperature());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/vicare/setpoint-temperature', async (req, res) => {
  try {
    res.json(await vicare.getSetpointTemperature());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/vicare/mode', async (req, res) => {
  try {
    res.json(await vicare.getOperatingMode());
  } catch (err) {
    sendError(res, err);
  }
});

// --- Fancoil Tuya: estat + engegar/aturar ---
app.get('/api/tuya/status', async (req, res) => {
  try {
    res.json(await tuya.getStatus());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/tuya/start', async (req, res) => {
  try {
    res.json(await tuya.start());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/tuya/stop', async (req, res) => {
  try {
    res.json(await tuya.stop());
  } catch (err) {
    sendError(res, err);
  }
});

// --- Tots dos alhora ---
app.post('/api/start', async (req, res) => {
  try {
    res.json(await coordinator.startAll(req.body && req.body.delayMinutes));
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/stop', async (req, res) => {
  try {
    res.json(await coordinator.stopAll(req.body && req.body.delayMinutes));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/tuya-configured', (req, res) => {
  res.json({ configured: coordinator.tuyaConfigured() });
});

// Valors per omplir el panell (el valor per defecte del retard, configurable a .env)
app.get('/api/config', (req, res) => {
  res.json({ tuyaDelayMinutes: coordinator.defaultDelayMinutes() });
});

// QStash crida aquí quan ha passat el retard programat. Verifiquem la signatura
// perquè ningú altre pugui disparar això.
app.post('/api/tuya/delayed-action', async (req, res) => {
  try {
    const valid = await qstash.verifyIncoming(req);
    if (!valid) return res.status(401).json({ error: 'Signatura QStash invàlida' });

    const { action } = req.body || {};
    if (action !== 'start' && action !== 'stop') {
      return res.status(400).json({ error: 'action ha de ser "start" o "stop"' });
    }
    if (!coordinator.tuyaConfigured()) {
      return res.json({ skipped: 'Tuya ja no està configurat' });
    }
    const result = action === 'start' ? await tuya.start() : await tuya.stop();
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = app;
