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
  const result = bodySchema.safeParse(req.body);
  if (!result.success) {
    /* Pick the first field-level message so the frontend always gets a plain string. */
    const fieldErrors = result.error.flatten().fieldErrors;
    const firstField  = Object.keys(fieldErrors)[0];
    const message     = firstField
      ? `${firstField}: ${fieldErrors[firstField][0]}`
      : 'Invalid request';
    return res.status(400).json({ error: message });
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

    const lead = await createLead(business.id, { name, phone, email, message });
    broadcast(business.id, 'lead:new', lead);

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
