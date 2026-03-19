'use strict';

const { classifyWithModel } = require('../agents/modelClassifier');

describe('Model classifier prompt construction', () => {
  let originalFetch;
  let originalApiKey;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it('includes business keyword and priority hints in the system prompt when config overrides exist', async () => {
    let payload = null;

    global.fetch = jest.fn(async (_url, options) => {
      payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'FEE_ENQUIRY',
                  priority: 'NORMAL',
                  priorityScore: 24,
                  tags: ['FEE_ENQUIRY', 'COURSE_INFO'],
                  confidence: 0.88,
                  confidenceLabel: 'high',
                  disposition: 'valid',
                  languageMode: 'english',
                  reasoning: 'Clear IELTS fee request.',
                  suggestedNextAction: 'Share fees and batch details.',
                }),
              },
            },
          ],
        }),
      };
    });

    await classifyWithModel({
      lead: {
        message: 'Need IELTS fee details and weekend batch timing.',
      },
      business: {
        name: 'Lexicon IELTS & Spoken English Institute',
        industry: 'academy',
      },
      config: {
        classificationRules: {
          keywords: {
            FEE_ENQUIRY: ['ielts fee', 'spoken english fee'],
            COURSE_INFO: ['ielts', 'spoken english', 'pte'],
          },
        },
        priorityRules: {
          weights: {
            ielts: 25,
            'weekend batch': 12,
          },
        },
      },
    });

    const systemPrompt = payload.messages.find((message) => message.role === 'system')?.content || '';

    expect(systemPrompt).toContain('Business keyword hints:');
    expect(systemPrompt).toContain('FEE_ENQUIRY: ielts fee, spoken english fee');
    expect(systemPrompt).toContain('Business priority hints:');
    expect(systemPrompt).toContain('ielts=25');
    expect(systemPrompt).toContain('weekend batch=12');
  });
});
