// Coordinació mínima: engegar o aturar tots dos sistemes alhora.
// Si el Tuya encara no està configurat (falta TUYA_DEVICE_ID a .env), s'ignora
// sense trencar la petició, perquè puguis fer servir només el ViCare de moment.
const vicare = require('./vicareClient');
const tuya = require('./tuyaClient');

function tuyaConfigured() {
  return Boolean(process.env.TUYA_DEVICE_ID && process.env.TUYA_ACCESS_ID);
}

async function startAll() {
  const result = { vicare: null, tuya: null };
  result.vicare = await vicare.start();

  if (tuyaConfigured()) {
    try {
      result.tuya = await tuya.start();
    } catch (err) {
      result.tuya = { error: err.message };
    }
  } else {
    result.tuya = { skipped: 'Tuya encara no configurat' };
  }

  return result;
}

async function stopAll() {
  const result = { vicare: null, tuya: null };
  result.vicare = await vicare.stop();

  if (tuyaConfigured()) {
    try {
      result.tuya = await tuya.stop();
    } catch (err) {
      result.tuya = { error: err.message };
    }
  } else {
    result.tuya = { skipped: 'Tuya encara no configurat' };
  }

  return result;
}

module.exports = { startAll, stopAll, tuyaConfigured };
