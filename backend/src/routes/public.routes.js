'use strict';

const { Router } = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');

const { findBusinessBySlug } = require('../services/auth.service');
const { logger } = require('../lib/logger');
const { emitLeadCreated } = require('../controllers/leads.controller');
const { saveRawLead, processLeadAfterSave } = require('../services/leads.service');

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
  const reqLogger = req.log || logger;

  try {
    const data = bodySchema.parse(req.body);
    reqLogger.info(
      {
        slug: req.params.businessSlug,
        phone: data.phone,
        hasEmail: Boolean(data.email),
        hasMessage: Boolean(data.message),
      },
      'Public form submission received'
    );

    /* Honeypot — return fake 200 silently */
    if (data.hp) {
      reqLogger.info({ slug: req.params.businessSlug }, 'Public form honeypot triggered');
      return res.status(200).json({ ok: true });
    }

    /* Treat empty-string email as absent */
    const email = data.email || undefined;
    /* Treat empty-string message as absent */
    const message = data.message || undefined;

    const business = await findBusinessBySlug(req.params.businessSlug);
    if (!business) {
      reqLogger.warn({ slug: req.params.businessSlug }, 'Public form business not found');
      return res.status(404).json({ error: 'Business not found' });
    }

    reqLogger.info(
      {
        slug: req.params.businessSlug,
        businessId: business.id,
        businessName: business.name,
      },
      'Public form business resolved'
    );

    const lead = await saveRawLead(business.id, {
      name: data.name,
      phone: data.phone,
      email,
      message,
    });
    reqLogger.info(
      {
        slug: req.params.businessSlug,
        businessId: business.id,
        leadId: lead.id,
        source: lead.source,
      },
      'Public lead saved'
    );

    // Make website leads visible in open dashboards immediately, even if
    // async classification is still running or later fails.
    emitLeadCreated(business.id, lead);
    reqLogger.info(
      {
        slug: req.params.businessSlug,
        businessId: business.id,
        leadId: lead.id,
      },
      'Public lead realtime broadcast sent'
    );

    reqLogger.info(
      {
        slug: req.params.businessSlug,
        businessId: business.id,
        leadId: lead.id,
      },
      'Public lead classification started'
    );
    void processLeadAfterSave(lead, {
      businessId: business.id,
      source: lead.source,
      externalMessageId: lead.externalMessageId,
      receivedAt: lead.receivedAt,
    })
      .then((processedLead) => {
        reqLogger.info(
          {
            slug: req.params.businessSlug,
            businessId: business.id,
            leadId: processedLead.id,
            priority: processedLead.priority,
            priorityScore: processedLead.priorityScore,
            tags: processedLead.tags,
          },
          'Public lead classification completed'
        );
        emitLeadCreated(business.id, processedLead);
      })
      .catch((err) => {
        logger.error(
          { err, leadId: lead.id, businessId: business.id, slug: req.params.businessSlug },
          'Public lead background processing failed'
        );
      });

    reqLogger.info(
      {
        slug: req.params.businessSlug,
        businessId: business.id,
        leadId: lead.id,
      },
      'Public lead response returned'
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    if (err.name === 'ZodError') {
      const firstError = err.errors?.[0]?.message || 'Invalid form data';
      return res.status(400).json({ error: firstError });
    }

    reqLogger.error({ err, slug: req.params.businessSlug }, 'Public lead request failed');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
