'use strict';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../app');
const { classify } = require('../agents/classifier');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('AgentEngine — LLM classification pipeline', () => {
  let ctx;
  let token;
  let restoreFetch;

  beforeAll(async () => {
    restoreFetch = installLlmFetchMock();
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    restoreFetch();
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('creating a lead creates classification, priority, and follow-up activities', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Agent Test Lead', phone: '+91 99999 00001', message: 'urgent demo request' });

    expect(res.status).toBe(201);

    const activities = await prisma.leadActivity.findMany({ where: { leadId: res.body.id } });
    const types = activities.map((a) => a.type);

    expect(types).toContain('AGENT_CLASSIFIED');
    expect(types).toContain('AGENT_PRIORITIZED');
    expect(types).toContain('FOLLOW_UP_SCHEDULED');
  });

  it('stores LLM-driven tags used by downstream automations', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({
        name: 'Tagged Lead',
        phone: '+91 99999 00002',
        message: 'I need a demo and admission information please',
      });

    expect(res.status).toBe(201);

    const classified = await prisma.leadActivity.findFirst({
      where: { leadId: res.body.id, type: 'AGENT_CLASSIFIED' },
    });

    expect(classified).not.toBeNull();
    expect(classified.metadata.tags).toContain('DEMO_REQUEST');
    expect(classified.metadata.tags).toContain('ADMISSION');
  });

  it('keeps LeadActivity rows scoped to the correct tenant', async () => {
    const ctx2 = await createTestContext();
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx2.slug, email: ctx2.email, password: ctx2.password });
    const token2 = login2.body.token;

    const [r1, r2] = await Promise.all([
      request(app).post('/api/leads').set(auth()).send({ name: 'T1 Lead', phone: '+91 11111 00001' }),
      request(app).post('/api/leads').set({ Authorization: `Bearer ${token2}` }).send({ name: 'T2 Lead', phone: '+91 22222 00002' }),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const t1Activities = await prisma.leadActivity.findMany({ where: { leadId: r1.body.id } });
    const t2Activities = await prisma.leadActivity.findMany({ where: { leadId: r2.body.id } });

    expect(t1Activities.every((a) => a.leadId === r1.body.id)).toBe(true);
    expect(t2Activities.every((a) => a.leadId === r2.body.id)).toBe(true);

    await ctx2.cleanup();
  });

  it('creates a default AgentConfig if none exists for the business', async () => {
    await prisma.agentConfig.deleteMany({ where: { businessId: ctx.business.id } });

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

  it('stores LLM metadata for later evaluation and tuning', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set(auth())
      .send({ name: 'Metadata Shape Lead', phone: '+91 99999 00005', message: 'I need demo information' });

    expect(res.status).toBe(201);

    const classified = await prisma.leadActivity.findFirst({
      where: { leadId: res.body.id, type: 'AGENT_CLASSIFIED' },
    });

    expect(classified).not.toBeNull();
    const meta = classified.metadata;
    expect(Array.isArray(meta.tags)).toBe(true);
    expect(typeof meta.bestCategory).toBe('string');
    expect(['high', 'medium', 'low']).toContain(meta.confidenceLabel);
    expect(typeof meta.confidenceScore).toBe('number');
    expect(['llm_classifier', 'llm_fallback']).toContain(meta.via);
    expect(typeof meta.provider).toBe('string');
    expect(typeof meta.model).toBe('string');
    expect(typeof meta.promptKey).toBe('string');
    expect(meta).toHaveProperty('rawOutput');
    expect(meta).toHaveProperty('correction');
  });

  it('routes vertical prompt packs by industry', async () => {
    const result = await classify({
      lead: { message: 'Need urgent appointment today' },
      business: { name: 'City Clinic', industry: 'clinic' },
    });

    expect(result.vertical).toBe('clinic');
    expect(result.bestCategory).toBe('URGENT_HEALTH_QUERY');
    expect(result.priority).toBe('HIGH');
  });
});
