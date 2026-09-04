// Client per a la Tuya Cloud IoT Platform (dispositius com el FT4W solen anar per aquí)
// Docs: https://developer.tuya.com/en/docs/cloud/
const axios = require('axios');
const crypto = require('crypto');

let cachedToken = null; // { token, expiresAt }

function hmac(str, key) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest('hex').toUpperCase();
}

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Construeix la signatura que exigeix Tuya per a cada petició
function sign({ accessId, accessSecret, token, method, path, body }) {
  const t = Date.now().toString();
  const contentHash = sha256(body ? JSON.stringify(body) : '');
  const stringToSign = [method, contentHash, '', path].join('\n');
  const signStr = accessId + (token || '') + t + stringToSign;
  const signature = hmac(signStr, accessSecret);
  return { t, signature };
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const { TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_ENDPOINT } = process.env;
  const path = '/v1.0/token?grant_type=1';
  const { t, signature } = sign({ accessId: TUYA_ACCESS_ID, accessSecret: TUYA_ACCESS_SECRET, method: 'GET', path });

  const { data } = await axios.get(`${TUYA_ENDPOINT}${path}`, {
    headers: {
      client_id: TUYA_ACCESS_ID,
      sign: signature,
      t,
      sign_method: 'HMAC-SHA256',
    },
  });

  cachedToken = {
    token: data.result.access_token,
    expiresAt: Date.now() + (data.result.expire_time - 60) * 1000,
  };
  return cachedToken.token;
}

async function tuyaRequest(method, path, body) {
  const { TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_ENDPOINT } = process.env;
  const token = await getToken();
  const { t, signature } = sign({ accessId: TUYA_ACCESS_ID, accessSecret: TUYA_ACCESS_SECRET, token, method, path, body });

  const { data } = await axios({
    method,
    url: `${TUYA_ENDPOINT}${path}`,
    data: body,
    headers: {
      client_id: TUYA_ACCESS_ID,
      access_token: token,
      sign: signature,
      t,
      sign_method: 'HMAC-SHA256',
    },
  });
  return data;
}

// --- Helpers de negoci ---

// Retorna l'estat actual del fancoil (setpoint, mode, velocitat, temp ambient si el sensor la reporta)
async function getStatus() {
  const deviceId = process.env.TUYA_DEVICE_ID;
  const data = await tuyaRequest('GET', `/v1.0/iot-03/devices/${deviceId}/status`);
  return data.result; // array de { code, value }, ex: temp_set, mode, fan_speed_enum, temp_current
}

// Envia una o més comandes al fancoil. Els "code" exactes depenen del model
// (es poden consultar a la pestanya "Debug device" del projecte a iot.tuya.com)
async function sendCommands(commands) {
  const deviceId = process.env.TUYA_DEVICE_ID;
  return tuyaRequest('POST', `/v1.0/iot-03/devices/${deviceId}/commands`, { commands });
}

// El "code" exacte per engegar/aturar sol ser 'switch' o 'switch_1' — confirma'l
// amb el "Debug device" del projecte a iot.tuya.com un cop tinguis el FT4W.
async function setPower(on) {
  return sendCommands([{ code: process.env.TUYA_POWER_CODE || 'switch', value: on }]);
}

async function start() {
  return setPower(true);
}

async function stop() {
  return setPower(false);
}

module.exports = { getStatus, sendCommands, setPower, start, stop };
