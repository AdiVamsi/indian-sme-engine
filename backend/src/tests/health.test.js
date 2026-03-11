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
