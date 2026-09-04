const express = require('express');
const path = require('path');
const vicare = require('./vicareClient');
const tuya = require('./tuyaClient');
const coordinator = require('./coordinator');

const app = express();
app.use(express.json());
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
