(function () {
  'use strict';

  var voiceJoinButtons = {};
  var voiceMemberLists = {};
  var joinedChannelId = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.ExtrovertCall) return;

    document.querySelectorAll('.voice-join-btn').forEach(function (btn) {
      var cid = parseInt(btn.dataset.channelId, 10);
      voiceJoinButtons[cid] = btn;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var cid = parseInt(this.dataset.channelId, 10);
        toggleVoiceChannel(cid);
      });
    });

    document.querySelectorAll('.voice-members').forEach(function (el) {
      var cid = parseInt(el.id.replace('voice-members-', ''), 10);
      voiceMemberLists[cid] = el;
    });

    ExtrovertCall.on('channel_joined', onChannelJoined);
    ExtrovertCall.on('user_joined_channel', onUserJoinedChannel);
    ExtrovertCall.on('user_left_channel', onUserLeftChannel);
    ExtrovertCall.on('incoming_call', onVoiceIncomingCall);
  });

  function toggleVoiceChannel(channelId) {
    if (joinedChannelId === channelId) {
      leaveVoiceChannel();
    } else {
      if (joinedChannelId) leaveVoiceChannel();
      ExtrovertCall.joinChannel(getRoomId(), channelId);
    }
  }

  function leaveVoiceChannel() {
    if (joinedChannelId) {
      ExtrovertCall.leaveChannel(joinedChannelId);
      var btn = voiceJoinButtons[joinedChannelId];
      if (btn) btn.textContent = 'Join';
      var list = voiceMemberLists[joinedChannelId];
      if (list) { list.classList.remove('active'); list.innerHTML = ''; }
      var count = document.getElementById('voice-count-' + joinedChannelId);
      if (count) count.textContent = '0';
      joinedChannelId = null;
    }
  }

  function onChannelJoined(channelId, members) {
    joinedChannelId = channelId;
    var btn = voiceJoinButtons[channelId];
    if (btn) btn.textContent = 'Leave';
    var list = voiceMemberLists[channelId];
    if (list) {
      list.classList.add('active');
      list.innerHTML = '';
      members.forEach(function (m) {
        addMemberToList(channelId, m.username, m.display_name);
      });
    }
    updateVoiceCount(channelId, members.length);
    var barLabel = document.getElementById('call-bar-label');
    if (barLabel) {
      var chName = getChannelName(channelId);
      barLabel.textContent = 'Voice: ' + (chName || 'Channel');
    }
    members.forEach(function (m) {
      ExtrovertCall.initiateCallToMember(m.username);
    });
  }

  function onUserJoinedChannel(channelId, username, displayName) {
    addMemberToList(channelId, username, displayName);
    updateVoiceCount(channelId);
    if (joinedChannelId === channelId) {
      ExtrovertCall.initiateCallToMember(username);
    }
  }

  function onUserLeftChannel(channelId, username) {
    var el = document.getElementById('voice-member-' + channelId + '-' + username);
    if (el) el.remove();
    updateVoiceCount(channelId);
  }

  function onVoiceIncomingCall(username, displayName, sdp, channelId) {
    if (joinedChannelId && channelId && String(channelId) === String(joinedChannelId)) {
      ExtrovertCall.answerCall(username, sdp);
    }
  }

  function addMemberToList(channelId, username, displayName) {
    var list = voiceMemberLists[channelId];
    if (!list) return;
    var existing = document.getElementById('voice-member-' + channelId + '-' + username);
    if (existing) return;
    var div = document.createElement('div');
    div.className = 'voice-member';
    div.id = 'voice-member-' + channelId + '-' + username;
    div.innerHTML = '<span class="voice-member-speaking">🔊</span><span class="voice-member-name">' + escapeHtml(displayName || username) + '</span>';
    list.appendChild(div);
  }

  function updateVoiceCount(channelId, explicitCount) {
    var countEl = document.getElementById('voice-count-' + channelId);
    if (!countEl) return;
    if (explicitCount !== undefined) {
      countEl.textContent = explicitCount;
      return;
    }
    var list = voiceMemberLists[channelId];
    if (list) {
      countEl.textContent = list.querySelectorAll('.voice-member').length;
    }
  }

  function getRoomId() {
    var parts = window.location.pathname.split('/');
    return parts[2];
  }

  function getChannelName(channelId) {
    var el = document.querySelector('.voice-channel[data-channel-id="' + channelId + '"] .voice-name');
    return el ? el.textContent : null;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
