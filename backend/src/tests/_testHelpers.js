'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const createTestContext = async () => {
  const prisma = new PrismaClient();
  const slug = `test-biz-${Date.now()}`;
  const password = 'Test@12345';

  const business = await prisma.business.create({
    data: { name: 'Test Business', slug },
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Test Owner',
      email: `owner@${slug}.test`,
      passwordHash,
      role: 'OWNER',
    },
  });

  const cleanup = async () => {
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.$disconnect();
  };

  return { business, user, password, slug, email: user.email, cleanup };
};

module.exports = { createTestContext };
