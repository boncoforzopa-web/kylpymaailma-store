// Single Vercel function: renders every storefront URL with the original theme.
const router = require('../lib/router');

module.exports = async (req, res) => {
  try {
    await router.handle(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end('Es ist ein Fehler aufgetreten. Bitte lade die Seite neu.');
  }
};
