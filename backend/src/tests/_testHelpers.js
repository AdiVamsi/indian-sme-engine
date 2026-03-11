'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

function detectLanguageMode(message) {
  const text = (message || '').toLowerCase();
  const hinglishMarkers = ['mujhe', 'chahiye', 'kitni', 'bhejo', 'karna', 'hai', 'nahi', 'abhi', 'sir'];
  const englishMarkers = ['need', 'admission', 'fees', 'demo', 'appointment', 'membership', 'price'];
  const hasHinglish = hinglishMarkers.some((token) => text.includes(token));
  const hasEnglish = englishMarkers.some((token) => text.includes(token));

  if (hasHinglish && hasEnglish) return 'mixed';
  if (hasHinglish) return 'hinglish';
  if (hasEnglish) return 'english';
  return 'other';
}

function buildMockClassification({ industry, businessName, message }) {
  const text = (message || '').toLowerCase();
  const business = (businessName || '').toLowerCase();
  const languageMode = detectLanguageMode(text);

  const make = (overrides) => ({
    intent: 'GENERAL_ENQUIRY',
    priority: 'LOW',
    priorityScore: 0,
    tags: [],
    confidence: 0.9,
    confidenceLabel: 'high',
    disposition: 'weak',
    languageMode,
    reasoning: 'Weak generic enquiry.',
    suggestedNextAction: 'Review manually',
    ...overrides,
  });

  if (!text.trim()) {
    return make({
      confidence: 0.1,
      confidenceLabel: 'low',
      reasoning: 'No message provided.',
    });
  }

  if (/(wasting your time|timepass|sir bas checking|checking only|spam|test only|test$)/.test(text)) {
    return make({
      intent: 'JUNK',
      disposition: 'junk',
      reasoning: 'Message looks like junk or timepass.',
      suggestedNextAction: 'Ignore lead',
    });
  }

  if (/(not interested|dont need|don't need|abhi nahi chahiye|nahi chahiye)/.test(text)) {
    return make({
      intent: 'NOT_INTERESTED',
      disposition: 'not_interested',
      reasoning: 'Sender is not interested.',
      suggestedNextAction: 'Close lead',
    });
  }

  if (industry === 'academy') {
    if (business.includes('jee') && /(neet|ias|upsc|dance|music)/.test(text)) {
      return make({
        intent: 'WRONG_FIT',
        disposition: 'wrong_fit',
        reasoning: 'Enquiry does not match the academy focus.',
        suggestedNextAction: 'Mark wrong fit',
      });
    }

    if (/(demo|trial class|demo class)/.test(text)) {
      const tags = ['DEMO_REQUEST'];
      if (/(admission|join|coaching)/.test(text)) tags.push('ADMISSION');
      return make({
        intent: 'DEMO_REQUEST',
        priority: 'HIGH',
        priorityScore: 35,
        tags,
        disposition: 'valid',
        reasoning: 'Requested demo class.',
        suggestedNextAction: 'Send demo details',
      });
    }

    if (/(fees|fee|price|cost|kitni)/.test(text) && /(whatsapp|details bhejo|send details)/.test(text)) {
      return make({
        intent: 'WHATSAPP_REQUEST',
        priority: 'NORMAL',
        priorityScore: 18,
        tags: ['WHATSAPP_REQUEST', 'FEES'],
        disposition: 'valid',
        reasoning: 'Wants fee details on WhatsApp.',
        suggestedNextAction: 'Share fees on WhatsApp',
      });
    }

    if (/(fees|fee|price|cost|kitni)/.test(text)) {
      return make({
        intent: 'FEE_ENQUIRY',
        priority: 'NORMAL',
        priorityScore: 15,
        tags: ['FEE_ENQUIRY', 'FEES'],
        disposition: 'valid',
        reasoning: 'Asked about fees.',
        suggestedNextAction: 'Share fee details',
      });
    }

    if (/(batch|timing|schedule|next month|next week|tomorrow|from tomorrow|starting tomorrow)/.test(text) && /(coaching|admission|join)/.test(text)) {
      return make({
        intent: 'ADMISSION',
        priority: 'HIGH',
        priorityScore: 35,
        tags: ['ADMISSION', 'TIMING_QUERY'],
        disposition: 'valid',
        reasoning: 'Admission intent with urgency.',
        suggestedNextAction: 'Call within 15 minutes',
      });
    }

    if (/(coaching|admission|join|admission lena hai)/.test(text)) {
      return make({
        intent: 'ADMISSION',
        priority: 'HIGH',
        priorityScore: 32,
        tags: ['ADMISSION'],
        disposition: 'valid',
        reasoning: 'Clear admission intent.',
        suggestedNextAction: 'Call soon',
      });
    }
  }

  if (industry === 'clinic') {
    if (/(urgent|emergency|pain|bleeding|today|immediately)/.test(text)) {
      return make({
        intent: 'URGENT_HEALTH_QUERY',
        priority: 'HIGH',
        priorityScore: 40,
        tags: ['URGENT_HEALTH_QUERY', 'URGENT'],
        disposition: 'valid',
        reasoning: 'Urgent health concern.',
        suggestedNextAction: 'Call immediately',
      });
    }

    if (/(appointment|consultation|doctor|visit)/.test(text)) {
      return make({
        intent: 'APPOINTMENT_REQUEST',
        priority: 'NORMAL',
        priorityScore: 20,
        tags: ['APPOINTMENT_REQUEST'],
        disposition: 'valid',
        reasoning: 'Requested clinic appointment.',
        suggestedNextAction: 'Offer appointment slot',
      });
    }
  }

  if (industry === 'gym') {
    if (/(trial|trial session)/.test(text)) {
      return make({
        intent: 'TRIAL_REQUEST',
        priority: 'HIGH',
        priorityScore: 30,
        tags: ['TRIAL_REQUEST'],
        disposition: 'valid',
        reasoning: 'Requested gym trial.',
        suggestedNextAction: 'Book trial slot',
      });
    }

    if (/(membership|join gym|trainer)/.test(text)) {
      return make({
        intent: 'MEMBERSHIP_ENQUIRY',
        priority: 'NORMAL',
        priorityScore: 18,
        tags: ['MEMBERSHIP_ENQUIRY'],
        disposition: 'valid',
        reasoning: 'Gym membership enquiry.',
        suggestedNextAction: 'Share membership plans',
      });
    }
  }

  return make({
    intent: industry === 'other' ? 'PRODUCT_OR_SERVICE_ENQUIRY' : 'GENERAL_ENQUIRY',
    priority: 'NORMAL',
    priorityScore: 12,
    tags: [],
    disposition: 'weak',
    reasoning: 'General enquiry with limited detail.',
    suggestedNextAction: 'Reply with more details',
  });
}

function installLlmFetchMock(options = {}) {
  const originalFetch = global.fetch;
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousProvider = process.env.LLM_CLASSIFIER_PROVIDER;
  const previousModel = process.env.LLM_CLASSIFIER_MODEL;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LLM_CLASSIFIER_PROVIDER = 'openai';
  process.env.LLM_CLASSIFIER_MODEL = 'gpt-4o-mini';

  global.fetch = jest.fn(async (_url, requestOptions = {}) => {
    if (options.transportError) {
      throw new Error(options.transportError);
    }

    const payload = JSON.parse(requestOptions.body || '{}');
    const userMessage = payload.messages?.find((entry) => entry.role === 'user')?.content || '{}';
    const userPayload = JSON.parse(userMessage);
    const classification = options.classification || buildMockClassification(userPayload);
    const content = options.rawContent ?? JSON.stringify(classification);

    return {
      ok: options.ok !== undefined ? options.ok : true,
      status: options.status || 200,
      text: async () => options.errorText || '',
      json: async () => ({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
    };
  });

  return () => {
    global.fetch = originalFetch;

    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousApiKey;

    if (previousProvider === undefined) delete process.env.LLM_CLASSIFIER_PROVIDER;
    else process.env.LLM_CLASSIFIER_PROVIDER = previousProvider;

    if (previousModel === undefined) delete process.env.LLM_CLASSIFIER_MODEL;
    else process.env.LLM_CLASSIFIER_MODEL = previousModel;
  };
}

const createTestContext = async () => {
  const prisma = new PrismaClient();
  const slug = `test-biz-${Date.now()}`;
  const password = 'Test@12345';

  const business = await prisma.business.create({
    data: { name: 'Test JEE Academy', slug, industry: 'academy' },
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Test Owner',
      email: `owner@${slug}.test`,
      passwordHash,
      role: 'OWNER',
    },
  });

  const cleanup = async () => {
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.$disconnect();
  };

  return { business, user, password, slug, email: user.email, cleanup };
};

module.exports = { createTestContext, installLlmFetchMock };
