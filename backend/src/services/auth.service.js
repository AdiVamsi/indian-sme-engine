'use strict';

const { prisma } = require('../lib/prisma');

const findBusinessBySlug = (slug) =>
  prisma.business.findUnique({ where: { slug } });

const findUserByBusinessAndEmail = (businessId, email) =>
  prisma.user.findUnique({ where: { businessId_email: { businessId, email } } });

module.exports = { findBusinessBySlug, findUserByBusinessAndEmail };
