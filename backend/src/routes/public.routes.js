'use strict';

const { Router } = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');

const { findBusinessBySlug } = require('../services/auth.service');
const { createLead } = require('../services/leads.service');
const { broadcast } = require('../realtime/socket');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const bodySchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional(),
  message: z.string().optional(),
  company: z.string().optional(),
  website: z.string().optional(),
  hp: z.string().optional(),
});

const router = Router();

router.post('/:businessSlug/leads', limiter, async (req, res) => {
  try {
    const data = bodySchema.parse(req.body);

    if (data.hp) {
      return res.status(200).json({ ok: true });
    }

    const business = await findBusinessBySlug(req.params.businessSlug);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const lead = await createLead(business.id, {
      name:    data.name,
      phone:   data.phone,
      email:   data.email,
      message: data.message,
    });
    broadcast(business.id, 'lead:new', lead);

    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') {
      const firstError = err.errors?.[0]?.message || 'Invalid form data';
      return res.status(400).json({ error: firstError });
    }

    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
