# ViCare + Fancoil (FT4W) — Engegar/Aturar

App mínima que engega i atura la bomba de calor Viessmann (**ViCare**) i, quan el tinguis
connectat, el cronotermostat de fancoil (**Tuya**, tipus FERCO FT4W) — des d'un únic panell.

## Estructura
```
server/
  app.js              → app Express + rutes API (sense .listen)
  index.js            → arrencada local (npm start / npm run dev)
  vicareClient.js      → OAuth2 (PKCE) i start()/stop() sobre l'API ViCare
  tokenStore.js        → persistència dels tokens (Upstash Redis a Vercel, fitxer en local)
  tuyaClient.js         → signatura de peticions i start()/stop() sobre la Tuya Cloud API
  coordinator.js        → engegar/aturar tots dos sistemes alhora
api/
  index.js            → entrypoint per Vercel (importa server/app.js com a funció serverless)
public/
  index.html          → panell amb botons Engegar / Aturar
vercel.json           → rutes: estàtic directe, /api i /auth cap a la funció
```

## Configuració pas a pas

### 1. Viessmann ViCare
1. Registra't a https://developer.viessmann.com i crea una aplicació.
2. Com a **Redirect URI** posa `http://localhost:3000/auth/vicare/callback`.
3. Copia el `client_id` a `.env`.
4. Un cop connectat (botó "Connectar ViCare"), consulta `/api/vicare/status` i
   busca la feature `heating.circuits.X.operating.modes.active`. El camp
   `commands.setMode.params.mode.constraints.enum` et dirà els valors vàlids
   de mode (ex: `standby`, `dhwAndHeating`...). Ajusta `VICARE_MODE_ON` /
   `VICARE_MODE_OFF` a `.env` amb els valors correctes per al teu model.

### 2. Tuya Cloud (per al FT4W un cop el tinguis)
1. Vincula primer el dispositiu amb l'app **Smart Life** o **Tuya Smart** del mòbil.
2. Crea un compte a https://iot.tuya.com i un projecte "Cloud Development" (Trial gratuïta).
3. A "Devices" vincula el compte de Smart Life amb el projecte → apareixerà el `device_id`.
4. A "Debug Device" comprova el `code` exacte per engegar/aturar (normalment `switch`)
   i posa'l a `TUYA_POWER_CODE` si és diferent.
5. Copia `Access ID`, `Access Secret` i `device_id` a `.env`.

Mentre no omplis `TUYA_ACCESS_ID` / `TUYA_DEVICE_ID`, els botons del Tuya fallaran
i el botó "Engegar/Aturar tot" simplement ignora el Tuya (no trenca res).

### 3. Instal·lació i arrencada
```bash
cp .env.example .env      # i omple els valors
npm install
npm start
```
Obre http://localhost:3000, prem "Connectar ViCare" (només el primer cop) i ja
pots engegar/aturar amb els botons.

## Desplegament a Vercel

L'app està preparada per córrer com a funcions serverless a Vercel (sense disc
persistent). Cal:

1. Pujar el repo a GitHub i importar-lo a vercel.com com a nou projecte.
2. Des de la pestanya **Storage/Marketplace** del projecte a Vercel, afegir la
   integració **Upstash Redis** — injecta automàticament `UPSTASH_REDIS_REST_URL`
   i `UPSTASH_REDIS_REST_TOKEN`, on es guarden els tokens de ViCare.
3. Afegir la resta de variables d'entorn (`VICARE_CLIENT_ID`, `VICARE_INSTALLATION_ID`,
   `VICARE_GATEWAY_SERIAL`, `VICARE_DEVICE_ID`, `VICARE_CIRCUIT`, `VICARE_MODE_ON`,
   `VICARE_MODE_OFF`...) a Settings → Environment Variables.
4. Posar `VICARE_REDIRECT_URI=https://<el-teu-domini>.vercel.app/auth/vicare/callback`
   i afegir aquesta mateixa URL com a Redirect URI al client OAuth de developer.viessmann.com.
5. Un cop desplegat, obrir `/auth/vicare` per fer el login una vegada; els tokens
   queden guardats a Redis automàticament a partir d'aquí (no cal repetir-ho a cada deploy).

En local (`npm run dev`), si no tens `UPSTASH_REDIS_REST_URL`/`TOKEN` a `.env`, els
tokens es guarden igualment a `.tokens.vicare.json` com sempre.

## Notes importants
- S'ha simplificat expressament: sense setpoints de temperatura ni velocitats de
  ventilador, sense sincronització automàtica — només ON/OFF per a cada sistema
  i un botó combinat.
- Els valors exactes (`VICARE_MODE_ON/OFF`, `TUYA_POWER_CODE`) **cal confirmar-los**
  contra el teu equip real, tal com s'indica a dalt.
