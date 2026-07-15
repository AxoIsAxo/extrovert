'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { getUserById, areMutualFollowers, getRoomChannel } = require('./db');

const SESSION_DB_PATH = process.env.EXTV_SESSION_DB_PATH || path.join(__dirname, '..', 'data', 'sessions.db');
const SESSION_SECRET = process.env.SESSION_SECRET;

const clients = new Map();
const voiceChannels = new Map();

let sessionDb;
try {
  sessionDb = new DatabaseSync(SESSION_DB_PATH);
} catch (e) {
  console.error('Signaling: failed to open session DB', e);
}

function parseCookies(cookieHeader) {
  const result = {};
  if (!cookieHeader) return result;
  cookieHeader.split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i === -1) return;
    const key = pair.slice(0, i).trim();
    const val = pair.slice(i + 1).trim();
    if (key) result[key] = val;
  });
  return result;
}

function unsignSessionId(signedValue, secret) {
  if (typeof signedValue !== 'string') return null;
  const match = signedValue.match(/^s:(.+)\.(.+)$/);
  if (!match) return null;
  const sid = match[1];
  const sig = match[2];
  const expected = crypto.createHmac('sha256', secret).update('s:' + sid).digest('base64').replace(/=+$/, '');
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return sid;
    }
  } catch {}
  return null;
}

function getSession(sid) {
  if (!sessionDb) return null;
  try {
    const row = sessionDb.prepare(`SELECT data, expires_at FROM sessions WHERE sid = ?`).get(sid);
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      sessionDb.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
      return null;
    }
    return JSON.parse(row.data);
  } catch { return null; }
}

function lookupUserFromRequest(req) {
  if (!SESSION_SECRET || !sessionDb) return null;
  const cookies = parseCookies(req.headers.cookie);
  const signedSid = cookies['connect.sid'];
  if (!signedSid) return null;
  const sid = unsignSessionId(signedSid, SESSION_SECRET);
  if (!sid) return null;
  const session = getSession(sid);
  if (!session || !session.userId) return null;
  return getUserById(session.userId);
}

function isMutualFollowerOnline(aId, bId) {
  return areMutualFollowers(aId, bId);
}

function broadcastPresence(userId, type) {
  const user = getUserById(userId);
  if (!user) return;
  for (const [otherId, client] of clients) {
    if (otherId === userId) continue;
    if (areMutualFollowers(userId, otherId)) {
      try {
        client.ws.send(JSON.stringify({
          type,
          username: user.username,
          display_name: user.display_name,
        }));
      } catch {}
    }
  }
}

function sendToUser(toUsername, message) {
  for (const [id, client] of clients) {
    if (client.username === toUsername) {
      try {
        client.ws.send(JSON.stringify(message));
        return true;
      } catch { return false; }
    }
  }
  return false;
}

function getVoiceChannelMembers(channelId) {
  const members = voiceChannels.get(channelId);
  if (!members) return [];
  const result = [];
  for (const userId of members) {
    const client = clients.get(userId);
    if (client) result.push({ id: userId, username: client.username, display_name: client.displayName });
  }
  return result;
}

function removeFromVoiceChannels(userId) {
  for (const [channelId, members] of voiceChannels) {
    if (members.has(userId)) {
      members.delete(userId);
      const client = clients.get(userId);
      const username = client ? client.username : 'unknown';
      for (const otherId of members) {
        const other = clients.get(otherId);
        if (other) {
          try {
            other.ws.send(JSON.stringify({
              type: 'user_left_channel',
              channel_id: channelId,
              username,
            }));
          } catch {}
        }
      }
      if (members.size === 0) voiceChannels.delete(channelId);
    }
  }
  const client = clients.get(userId);
  if (client) client.inCall = false;
}

