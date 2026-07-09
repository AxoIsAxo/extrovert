'use strict';

const express = require('express');
const spec = require('../api-spec');

const router = express.Router();

// Serve the OpenAPI 3.1 spec as JSON
router.get('/openapi.json', (req, res) => {
  res.json(spec);
});

// Serve Swagger UI
router.get('/docs', (req, res) => {
  // Helmet's CSP blocks CDN. Remove it, then set our own.
  res.removeHeader('Content-Security-Policy');
  res.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https://cdn.jsdelivr.net; " +
    "font-src 'self' https://cdn.jsdelivr.net; " +
    "connect-src 'self'"
  );
  res.render('swagger-ui');
});

module.exports = router;
