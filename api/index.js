// Entrypoint per Vercel: exporta l'app Express directament, sense fer .listen().
// Vercel la fa servir com a funció serverless.
require('dotenv').config();
module.exports = require('../server/app');
