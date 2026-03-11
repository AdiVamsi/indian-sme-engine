'use strict';

const { classify } = require('../agents/classifier');
const { installLlmFetchMock } = require('./_testHelpers');

describe('LLM lead classifier', () => {
  let restoreFetch;

  beforeAll(() => {
    restoreFetch = installLlmFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('classifies academy admission urgency correctly', async () => {
    const result = await classify({
      lead: { message: 'My sister needs coaching from next month' },
      business: { name: 'Sharma JEE Academy', industry: 'academy' },
    });

    expect(result.bestCategory).toBe('ADMISSION');
    expect(result.priority).toBe('HIGH');
    expect(result.disposition).toBe('valid');
  });

  it('detects junk messages', async () => {
    const result = await classify({
      lead: { message: 'I dont need coaching. just wasting your time' },
      business: { name: 'Sharma JEE Academy', industry: 'academy' },
    });

    expect(result.bestCategory).toBe('JUNK');
    expect(result.disposition).toBe('junk');
    expect(result.priority).toBe('LOW');
  });

  it('detects academy wrong-fit messages', async () => {
    const result = await classify({
      lead: { message: 'Do you have NEET coaching?' },
      business: { name: 'Sharma JEE Academy', industry: 'academy' },
    });

    expect(result.bestCategory).toBe('WRONG_FIT');
    expect(result.disposition).toBe('wrong_fit');
    expect(result.tags).toContain('WRONG_FIT');
  });

  it('detects Hinglish WhatsApp and fee intent', async () => {
    const result = await classify({
      lead: { message: 'fees kitni hai whatsapp pe details bhejo' },
      business: { name: 'Sharma JEE Academy', industry: 'academy' },
    });

    expect(result.bestCategory).toBe('WHATSAPP_REQUEST');
    expect(result.disposition).toBe('valid');
    expect(['hinglish', 'mixed']).toContain(result.languageMode);
  });

  it('handles clinic-specific messages', async () => {
    const result = await classify({
      lead: { message: 'Need urgent appointment today for doctor consultation' },
      business: { name: 'City Clinic', industry: 'clinic' },
    });

    expect(result.vertical).toBe('clinic');
    expect(result.bestCategory).toBe('URGENT_HEALTH_QUERY');
    expect(result.priority).toBe('HIGH');
  });

  it('handles gym-specific messages', async () => {
    const result = await classify({
      lead: { message: 'Need a trial session and trainer info' },
      business: { name: 'Iron Pulse Gym', industry: 'gym' },
    });

    expect(result.vertical).toBe('gym');
    expect(result.bestCategory).toBe('TRIAL_REQUEST');
  });

  it('falls back safely on invalid JSON', async () => {
    restoreFetch();
    restoreFetch = installLlmFetchMock({ rawContent: 'not valid json' });

    const result = await classify({
      lead: { message: 'need coaching soon' },
      business: { name: 'Sharma JEE Academy', industry: 'academy' },
    });

    expect(result.via).toBe('llm_fallback');
    expect(result.bestCategory).toBe('GENERAL_ENQUIRY');
    expect(result.priority).toBe('LOW');
  });
});
