'use strict';

const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { getUserById, areMutualFollowers, getRoomChannel, isRoomMember } = require('./db');

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
  const expected = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
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
  if (!SESSION_SECRET) { console.log('lookupUser: no SESSION_SECRET'); return null; }
  if (!sessionDb) { console.log('lookupUser: no sessionDb'); return null; }
  const cookies = parseCookies(req.headers.cookie);
  const rawSid = cookies['connect.sid'];
  if (!rawSid) { console.log('lookupUser: no connect.sid cookie'); return null; }
  const signedSid = decodeURIComponent(rawSid);
  const sid = unsignSessionId(signedSid, SESSION_SECRET);
  if (!sid) { console.log('lookupUser: unsign failed for', signedSid.substring(0, 20)); return null; }
  const session = getSession(sid);
  if (!session) { console.log('lookupUser: no session for sid', sid.substring(0, 10)); return null; }
  if (!session.userId) { console.log('lookupUser: session has no userId', JSON.stringify(session).substring(0, 100)); return null; }
  const user = getUserById(session.userId);
  if (!user) { console.log('lookupUser: no user for userId', session.userId); return null; }
  return user;
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
      broadcastToRoomMembers(channelId, userId, {
        type: 'user_left_channel',
        channel_id: channelId,
        username,
      });
      if (members.size === 0) voiceChannels.delete(channelId);
    }
  }
  const client = clients.get(userId);
  if (client) client.inCall = false;
}

function broadcastToRoomMembers(channelId, excludeUserId, msg) {
  const ch = getRoomChannel(channelId);
  if (!ch) return;
  for (const [otherId, other] of clients) {
    if (otherId === excludeUserId) continue;
    if (isRoomMember(ch.room_id, otherId)) {
      try { other.ws.send(JSON.stringify(msg)); } catch {}
    }
  }
}

function routeToChannelMember(msg, user, forwardType) {
  const members = voiceChannels.get(msg.channel_id);
  if (!members) return;
  for (const otherId of members) {
    if (otherId === user.id) continue;
    if (msg.to) {
      const target = clients.get(otherId);
      if (target && target.username === msg.to) {
        try {
          target.ws.send(JSON.stringify({
            type: forwardType,
            from: user.username,
            from_display: user.display_name,
            sdp: msg.sdp,
            candidate: msg.candidate,
            channel_id: msg.channel_id,
          }));
        } catch {}
      }
    }
  }
}

function initSignaling(wss) {
  wss.on('connection', (ws, req) => {
    const user = lookupUserFromRequest(req);
    if (!user) {
      console.log('WS auth failed: no user from request', req.headers.cookie ? 'cookie present' : 'no cookie');
      ws.close(4001, 'Unauthorized');
      return;
    }
    console.log('WS connected:', user.username, '(id:', user.id + ')');

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
          console.log('WS msg call_offer from', user.username, 'to', msg.to, 'channel:', msg.channel_id);
          if (msg.channel_id) {
            const members = voiceChannels.get(msg.channel_id);
            if (members) {
              for (const otherId of members) {
                if (otherId === user.id) continue;
                if (msg.to) {
                  const target = clients.get(otherId);
                  if (target && target.username === msg.to) {
                    console.log('  -> forwarding incoming_call to', target.username);
                    try {
                      target.ws.send(JSON.stringify({
                        type: 'incoming_call',
                        from: user.username,
                        from_display: user.display_name,
                        sdp: msg.sdp,
                        channel_id: msg.channel_id,
                      }));
                    } catch {}
                  }
                }
              }
            }
          } else {
            const target = findUserByUsername(msg.to);
            if (!target) {
              console.log('  -> target not found (offline?)');
              break;
            }
            if (target.inCall) {
              console.log('  -> target busy');
              try {
                ws.send(JSON.stringify({ type: 'user_busy', from: msg.to }));
              } catch {}
              break;
            }
            console.log('  -> forwarding incoming_call to', target.username);
            try {
              target.ws.send(JSON.stringify({
                type: 'incoming_call',
                from: user.username,
                from_display: user.display_name,
                sdp: msg.sdp,
              }));
            } catch {}
            clientData.inCall = true;
          }
          break;

        case 'call_answer':
          console.log('WS msg call_answer from', user.username, 'to', msg.to);
          if (msg.channel_id) {
            routeToChannelMember(msg, user, 'call_answered');
          } else {
            const target = findUserByUsername(msg.to);
            if (target) {
              console.log('  -> forwarding call_answered to', target.username);
              try {
                target.ws.send(JSON.stringify({
                  type: 'call_answered',
                  from: user.username,
                  from_display: user.display_name,
                  sdp: msg.sdp,
                }));
              } catch {}
              clientData.inCall = true;
            } else {
              console.log('  -> target not found');
            }
          }
          break;

        case 'ice_candidate':
          console.log('WS msg ice_candidate from', user.username, 'to', msg.to);
          if (msg.channel_id) {
            routeToChannelMember(msg, user, 'ice_candidate');
          } else {
            const target = findUserByUsername(msg.to);
            if (target) {
              try {
                target.ws.send(JSON.stringify({
                  type: 'ice_candidate',
                  from: user.username,
                  candidate: msg.candidate,
                }));
              } catch {}
            }
          }
          break;

        case 'call_end':
          console.log('WS msg call_end from', user.username);
          if (msg.channel_id) {
            routeToChannelMember(msg, user, 'call_ended');
          } else {
            const target = findUserByUsername(msg.to);
            if (target) {
              console.log('  -> forwarding call_ended to', target.username);
              try {
                target.ws.send(JSON.stringify({
                  type: 'call_ended',
                  from: user.username,
                }));
              } catch {}
              clientData.inCall = false;
            }
          }
          break;

        case 'call_decline':
          console.log('WS msg call_decline from', user.username);
          if (msg.channel_id) {
            routeToChannelMember(msg, user, 'call_declined');
          } else {
            const target = findUserByUsername(msg.to);
            if (target) {
              try {
                target.ws.send(JSON.stringify({
                  type: 'call_declined',
                  from: user.username,
                }));
              } catch {}
              clientData.inCall = false;
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
            self: { id: user.id, username: user.username, display_name: user.display_name },
            members: getVoiceChannelMembers(channelId).filter(m => m.id !== user.id),
          }));

          broadcastToRoomMembers(channelId, user.id, {
            type: 'user_joined_channel',
            channel_id: channelId,
            username: user.username,
            display_name: user.display_name,
          });
          break;
        }

        case 'leave_channel': {
          const channelId = msg.channel_id;
          if (!channelId) return;
          const members = voiceChannels.get(channelId);
          if (!members) return;
          members.delete(user.id);
          clientData.inCall = false;
          if (members.size === 0) {
            voiceChannels.delete(channelId);
          }
          broadcastToRoomMembers(channelId, user.id, {
            type: 'user_left_channel',
            channel_id: channelId,
            username: user.username,
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      removeFromVoiceChannels(user.id);
      const c = clients.get(user.id);
      if (c && c.ws === ws) {
        clients.delete(user.id);
        for (const [otherId, other] of clients) {
          if (other.inCall) {
            try {
              other.ws.send(JSON.stringify({
                type: 'call_ended', from: user.username,
              }));
            } catch {}
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
