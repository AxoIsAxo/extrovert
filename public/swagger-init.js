'use strict';
// Swagger UI bootstrap for the developer docs page.
// External file (same-origin, served under CSP script-src 'self').
(function () {
  window.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('swagger-ui');
    if (!el || !window.SwaggerUIBundle) return;
    window.SwaggerUIBundle({
      url: '/developers/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
      showExtensions: true,
      showCommonExtensions: true,
      defaultModelsExpandDepth: -1,
    });
  });
})();
