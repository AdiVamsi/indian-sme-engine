/**
 * realtime.js — WebSocket client for the admin dashboard.
 *
 * Imports WS_BASE_URL from config.js — the only place it lives.
 * Handles connect, message dispatch, auto-reconnect, and status indicator.
 *
 * Usage:
 *   import { connectRealtime } from './realtime.js';
 *   const ws = connectRealtime(token, { 'lead:new': (payload) => { ... } });
 *   ws.close(); // on logout
 */

import { WS_BASE_URL } from './config.js';

const RECONNECT_DELAY = 3_000; // ms

/**
 * @param {string}   token     JWT bearer token
 * @param {object}   handlers  Map of event name → handler function
 * @param {{ onOpen?: () => void }} [opts]
 * @returns {{ close(): void }}
 */
export function connectRealtime(token, handlers = {}, { onOpen } = {}) {
  let socket;
  let reconnectTimer;
  let closedByClient = false;

  /* ── Status indicator ── */
  const setStatus = (text, ok) => {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.textContent = text;
    el.className   = `ws-status ${ok ? 'ws-status--on' : 'ws-status--off'}`;
  };

  /* ── Connect / reconnect ── */
  const connect = () => {
    closedByClient = false;
    socket = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(token)}`);

    socket.addEventListener('open', () => {
      setStatus('● Live', true);
      clearTimeout(reconnectTimer);
      onOpen?.();
    });

    socket.addEventListener('message', (evt) => {
      try {
        const { event, payload } = JSON.parse(evt.data);
        handlers[event]?.(payload);
      } catch {
        /* ignore malformed frames */
      }
    });

    socket.addEventListener('close', () => {
      if (closedByClient) return;
      setStatus('○ Reconnecting…', false);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
    });

    socket.addEventListener('error', () => {
      socket.close(); // triggers 'close' → reconnect
    });
  };

  connect();

  return {
    close() {
      closedByClient = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