function initSignaling(wss) {
  wss.on('connection', (ws, req) => {
    const user = lookupUserFromRequest(req);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const existing = clients.get(user.id);
    if (existing) {
      try { existing.ws.close(4002, 'New connection'); } catch {}
    }

    const clientData = {
      ws,
      username: user.username,
      displayName: user.display_name,
      userId: user.id,
      inCall: false,
    };
    clients.set(user.id, clientData);

    broadcastPresence(user.id, 'user_online');

    for (const [otherId, client] of clients) {
      if (otherId === user.id) continue;
      if (areMutualFollowers(user.id, otherId)) {
        try {
          ws.send(JSON.stringify({
            type: 'user_online',
            username: client.username,
            display_name: client.displayName,
          }));
        } catch {}
      }
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'ping':
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
          break;

        case 'call_offer':
          if (msg.channel_id) {
            const members = voiceChannels.get(msg.channel_id);
            if (members) {
              for (const otherId of members) {
                if (otherId === user.id) continue;
                if (msg.to) {
                  const target = clients.get(otherId);
                  if (target && target.username === msg.to) {
                    const forward = { ...msg, from: user.username, from_display: user.display_name };
                    delete forward.to;
                    try { target.ws.send(JSON.stringify(forward)); } catch {}
                  }
                }
              }
            }
          } else {
            const target = findUserByUsername(msg.to);
            if (!target) break;
            if (target.inCall) {
              try {
                ws.send(JSON.stringify({ type: 'user_busy', from: msg.to }));
              } catch {}
              break;
            }
            const forward = { ...msg, from: user.username, from_display: user.display_name };
            delete forward.to;
            try { target.ws.send(JSON.stringify(forward)); } catch {}
            clientData.inCall = true;
          }
          break;

        case 'call_answer':
        case 'ice_candidate':
        case 'call_end':
        case 'call_decline':
          if (msg.channel_id) {
            const members = voiceChannels.get(msg.channel_id);
            if (members) {
              for (const otherId of members) {
                if (otherId === user.id) continue;
                if (msg.to) {
                  const target = clients.get(otherId);
                  if (target && target.username === msg.to) {
                    const forward = { ...msg, from: user.username, from_display: user.display_name };
                    delete forward.to;
                    try { target.ws.send(JSON.stringify(forward)); } catch {}
                  }
                }
              }
            }
          } else {
            const target = findUserByUsername(msg.to);
            if (!target) break;
            const forward = { ...msg, from: user.username, from_display: user.display_name };
            delete forward.to;
            try { target.ws.send(JSON.stringify(forward)); } catch {}
            if (msg.type === 'call_answered' || msg.type === 'call_end' || msg.type === 'call_decline') {
              clientData.inCall = msg.type === 'call_answered';
            }
          }
          break;

        case 'join_channel': {
          const channelId = msg.channel_id;
          if (!channelId) return;

          let members = voiceChannels.get(channelId);
          if (!members) {
            members = new Set();
            voiceChannels.set(channelId, members);
          }

          if (members.has(user.id)) return;
          members.add(user.id);

          clientData.inCall = true;

          ws.send(JSON.stringify({
            type: 'channel_joined',
            channel_id: channelId,
            members: getVoiceChannelMembers(channelId).filter(m => m.id !== user.id),
          }));

          for (const otherId of members) {
            if (otherId === user.id) continue;
            const other = clients.get(otherId);
            if (other) {
              try {
                other.ws.send(JSON.stringify({
                  type: 'user_joined_channel',
                  channel_id: channelId,
                  username: user.username,
                  display_name: user.display_name,
                }));
              } catch {}
            }
          }
          break;
        }

        case 'leave_channel': {
          const channelId = msg.channel_id;
          if (!channelId) return;
          const members = voiceChannels.get(channelId);
          if (!members) return;
          members.delete(user.id);
          if (members.size === 0) {
            voiceChannels.delete(channelId);
          }
          if (members.size === 0) {
            clientData.inCall = false;
          }
          for (const otherId of members) {
            const other = clients.get(otherId);
            if (other) {
              try {
                other.ws.send(JSON.stringify({
                  type: 'user_left_channel',
                  channel_id: channelId,
                  username: user.username,
                }));
              } catch {}
            }
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      removeFromVoiceChannels(user.id);
      const c = clients.get(user.id);
      if (c && c.ws === ws) {
        clients.delete(user.id);
        if (c.inCall) {
          for (const [otherId, other] of clients) {
            if (other.inCall) {
              try {
                other.ws.send(JSON.stringify({
                  type: 'call_ended', from: user.username,
                }));
              } catch {}
            }
          }
        }
        broadcastPresence(user.id, 'user_offline');
      }
    });

    ws.on('error', () => {});
  });
}

function findUserByUsername(username) {
  for (const [id, client] of clients) {
    if (client.username === username) return client;
  }
  return null;
}

function getOnlineUsers(userId) {
  const result = [];
  for (const [id, client] of clients) {
    if (id === userId) continue;
    if (areMutualFollowers(userId, id)) {
      result.push({
        id,
        username: client.username,
        display_name: client.displayName,
        in_call: !!client.inCall,
      });
    }
  }
  return result;
}

function getUserPresence(username) {
  for (const [id, client] of clients) {
    if (client.username === username) {
      return { online: true, in_call: !!client.inCall };
    }
  }
  return { online: false, in_call: false };
}

module.exports = { initSignaling, getOnlineUsers, getUserPresence, getVoiceChannelMembers };
