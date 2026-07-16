'use strict';

const { EventEmitter } = require('node:events');

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

function notify(userId, notification) {
  emitter.emit('notification:' + userId, notification);
}

function onNotification(userId, callback) {
  const handler = (data) => callback(data);
  emitter.on('notification:' + userId, handler);
  return () => emitter.off('notification:' + userId, handler);
}

module.exports = { notify, onNotification };