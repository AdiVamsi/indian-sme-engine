'use strict';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('AgentEngine — Phase 1', () => {
  let ctx;
  let token;

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  /* ── Test 1: Lead creation triggers AgentEngine → 3 LeadActivity rows ── */
  it('creating a lead creates 3 LeadActivity rows (CLASSIFIED, PRIORITIZED, FOLLOW_UP)', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Agent Test Lead', phone: '+91 99999 00001', message: 'urgent demo request' });

    expect(res.status).toBe(201);
    const leadId = res.body.id;

    const activities = await prisma.leadActivity.findMany({ where: { leadId } });
    expect(activities.length).toBeGreaterThanOrEqual(3);

    const types = activities.map((a) => a.type);
    expect(types).toContain('AGENT_CLASSIFIED');
    expect(types).toContain('AGENT_PRIORITIZED');
    expect(types).toContain('FOLLOW_UP_SCHEDULED');
  });

  /* ── Test 2: Classification tags are applied correctly ── */
  it('classifies "demo" and "admission" keywords into correct tags', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({
        name: 'Tagged Lead',
        phone: '+91 99999 00002',
        message: 'I need a demo and admission information please',
      });

    expect(res.status).toBe(201);
    const leadId = res.body.id;

    const classified = await prisma.leadActivity.findFirst({
      where: { leadId, type: 'AGENT_CLASSIFIED' },
    });

    expect(classified).not.toBeNull();
    expect(classified.metadata.tags).toContain('DEMO_REQUEST');
    expect(classified.metadata.tags).toContain('ADMISSION');
  });

  /* ── Test 3: No cross-tenant leakage ── */
  it('LeadActivity rows are strictly scoped — no cross-tenant leakage', async () => {
    const ctx2 = await createTestContext();
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx2.slug, email: ctx2.email, password: ctx2.password });
    const token2 = login2.body.token;

    /* Create one lead per tenant. */
    const [r1, r2] = await Promise.all([
      request(app).post('/api/leads').set(auth()).send({ name: 'T1 Lead', phone: '+91 11111 00001' }),
      request(app).post('/api/leads').set({ Authorization: `Bearer ${token2}` }).send({ name: 'T2 Lead', phone: '+91 22222 00002' }),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const t1Activities = await prisma.leadActivity.findMany({ where: { leadId: r1.body.id } });
    const t2Activities = await prisma.leadActivity.findMany({ where: { leadId: r2.body.id } });

    /* Each activity must belong only to its own lead. */
    expect(t1Activities.every((a) => a.leadId === r1.body.id)).toBe(true);
    expect(t2Activities.every((a) => a.leadId === r2.body.id)).toBe(true);

    /* No activity from T2 appears in T1's results and vice-versa. */
    const t1Ids = new Set(t1Activities.map((a) => a.id));
    const t2Ids = new Set(t2Activities.map((a) => a.id));
    t2Ids.forEach((id) => expect(t1Ids.has(id)).toBe(false));

    await ctx2.cleanup();
  });

  /* ── Test 4: Default AgentConfig is created when missing ── */
  it('creates a default AgentConfig if none exists for the business', async () => {
    /* Wipe existing config so we test the creation path. */
    await prisma.agentConfig.deleteMany({ where: { businessId: ctx.business.id } });

    const noConfig = await prisma.agentConfig.findUnique({ where: { businessId: ctx.business.id } });
    expect(noConfig).toBeNull();

    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'No-Config Lead', phone: '+91 99999 00003' });

    expect(res.status).toBe(201);

    const config = await prisma.agentConfig.findUnique({ where: { businessId: ctx.business.id } });
    expect(config).not.toBeNull();
    expect(config.followUpMinutes).toBe(30);
    expect(config.toneStyle).toBe('professional');
    expect(config.autoReplyEnabled).toBe(false);
  });
});
