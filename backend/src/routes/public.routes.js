'use strict';

const { Router } = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');

const { findBusinessBySlug } = require('../services/auth.service');
const { createLead } = require('../services/leads.service');

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
  const result = bodySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  const { name, phone, email, message, hp } = result.data;

  if (hp) {
    return res.status(200).json({ ok: true });
  }

  try {
    const business = await findBusinessBySlug(req.params.businessSlug);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    await createLead(business.id, { name, phone, email, message });

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
