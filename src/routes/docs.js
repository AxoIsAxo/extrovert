'use strict';

const express = require('express');
const spec = require('../api-spec');

const router = express.Router();

// Serve the OpenAPI 3.1 spec as JSON
router.get('/openapi.json', (req, res) => {
  res.json(spec);
});

// Serve Swagger UI (assets are vendored locally — no CDN — so the global
// helmet CSP with script-src 'self' applies unchanged).
router.get('/docs', (req, res) => {
  res.render('swagger-ui');
});

module.exports = router;
