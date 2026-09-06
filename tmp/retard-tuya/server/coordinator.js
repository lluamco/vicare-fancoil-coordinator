// Coordinació: engega/atura el ViCare a l'instant, i programa el fancoil Tuya
// perquè es faci uns minuts després (via QStash), ja que a Vercel no podem
// esperar dins la mateixa petició. Si Tuya encara no està configurat, s'ignora
// sense trencar la petició.
const vicare = require('./vicareClient');
const qstash = require('./qstashClient');

function tuyaConfigured() {
  return Boolean(process.env.TUYA_DEVICE_ID && process.env.TUYA_ACCESS_ID);
}

function defaultDelayMinutes() {
  const val = Number(process.env.TUYA_DELAY_MINUTES);
  return Number.isFinite(val) && val >= 0 ? val : 10;
}

async function scheduleTuya(action, delayMinutes) {
  if (!tuyaConfigured()) {
    return { skipped: 'Tuya encara no configurat' };
  }
  if (!qstash.isConfigured()) {
    return { skipped: 'QStash encara no configurat (falta QSTASH_TOKEN o PUBLIC_BASE_URL)' };
  }
  const minutes = Number.isFinite(Number(delayMinutes)) ? Number(delayMinutes) : defaultDelayMinutes();
  try {
    const res = await qstash.scheduleDelayed('/api/tuya/delayed-action', { action }, minutes);
    return { scheduled: true, delayMinutes: minutes, messageId: res.messageId };
  } catch (err) {
    return { error: err.message };
  }
}

async function startAll(delayMinutes) {
  const result = { vicare: null, tuya: null };
  result.vicare = await vicare.start();
  result.tuya = await scheduleTuya('start', delayMinutes);
  return result;
}

async function stopAll(delayMinutes) {
  const result = { vicare: null, tuya: null };
  result.vicare = await vicare.stop();
  result.tuya = await scheduleTuya('stop', delayMinutes);
  return result;
}

module.exports = { startAll, stopAll, tuyaConfigured, defaultDelayMinutes };
