'use strict';

const { WebSocketServer } = require('ws');
const { verify } = require('../utils/jwt');

let wss = null;

/**
 * Attach a WebSocket server to the existing HTTP server.
 * Clients authenticate by passing their JWT as a query param:
 *   ws://host:4000?token=<JWT>
 */
const initRealtime = (server) => {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    try {
      const url   = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(1008, 'Missing token');
        return;
      }

      const payload  = verify(token);
      ws.businessId  = payload.businessId;
    } catch {
      ws.close(1008, 'Invalid or expired token');
      return;
    }

    ws.on('error', console.error);
  });

  console.log('  WebSocket   : ready');
};

/**
 * Send an event to all authenticated clients that belong to the given business.
 * Safe to call even before initRealtime — no-ops if server not yet started.
 *
 * @param {string} businessId
 * @param {string} event
 * @param {object} payload
 */
const broadcast = (businessId, event, payload) => {
  if (!wss) return;

  const message = JSON.stringify({ event, payload });

  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */ && client.businessId === businessId) {
      client.send(message);
    }
  });
};

module.exports = { initRealtime, broadcast };
