'use strict';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('Public Lead Capture', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const url = () => `/api/public/${ctx.slug}/leads`;
  const validBody = { name: 'Test Customer', phone: '+91 99999 00001' };

  it('POST creates a lead and returns 201 {ok:true}', async () => {
    const res = await request(app).post(url()).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST with honeypot hp set returns 200 {ok:true} but does NOT create a lead', async () => {
    const before = await prisma.lead.count({ where: { businessId: ctx.business.id } });

    const res = await request(app).post(url()).send({ ...validBody, hp: 'spam' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const after = await prisma.lead.count({ where: { businessId: ctx.business.id } });
    expect(after).toBe(before);
  });

  it('POST with unknown businessSlug returns 404', async () => {
    const res = await request(app)
      .post('/api/public/this-biz-does-not-exist/leads')
      .send(validBody);

    expect(res.status).toBe(404);
  });
});
