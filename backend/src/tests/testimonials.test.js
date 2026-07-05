'use strict';

const request = require('supertest');
const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('Testimonials', () => {
  let ctx;
  let token;
  let testimonialId;

  beforeAll(async () => {
    ctx = await createTestContext();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    token = res.body.token;
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('POST /api/testimonials - returns 201 with id', async () => {
    const res = await request(app)
      .post('/api/testimonials')
      .set(auth())
      .send({ customerName: 'Priya Sharma', text: 'Excellent coaching', rating: 5 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.customerName).toBe('Priya Sharma');
    expect(res.body.rating).toBe(5);
    testimonialId = res.body.id;
  });

  it('GET /api/testimonials - includes the created testimonial', async () => {
    const res = await request(app).get('/api/testimonials').set(auth());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((t) => t.id === testimonialId)).toBe(true);
  });

  it('DELETE /api/testimonials/:id - returns 204', async () => {
    const del = await request(app).delete(`/api/testimonials/${testimonialId}`).set(auth());
    expect(del.status).toBe(204);
  });

  it('GET /api/testimonials - does not include deleted testimonial', async () => {
    const res = await request(app).get('/api/testimonials').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.some((t) => t.id === testimonialId)).toBe(false);
  });

  it('GET /api/testimonials - returns 401 without token', async () => {
    const res = await request(app).get('/api/testimonials');
    expect(res.status).toBe(401);
  });

  describe('cross-tenant isolation', () => {
    let otherCtx;
    let otherTestimonialId;

    beforeAll(async () => {
      otherCtx = await createTestContext();
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ businessSlug: otherCtx.slug, email: otherCtx.email, password: otherCtx.password });
      const otherToken = loginRes.body.token;

      const testimonialRes = await request(app)
        .post('/api/testimonials')
        .set({ Authorization: `Bearer ${otherToken}` })
        .send({ customerName: 'Other Tenant Customer', text: 'Great service', rating: 5 });
      otherTestimonialId = testimonialRes.body.id;
    }, 15000);

    afterAll(async () => {
      await otherCtx.cleanup();
    });

    it('DELETE /api/testimonials/:id - returns 404 for a testimonial from another tenant', async () => {
      const res = await request(app)
        .delete(`/api/testimonials/${otherTestimonialId}`)
        .set(auth());

      expect(res.status).toBe(404);
    });
  });
});
