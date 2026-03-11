'use strict';

/* Must be the first line — loads .env before any module reads process.env */
require('dotenv').config();

const http = require('node:http');

const { PORT, NODE_ENV } = require('./config/env');
const app = require('./app');
const { disconnectPrisma } = require('./lib/prisma');
const { logger } = require('./lib/logger');
const { initRealtime, closeRealtime } = require('./realtime/socket');

const server = http.createServer(app);

server.listen(PORT, () => {
  logger.info({
    environment: NODE_ENV,
    port: PORT,
  }, 'Server started');
});

initRealtime(server);

/* ── Graceful shutdown ── */
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received');

  const forceCloseTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceCloseTimer.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await closeRealtime();
    await disconnectPrisma();
    clearTimeout(forceCloseTimer);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceCloseTimer);
    logger.error({ err }, 'Shutdown failed');
    process.exit(1);
  }
};

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});
