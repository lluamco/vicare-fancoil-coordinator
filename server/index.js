// Arrencada local (npm start / npm run dev). A Vercel no s'utilitza aquest
// fitxer: api/index.js importa directament server/app.js.
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escoltant a http://localhost:${PORT}`));
