'use strict';

const { PORT, NODE_ENV } = require('./config/env');
const { PrismaClient } = require('@prisma/client');
const app = require('./app');
const { initRealtime } = require('./realtime/socket');

const prisma = new PrismaClient();

const server = app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server started`);
  console.log(`  Environment : ${NODE_ENV}`);
  console.log(`  Port        : ${PORT}`);
});

initRealtime(server);

/* ── Graceful shutdown ── */
const shutdown = (signal) => {
  console.log(`\n[${new Date().toISOString()}] ${signal} received — shutting down gracefully`);
  server.close(() => {
    prisma.$disconnect().then(() => {
      console.log('Prisma disconnected. Goodbye.');
      process.exit(0);
    });
  });
};

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
