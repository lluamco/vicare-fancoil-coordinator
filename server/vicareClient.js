// Client per a l'API ViCare de Viessmann
// Docs: https://documentation.viessmann.com/
const axios = require('axios');
const crypto = require('crypto');
const tokenStore = require('./tokenStore');

const IAM_BASE = 'https://iam.viessmann-climatesolutions.com/idp/v3';
const API_BASE = 'https://api.viessmann-climatesolutions.com/iot/v2';

// --- Pas 1: generar la URL de login que l'usuari ha d'obrir al navegador ---
// El "state" identifica aquest intent de login concret: el fem servir per lligar
// el code_verifier PKCE amb el callback, ja que a Vercel no podem confiar en una
// variable en memòria del procés (cada petició pot anar a una instància diferent).
async function buildAuthUrl() {
  const pkceVerifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(pkceVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  await tokenStore.savePkceVerifier(state, pkceVerifier);

  const params = new URLSearchParams({
    client_id: process.env.VICARE_CLIENT_ID,
    redirect_uri: process.env.VICARE_REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'IoT User offline_access',
    state,
  });
  return `${IAM_BASE}/authorize?${params.toString()}`;
}

// --- Pas 2: bescanviar el "code" del callback per tokens ---
async function exchangeCodeForToken(code, state) {
  const pkceVerifier = await tokenStore.takePkceVerifier(state);
  if (!pkceVerifier) {
    throw new Error('Sessió de login caducada o invàlida (10 min). Torna a obrir /auth/vicare.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.VICARE_CLIENT_ID,
    redirect_uri: process.env.VICARE_REDIRECT_URI,
    code_verifier: pkceVerifier,
    code,
  });
  const { data } = await axios.post(`${IAM_BASE}/token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  await tokenStore.saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token });
  return data;
}

async function refreshAccessToken() {
  const tokens = await tokenStore.loadTokens();
  if (!tokens.refresh_token) throw new Error('No hi ha refresh_token. Cal fer login primer a /auth/vicare');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.VICARE_CLIENT_ID,
    refresh_token: tokens.refresh_token,
  });
  const { data } = await axios.post(`${IAM_BASE}/token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const newTokens = { access_token: data.access_token, refresh_token: data.refresh_token || tokens.refresh_token };
  await tokenStore.saveTokens(newTokens);
  return newTokens.access_token;
}

async function authedRequest(method, url, payload) {
  let tokens = await tokenStore.loadTokens();
  if (!tokens.access_token) tokens.access_token = await refreshAccessToken();

  const doCall = (token) =>
    axios({ method, url, data: payload, headers: { Authorization: `Bearer ${token}` } });

  try {
    return (await doCall(tokens.access_token)).data;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      const newToken = await refreshAccessToken();
      return (await doCall(newToken)).data;
    }
    throw err;
  }
}

// --- Helpers de negoci ---

async function getInstallations() {
  return authedRequest('get', `${API_BASE}/equipment/installations?includeGateways=true`);
}

// Retorna totes les "features" del dispositiu (temperatures, modes, programes...)
async function getFeatures() {
  const { VICARE_INSTALLATION_ID, VICARE_GATEWAY_SERIAL, VICARE_DEVICE_ID } = process.env;
  const url = `${API_BASE}/features/installations/${VICARE_INSTALLATION_ID}/gateways/${VICARE_GATEWAY_SERIAL}/devices/${VICARE_DEVICE_ID}/features`;
  return authedRequest('get', url);
}

// Canvia el mode operatiu del circuit (és el mecanisme "engegar/aturar" de ViCare).
// Els valors de mode ON/OFF depenen del model exacte de la bomba de calor —
// confirma'ls a /api/vicare/status (busca "heating.circuits.X.operating.modes.active"
// i el camp "commands.setMode.params.mode.constraints.enum" per veure els valors vàlids).
async function setOperatingMode(mode, circuit = process.env.VICARE_CIRCUIT || 0) {
  const { VICARE_INSTALLATION_ID, VICARE_GATEWAY_SERIAL, VICARE_DEVICE_ID } = process.env;
  const feature = `heating.circuits.${circuit}.operating.modes.active`;
  const url = `${API_BASE}/features/installations/${VICARE_INSTALLATION_ID}/gateways/${VICARE_GATEWAY_SERIAL}/devices/${VICARE_DEVICE_ID}/features/${feature}/commands/setMode`;
  return authedRequest('post', url, { mode });
}

async function start() {
  return setOperatingMode(process.env.VICARE_MODE_ON || 'dhwAndHeating');
}

async function stop() {
  return setOperatingMode(process.env.VICARE_MODE_OFF || 'standby');
}

// Canvia la temperatura objectiu d'un programa (normal/comfort/reducedHeating...).
// Confirma el nom del programa actiu a /api/vicare/status:
// busca "heating.circuits.X.operating.programs.active" -> el seu "value" et diu
// quin programa és l'actiu ara mateix (normal, comfort...).
async function setProgramTemperature(
  temperature,
  program = process.env.VICARE_PROGRAM || 'normal',
  circuit = process.env.VICARE_CIRCUIT || 0
) {
  const { VICARE_INSTALLATION_ID, VICARE_GATEWAY_SERIAL, VICARE_DEVICE_ID } = process.env;
  const feature = `heating.circuits.${circuit}.operating.programs.${program}`;
  const url = `${API_BASE}/features/installations/${VICARE_INSTALLATION_ID}/gateways/${VICARE_GATEWAY_SERIAL}/devices/${VICARE_DEVICE_ID}/features/${feature}/commands/setTemperature`;
  return authedRequest('post', url, { targetTemperature: temperature });
}

// Llegeix la temperatura de sala (requereix sonda/termòstat ambient al circuit).
// Confirma el nom exacte a /api/vicare/status: busca una feature del tipus
// "heating.circuits.X.sensors.temperature.room" i mira el seu "properties.value.value".
async function getRoomTemperature(circuit = process.env.VICARE_CIRCUIT || 0) {
  const featureName =
    process.env.VICARE_ROOM_TEMP_FEATURE || `heating.circuits.${circuit}.sensors.temperature.room`;
  const { VICARE_INSTALLATION_ID, VICARE_GATEWAY_SERIAL, VICARE_DEVICE_ID } = process.env;
  const url = `${API_BASE}/features/installations/${VICARE_INSTALLATION_ID}/gateways/${VICARE_GATEWAY_SERIAL}/devices/${VICARE_DEVICE_ID}/features/${featureName}`;
  const data = await authedRequest('get', url);
  return {
    feature: featureName,
    value: data && data.data && data.data.properties && data.data.properties.value
      ? data.data.properties.value.value
      : null,
    raw: data,
  };
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForToken,
  getInstallations,
  getFeatures,
  setOperatingMode,
  setProgramTemperature,
  getRoomTemperature,
  start,
  stop,
};
