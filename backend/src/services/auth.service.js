'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const findBusinessBySlug = (slug) =>
  prisma.business.findUnique({ where: { slug } });

const findUserByBusinessAndEmail = (businessId, email) =>
  prisma.user.findUnique({ where: { businessId_email: { businessId, email } } });

module.exports = { findBusinessBySlug, findUserByBusinessAndEmail };
