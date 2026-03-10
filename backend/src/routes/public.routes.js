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

/* Phone regex: optional '+', then 7-15 digits (spaces/dashes/dots allowed in between) */
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;
/* After stripping non-digits, must have 7-15 digits */
const PHONE_DIGITS_RE = /^\d{7,15}$/;

const bodySchema = z.object({
  name: z.string()
    .transform((s) => s.trim())
    .pipe(z.string().min(2, 'Name must be at least 2 characters')),
  phone: z.string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, 'Phone is required'))
    .refine((s) => PHONE_RE.test(s), { message: 'Please enter a valid phone number' })
    .refine((s) => PHONE_DIGITS_RE.test(s.replace(/\D/g, '')), { message: 'Phone number must have 7–15 digits' }),
  email: z.string()
    .transform((s) => s.trim())
    .pipe(z.string().email('Please enter a valid email address'))
    .optional()
    .or(z.literal('')),
  message: z.string()
    .transform((s) => s.trim())
    .optional()
    .or(z.literal('')),
  /* Honeypot fields — must stay in schema so bots can fill them */
  company: z.string().optional(),
  website: z.string().optional(),
  hp: z.string().optional(),
});

const router = Router();

router.post('/:businessSlug/leads', limiter, async (req, res) => {
  try {
    const data = bodySchema.parse(req.body);

    /* Honeypot — return fake 200 silently */
    if (data.hp) {
      return res.status(200).json({ ok: true });
    }

    /* Treat empty-string email as absent */
    const email = data.email || undefined;
    /* Treat empty-string message as absent */
    const message = data.message || undefined;

    const business = await findBusinessBySlug(req.params.businessSlug);
    if (!business) {
      console.warn('[Public] Business not found for slug:', req.params.businessSlug);
      return res.status(404).json({ error: 'Business not found' });
    }

    console.log('[Public] Creating lead for business:', business.id, '| slug:', req.params.businessSlug);

    const lead = await createLead(business.id, {
      name: data.name,
      phone: data.phone,
      email,
      message,
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

