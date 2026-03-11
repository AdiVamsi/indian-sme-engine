'use strict';

/* Must be the first line — loads .env before any module reads process.env */
require('dotenv').config();

const http = require('node:http');

const { PORT, NODE_ENV } = require('./config/env');
const app = require('./app');
const { prisma } = require('./lib/prisma');
const { disconnectPrisma } = require('./lib/prisma');
const { logger } = require('./lib/logger');
const { initRealtime, closeRealtime } = require('./realtime/socket');

const server = http.createServer(app);
const SHARMA_SHOWCASE_SLUG = 'sharma-jee-academy-delhi';

server.listen(PORT, () => {
  logger.info({
    environment: NODE_ENV,
    port: PORT,
  }, 'Server started');
});

void (async () => {
  try {
    const showcaseBusiness = await prisma.business.findUnique({
      where: { slug: SHARMA_SHOWCASE_SLUG },
      select: { id: true, slug: true, name: true },
    });

    if (showcaseBusiness) {
      logger.info(
        { slug: showcaseBusiness.slug, businessId: showcaseBusiness.id, name: showcaseBusiness.name },
        'Showcase demo business is available'
      );
      return;
    }

    logger.warn(
      { slug: SHARMA_SHOWCASE_SLUG },
      'Showcase demo business slug is missing; /form/sharma-jee-academy-delhi and public demo lead capture will fail until the database is reseeded'
    );
  } catch (err) {
    logger.warn({ err, slug: SHARMA_SHOWCASE_SLUG }, 'Unable to verify showcase demo business slug at startup');
  }
})();

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
