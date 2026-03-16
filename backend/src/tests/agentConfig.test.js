'use strict';

const request = require('supertest');

const app = require('../app');
const { createTestContext } = require('./_testHelpers');

describe('AgentConfig API', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestContext();
  }, 15000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function loginAndGetToken() {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ businessSlug: ctx.slug, email: ctx.email, password: ctx.password });

    expect(res.status).toBe(200);
    return res.body.token;
  }

  it('returns effective WhatsApp reply config and preset data', async () => {
    const token = await loginAndGetToken();

    const res = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.industry).toBe('academy');
    expect(res.body.whatsappReplyConfig.institutionLabel).toBe('counsellor');
    expect(res.body.whatsappReplyConfig.primaryOffering).toBe('IIT-JEE coaching');
    expect(res.body.whatsappReplyPreset.institutionLabel).toBe('counsellor');
    expect(res.body.businessKnowledgeConfig).toEqual({
      enabled: false,
      entries: [],
    });
    expect(res.body.businessKnowledgePreset).toEqual({
      enabled: false,
      entries: [],
    });
    expect(res.body.businessKnowledgeUsesPreset).toBe(true);
    expect(res.body.classificationRules.whatsappReplyConfig.supportedOfferings).toEqual(
      expect.arrayContaining(['fee details', 'demo class', 'admission guidance'])
    );
  });

  it('updates business knowledge entries through the existing agent config API', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          ...current.body.classificationRules,
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                title: 'Fee structure',
                category: 'fees',
                intents: ['FEE_ENQUIRY'],
                keywords: ['fees', 'fee structure', 'cost'],
                content: 'Classroom batches start from INR 78,000 per year depending on class and batch.',
                sourceLabel: 'Front desk fee note',
              },
              {
                id: 'online_classes',
                title: 'Online classes',
                category: 'online_classes',
                intents: ['GENERAL_ENQUIRY'],
                keywords: ['online classes', 'live class'],
                content: 'Online support and live classes are available for selected batches.',
                sourceLabel: 'Programme note',
                enabled: false,
              },
            ],
          },
        },
        priorityRules: current.body.priorityRules,
      });

    expect(res.status).toBe(200);
    expect(res.body.businessKnowledgeUsesPreset).toBe(false);
    expect(res.body.businessKnowledgeConfig.enabled).toBe(true);
    expect(res.body.businessKnowledgeConfig.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Fee structure',
          category: 'fees',
          intents: ['FEE_ENQUIRY'],
          keywords: ['fees', 'fee structure', 'cost'],
          sourceLabel: 'Front desk fee note',
          enabled: true,
        }),
        expect.objectContaining({
          id: 'online_classes',
          enabled: false,
        }),
      ])
    );
    expect(res.body.businessKnowledgeConfig.entries[0].id).toBeTruthy();
  });

  it('rejects invalid business knowledge entries', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          ...current.body.classificationRules,
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                title: 'Broken entry',
                category: 'unknown_category',
                intents: ['FEE_ENQUIRY'],
                content: 'This should fail validation.',
              },
            ],
          },
        },
        priorityRules: current.body.priorityRules,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('businessKnowledge');
  });

  it('can reset business knowledge overrides back to the preset fallback', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const saved = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          ...current.body.classificationRules,
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                title: 'Branch location',
                category: 'branch_location',
                intents: ['GENERAL_ENQUIRY'],
                keywords: ['branch', 'location'],
                content: 'Our branch is in Delhi.',
              },
            ],
          },
        },
        priorityRules: current.body.priorityRules,
      });

    expect(saved.status).toBe(200);
    expect(saved.body.businessKnowledgeUsesPreset).toBe(false);

    const reset = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          keywords: current.body.classificationRules.keywords,
          businessKnowledge: null,
        },
        priorityRules: current.body.priorityRules,
      });

    expect(reset.status).toBe(200);
    expect(reset.body.businessKnowledgeUsesPreset).toBe(true);
    expect(reset.body.businessKnowledgeConfig).toEqual(reset.body.businessKnowledgePreset);
  });

  it('updates WhatsApp reply config through the existing agent config API', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const body = {
      followUpMinutes: current.body.followUpMinutes,
      classificationRules: {
        ...current.body.classificationRules,
        whatsappReplyConfig: {
          ...current.body.whatsappReplyConfig,
          institutionLabel: 'admissions team',
          primaryOffering: 'foundation and Olympiad coaching',
          supportedOfferings: ['foundation batch details', 'hostel guidance', 'admission counselling'],
          preferredLanguage: 'english_hindi_friendly',
          requiredCollectedFields: {
            ...current.body.whatsappReplyConfig.requiredCollectedFields,
            GENERAL_ENQUIRY: ['topic'],
          },
          handoffWording: {
            ...current.body.whatsappReplyConfig.handoffWording,
            inProgress: 'Thank you. Our {{institutionLabel}} will take this forward shortly.',
          },
        },
      },
      priorityRules: current.body.priorityRules,
    };

    const res = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.whatsappReplyConfig.institutionLabel).toBe('admissions team');
    expect(res.body.whatsappReplyConfig.primaryOffering).toBe('foundation and Olympiad coaching');
    expect(res.body.whatsappReplyConfig.supportedOfferings).toEqual([
      'foundation batch details',
      'hostel guidance',
      'admission counselling',
    ]);
    expect(res.body.whatsappReplyConfig.requiredCollectedFields.GENERAL_ENQUIRY).toEqual(['topic']);
    expect(res.body.whatsappReplyConfig.handoffWording.inProgress).toBe(
      'Thank you. Our {{institutionLabel}} will take this forward shortly.'
    );
  });

  it('rejects invalid WhatsApp requiredCollectedFields values', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          ...current.body.classificationRules,
          whatsappReplyConfig: {
            ...current.body.whatsappReplyConfig,
            requiredCollectedFields: {
              ...current.body.whatsappReplyConfig.requiredCollectedFields,
              GENERAL_ENQUIRY: ['badField'],
            },
          },
        },
        priorityRules: current.body.priorityRules,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('classificationRules');
  });

  it('preserves existing WhatsApp reply config when only keywords are updated', async () => {
    const token = await loginAndGetToken();
    const current = await request(app)
      .get('/api/agent')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .put('/api/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        followUpMinutes: current.body.followUpMinutes,
        classificationRules: {
          keywords: {
            ...current.body.classificationRules.keywords,
            CALLBACK_REQUEST: ['call me', 'callback'],
          },
        },
        priorityRules: current.body.priorityRules,
      });

    expect(res.status).toBe(200);
    expect(res.body.classificationRules.whatsappReplyConfig).toBeTruthy();
    expect(res.body.whatsappReplyConfig.institutionLabel).toBeTruthy();
  });
});
