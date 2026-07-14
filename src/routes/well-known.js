'use strict';

const express = require('express');
const { getJwks, ISSUER } = require('../oidc');

const router = express.Router();

router.get('/openid-configuration', (req, res) => {
  const base = ISSUER;
  res.json({
    issuer: ISSUER,
    authorization_endpoint: `${base}/api/v1/oauth/authorize`,
    token_endpoint: `${base}/api/v1/oauth/token`,
    userinfo_endpoint: `${base}/api/v1/oauth/userinfo`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    revocation_endpoint: `${base}/api/v1/oauth/revoke`,
    registration_endpoint: `${base}/api/v1/oauth/apps`,
    scopes_supported: [
      'openid', 'read', 'write', 'follow',
      'media.write', 'notifications',
      'read:direct', 'write:direct', 'profile',
    ],
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    claim_types_supported: ['normal'],
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat', 'auth_time',
      'nonce', 'preferred_username', 'name', 'picture',
    ],
    code_challenge_methods_supported: ['S256', 'plain'],
  });
});

router.get('/jwks.json', (req, res) => {
  res.json(getJwks());
});

module.exports = router;
