'use strict';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const app = require('../app');
const { createTestContext } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('Public site rendering', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestContext();

    await prisma.business.update({
      where: { id: ctx.business.id },
      data: {
        name: 'Public Site Test Academy',
        phone: '+91 98765 00000',
        email: 'hello@publicsitetest.in',
        address: 'Connaught Place',
        city: 'New Delhi',
        country: 'India',
      },
    });

    await prisma.service.createMany({
      data: [
        {
          businessId: ctx.business.id,
          title: 'JEE Foundation Batch',
          description: 'Structured classroom guidance for students starting their preparation.',
          priceInr: 60000,
        },
        {
          businessId: ctx.business.id,
          title: 'Advanced Problem Solving',
          description: 'Focused support for high-intent aspirants preparing for advanced rounds.',
          priceInr: 90000,
        },
      ],
    });

    await prisma.testimonial.create({
      data: {
        businessId: ctx.business.id,
        customerName: 'Aarav Mehta',
        text: 'Excellent counselling support and very clear batch guidance.',
        rating: 5,
      },
    });
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  it('GET /site/:slug injects tenant-managed business content into the public site shell', async () => {
    const res = await request(app).get(`/site/${ctx.slug}`);

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/html/);
    expect(res.text).toContain('id="site-bootstrap"');
    expect(res.text).toContain('Public Site Test Academy');
    expect(res.text).toContain('JEE Foundation Batch');
    expect(res.text).toContain('Aarav Mehta');
    expect(res.text).toContain('Excellent counselling support and very clear batch guidance.');
    expect(res.text).toContain(`/form/${ctx.slug}`);
  });

  it('GET /site/:slug returns 404 when the tenant slug does not exist', async () => {
    const res = await request(app).get('/site/no-such-business-slug');

    expect(res.status).toBe(404);
    expect(res.text).toContain('Public site not found');
  });

  it('GET /site/style.css still falls through to the static asset', async () => {
    const res = await request(app).get('/site/style.css');

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/css/);
  });
});
