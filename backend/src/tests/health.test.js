'use strict';

const request = require('supertest');
const app = require('../app');

describe('GET /health', () => {
  it('returns 200 with status, uptime, and timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });
});

describe('GET /api/health/full', () => {
  it('returns 200 with non-secret runtime health details', async () => {
    const res = await request(app).get('/api/health/full');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      environment: expect.any(String),
      memory: expect.any(Object),
    });
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
    expect(res.body).not.toHaveProperty('DATABASE_URL');
    expect(res.body).not.toHaveProperty('JWT_SECRET');
    expect(res.body).not.toHaveProperty('OPENAI_API_KEY');
  });
});
