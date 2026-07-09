'use strict';

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Extrovert REST API',
    version: '1.0.0',
    description: `Public REST API for [Extrovert](https://extrovert.redforged.eu), a social network where content is discovered through your network of friends and friends-of-friends.

## Authentication

This API uses OAuth 2.0 (Authorization Code flow with PKCE). To get started:

1. Register an application via \`POST /api/v1/oauth/apps\`
2. Direct users to \`GET /api/v1/oauth/authorize\` to grant access
3. Exchange the authorization code for an access token via \`POST /api/v1/oauth/token\`
4. Use the access token in the \`Authorization: Bearer <token>\` header

## Rate Limiting

- Per-token limit: **120 requests per minute**
- Rate limit headers are returned on every response:
  - \`X-RateLimit-Limit\`
  - \`X-RateLimit-Remaining\`
  - \`X-RateLimit-Reset\`

## Pagination

List endpoints use cursor-based pagination. The response includes a \`pagination\` object:
\`\`\`json
{
  "data": [...],
  "pagination": {
    "next": "base64url-encoded-cursor"
  }
}
\`\`\`
Pass the \`next\` cursor value as the \`?cursor=\` query parameter to get the next page.

## Idempotency

\`POST /api/v1/statuses\` supports the \`Idempotency-Key\` header. If the same key is sent within a short window, duplicate creation is prevented and the original response is returned.
`,
    contact: {
      name: 'Extrovert Admin',
      url: 'https://extrovert.redforged.eu',
    },
  },
  servers: [
    { url: 'https://extrovert.redforged.eu', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths: {
    '/api/v1/oauth/apps': {
      post: {
        summary: 'Register a new OAuth application',
        tags: ['OAuth'],
        security: [{ sessionAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'redirect_uris'],
                properties: {
                  name: { type: 'string', description: 'Application name' },
                  description: { type: 'string' },
                  website: { type: 'string', format: 'uri' },
                  redirect_uris: { type: 'string', description: 'Comma-separated redirect URIs' },
                  scopes: { type: 'string', description: 'Space-separated scopes (default: "read")' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'App registered successfully' },
          '400': { description: 'Missing required fields' },
          '401': { description: 'Not logged in' },
        },
      },
      get: {
        summary: 'List your registered OAuth applications',
        tags: ['OAuth'],
        security: [{ sessionAuth: [] }],
        responses: {
          '200': { description: 'List of registered apps' },
        },
      },
    },
    '/api/v1/oauth/authorize': {
      get: {
        summary: 'OAuth authorization endpoint (user-facing)',
        tags: ['OAuth'],
        parameters: [
          { name: 'client_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'response_type', in: 'query', required: true, schema: { type: 'string', enum: ['code'] } },
          { name: 'scope', in: 'query', schema: { type: 'string' } },
          { name: 'state', in: 'query', schema: { type: 'string' } },
          { name: 'code_challenge', in: 'query', schema: { type: 'string' }, description: 'PKCE S256 challenge' },
          { name: 'code_challenge_method', in: 'query', schema: { type: 'string', enum: ['S256', 'plain'] } },
        ],
        responses: {
          '302': { description: 'Redirect to login or authorize page' },
        },
      },
    },
    '/api/v1/oauth/token': {
      post: {
        summary: 'Exchange authorization code or refresh token',
        tags: ['OAuth'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  grant_type: { type: 'string', enum: ['authorization_code', 'refresh_token'] },
                  client_id: { type: 'string' },
                  client_secret: { type: 'string' },
                  code: { type: 'string', description: 'Authorization code (for authorization_code grant)' },
                  code_verifier: { type: 'string', description: 'PKCE code verifier' },
                  redirect_uri: { type: 'string' },
                  refresh_token: { type: 'string', description: 'Refresh token (for refresh_token grant)' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Token response' },
          '400': { description: 'Bad request' },
        },
      },
    },
    '/api/v1/oauth/revoke': {
      post: {
        summary: 'Revoke an access token',
        tags: ['OAuth'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: { type: 'string' },
                  client_id: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Token revoked (or not found)' } },
      },
    },
    '/api/v1/oauth/authorized_apps': {
      get: {
        summary: 'List apps you have authorized',
        tags: ['OAuth'],
        security: [{ sessionAuth: [] }],
        responses: { '200': { description: 'List of authorized apps' } },
      },
    },
    '/api/v1/oauth/authorized_apps/{appId}/revoke': {
      post: {
        summary: 'Revoke a specific app\'s access',
        tags: ['OAuth'],
        security: [{ sessionAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Access revoked' } },
      },
    },
    '/api/v1/accounts/verify_credentials': {
      get: {
        summary: 'Verify and return the authenticated user',
        tags: ['Accounts'],
        security: [{ oauth2: ['read', 'profile'] }],
        responses: { '200': { description: 'Account object' } },
      },
    },
    '/api/v1/accounts/update_credentials': {
      patch: {
        summary: 'Update the authenticated user\'s profile',
        tags: ['Accounts'],
        security: [{ oauth2: ['write', 'profile'] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  display_name: { type: 'string' },
                  bio: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Updated account' } },
      },
    },
    '/api/v1/accounts/{id}': {
      get: {
        summary: 'View an account',
        tags: ['Accounts'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Account object' },
          '404': { description: 'Account not found' },
        },
      },
    },
    '/api/v1/accounts/{id}/statuses': {
      get: {
        summary: "View an account's posts",
        tags: ['Accounts'],
        security: [{ oauth2: ['read'] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 40 } },
        ],
        responses: { '200': { description: 'List of posts' } },
      },
    },
    '/api/v1/accounts/{id}/followers': {
      get: {
        summary: "View an account's followers",
        tags: ['Accounts'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'List of accounts' } },
      },
    },
    '/api/v1/accounts/{id}/following': {
      get: {
        summary: "View who an account follows",
        tags: ['Accounts'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'List of accounts' } },
      },
    },
    '/api/v1/accounts/{id}/follow': {
      post: {
        summary: 'Follow an account',
        tags: ['Follows'],
        security: [{ oauth2: ['follow'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'The followed account' } },
      },
    },
    '/api/v1/accounts/{id}/unfollow': {
      post: {
        summary: 'Unfollow an account',
        tags: ['Follows'],
        security: [{ oauth2: ['follow'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'The unfollowed account' } },
      },
    },
    '/api/v1/statuses': {
      post: {
        summary: 'Create a new post',
        tags: ['Statuses'],
        security: [{ oauth2: ['write'] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['text', 'photo', 'video', 'repost'] },
                  body: { type: 'string', maxLength: 5000 },
                  media: { type: 'string', format: 'binary', description: 'Photo/video file for photo/video type' },
                  repost_of_id: { type: 'integer', description: 'Post ID to repost (for repost type)' },
                },
              },
            },
          },
        },
        parameters: [
          { name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: 'Prevents duplicate creation on retry' },
        ],
        responses: {
          '201': { description: 'Created post' },
          '400': { description: 'Bad request' },
          '409': { description: 'Already reposted' },
        },
      },
    },
    '/api/v1/statuses/{id}': {
      get: {
        summary: 'View a post',
        tags: ['Statuses'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Post object' } },
      },
      delete: {
        summary: 'Delete your own post',
        tags: ['Statuses'],
        security: [{ oauth2: ['write'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/statuses/{id}/favourite': {
      post: {
        summary: 'Like a post (toggle)',
        tags: ['Statuses'],
        security: [{ oauth2: ['write'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Updated post' } },
      },
    },
    '/api/v1/statuses/{id}/unfavourite': {
      post: {
        summary: 'Unlike a post',
        tags: ['Statuses'],
        security: [{ oauth2: ['write'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Updated post' } },
      },
    },
    '/api/v1/statuses/{id}/reblog': {
      post: {
        summary: 'Repost a post',
        tags: ['Statuses'],
        security: [{ oauth2: ['write'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Updated post' } },
      },
    },
    '/api/v1/statuses/{id}/context': {
      get: {
        summary: 'View post context (ancestors and descendants)',
        tags: ['Statuses'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Context object' } },
      },
    },
    '/api/v1/statuses/{id}/favourited_by': {
      get: {
        summary: 'View who liked a post',
        tags: ['Statuses'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'List of accounts' } },
      },
    },
    '/api/v1/statuses/{id}/reblogged_by': {
      get: {
        summary: 'View who reposted a post',
        tags: ['Statuses'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'List of accounts' } },
      },
    },
    '/api/v1/timelines/home': {
      get: {
        summary: 'View your home timeline',
        tags: ['Timelines'],
        security: [{ oauth2: ['read'] }],
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 40 } },
        ],
        responses: { '200': { description: 'List of posts (network-bound)' } },
      },
    },
    '/api/v1/timelines/public': {
      get: {
        summary: 'Public timeline (not available)',
        tags: ['Timelines'],
        responses: { '403': { description: 'Extrovert does not have a public timeline' } },
      },
    },
    '/api/v1/notifications': {
      get: {
        summary: 'View notifications',
        tags: ['Notifications'],
        security: [{ oauth2: ['notifications'] }],
        parameters: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 40 } },
        ],
        responses: { '200': { description: 'List of notifications' } },
      },
    },
    '/api/v1/notifications/clear': {
      post: {
        summary: 'Mark all notifications as read',
        tags: ['Notifications'],
        security: [{ oauth2: ['notifications'] }],
        responses: { '200': { description: 'Cleared' } },
      },
    },
    '/api/v1/media': {
      post: {
        summary: 'Upload a media file',
        tags: ['Media'],
        security: [{ oauth2: ['media.write'] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Media object' },
          '400': { description: 'No file uploaded' },
        },
      },
    },
    '/api/v1/media/{id}': {
      get: {
        summary: 'View media attachment details',
        tags: ['Media'],
        security: [{ oauth2: ['read'] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Media object' } },
      },
    },
    '/api/v1/search': {
      get: {
        summary: 'Search accounts and posts',
        tags: ['Search'],
        security: [{ oauth2: ['read'] }],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['accounts', 'statuses'] }, description: 'Limit results to a specific type. If omitted, returns both.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 40 } },
        ],
        responses: {
          '200': { description: 'Search results. Accounts are platform-wide; statuses are network-bound.' },
          '400': { description: 'Missing query parameter "q"' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: '/api/v1/oauth/authorize',
            tokenUrl: '/api/v1/oauth/token',
            refreshUrl: '/api/v1/oauth/token',
            scopes: {
              read: 'Read your data (timelines, posts, profiles)',
              write: 'Create and delete posts, like, repost',
              follow: 'Follow and unfollow accounts',
              'media.write': 'Upload media files',
              notifications: 'Read and manage notifications',
              'read:direct': 'Read direct messages',
              'write:direct': 'Send direct messages',
              profile: 'Read and update your profile',
            },
          },
        },
      },
      sessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Browser session cookie (for registering apps and managing authorized apps)',
      },
    },
  },
  externalDocs: {
    description: 'Getting Started Guide',
    url: '/developers/docs',
  },
};

module.exports = spec;
