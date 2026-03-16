'use strict';

jest.mock('../realtime/socket', () => {
  const actual = jest.requireActual('../realtime/socket');
  return {
    ...actual,
    broadcast: jest.fn(),
  };
});

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { AgentEngine } = require('../agents');
const { broadcast } = require('../realtime/socket');
const app = require('../app');
const { createTestContext, installLlmFetchMock } = require('./_testHelpers');

const prisma = new PrismaClient();

describe('Public Lead Capture', () => {
  let ctx;
  let restoreFetch;

  beforeAll(async () => {
    restoreFetch = installLlmFetchMock();
    ctx = await createTestContext();
  }, 15000);

  afterAll(async () => {
    restoreFetch();
    await ctx.cleanup();
    await prisma.$disconnect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    broadcast.mockClear();
  });

  const url = () => `/api/public/${ctx.slug}/leads`;
  const validBody = { name: 'Test Customer', phone: '+91 99999 00001' };

  async function authHeader() {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    return { Authorization: `Bearer ${login.body.token}` };
  }

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

  it('responds immediately after raw lead save and completes classification asynchronously', async () => {
    const actualRun = AgentEngine.run;
    let releaseEngine;
    const engineGate = new Promise((resolve) => {
      releaseEngine = resolve;
    });
    const engineSpy = jest.spyOn(AgentEngine, 'run').mockImplementation(async (...args) => {
      await engineGate;
      return actualRun(...args);
    });

    const responsePromise = request(app).post(url()).send({
      name: 'Async Lead',
      phone: '+91 99999 11111',
      message: 'I need coaching immediately',
    });

    const respondedBeforeEngineFinished = await Promise.race([
      responsePromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 75)),
    ]);

    expect(respondedBeforeEngineFinished).toBe(true);

    const res = await responsePromise;

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });

    const rawLead = await prisma.lead.findFirst({
      where: { businessId: ctx.business.id, phone: '+91 99999 11111' },
      orderBy: { createdAt: 'desc' },
    });
    expect(rawLead).toBeTruthy();

    expect(broadcast).toHaveBeenCalledWith(
      ctx.business.id,
      'lead:new',
      expect.objectContaining({
        id: rawLead.id,
        phone: '+91 99999 11111',
        status: 'NEW',
        priority: 'LOW',
        tags: [],
        hasClassification: false,
        hasPrioritization: false,
      })
    );

    const earlyActivities = await prisma.leadActivity.count({ where: { leadId: rawLead.id } });
    expect(earlyActivities).toBe(0);

    releaseEngine();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const laterActivities = await prisma.leadActivity.findMany({
      where: { leadId: rawLead.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(laterActivities.some((activity) => activity.type === 'AGENT_CLASSIFIED')).toBe(true);
    expect(laterActivities.some((activity) => activity.type === 'AGENT_PRIORITIZED')).toBe(true);
    expect(engineSpy).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith(
      ctx.business.id,
      'lead:new',
      expect.objectContaining({
        id: rawLead.id,
        phone: '+91 99999 11111',
        priority: expect.any(String),
        tags: expect.any(Array),
        hasClassification: true,
        hasPrioritization: true,
      })
    );
  });

  it('fresh website leads are returned by the dashboard API even before classification finishes', async () => {
    const actualRun = AgentEngine.run;
    let releaseEngine;
    const engineGate = new Promise((resolve) => {
      releaseEngine = resolve;
    });
    jest.spyOn(AgentEngine, 'run').mockImplementation(async (...args) => {
      await engineGate;
      return actualRun(...args);
    });

    const res = await request(app).post(url()).send({
      name: 'Dashboard Visible Lead',
      phone: '+91 99999 22222',
      message: 'Please share admission details',
    });

    expect(res.status).toBe(201);

    const leadsRes = await request(app)
      .get('/api/admin/leads')
      .set(await authHeader());

    expect(leadsRes.status).toBe(200);
    expect(leadsRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phone: '+91 99999 22222',
          status: 'NEW',
          priority: 'LOW',
          tags: [],
          source: 'web',
          hasClassification: false,
          hasPrioritization: false,
        }),
      ])
    );

    releaseEngine();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
});
