const express = require('express');
const path = require('path');
const crypto = require('crypto');
const vicare = require('./vicareClient');
const tuya = require('./tuyaClient');
const coordinator = require('./coordinator');

const app = express();
app.use(express.json());

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

function checkAuth(req, res, next) {
  const { APP_USER, APP_PASSWORD } = process.env;
  if (!APP_USER || !APP_PASSWORD) return next();

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, APP_USER) && safeEqual(pass, APP_PASSWORD)) return next();
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
    res.json(await coordinator.startAll());
  } catch (err) {
    sendError(res, err);
  }
});

app.post('/api/stop', async (req, res) => {
  try {
    res.json(await coordinator.stopAll());
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/tuya-configured', (req, res) => {
  res.json({ configured: coordinator.tuyaConfigured() });
});

module.exports = app;
