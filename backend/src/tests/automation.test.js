'use strict';

const { buildWhatsAppReplyPlan } = require('../services/automation.service');

describe('WhatsApp reply selection', () => {
  it('builds a fee enquiry reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      priorityScore: 15,
      suggestedNextAction: 'Share fee details',
    });

    expect(plan.reason).toBe('FEE_ENQUIRY');
    expect(plan.message).toContain('fee structure');
  });

  it('builds a demo request reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'DEMO_REQUEST',
      tags: ['DEMO_REQUEST', 'ADMISSION'],
      priorityScore: 35,
      suggestedNextAction: 'Send demo details',
    });

    expect(plan.reason).toBe('DEMO_REQUEST');
    expect(plan.message).toContain('demo class');
    expect(plan.message).toContain('next available slot');
  });

  it('builds an admission reply with a call hint when suggested', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'ADMISSION',
      tags: ['ADMISSION', 'URGENT'],
      priorityScore: 35,
      suggestedNextAction: 'Call within 15 minutes',
    });

    expect(plan.reason).toBe('ADMISSION');
    expect(plan.message).toContain('Admissions are open');
    expect(plan.message).toContain('call you shortly');
  });

  it('builds a scholarship enquiry reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'SCHOLARSHIP_ENQUIRY',
      tags: ['SCHOLARSHIP_ENQUIRY'],
      priorityScore: 20,
      suggestedNextAction: 'Share scholarship criteria',
    });

    expect(plan.reason).toBe('SCHOLARSHIP_ENQUIRY');
    expect(plan.message).toContain('scholarship options');
    expect(plan.message).toContain('recent marks');
  });

  it('builds a wrong-fit reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'WRONG_FIT',
      tags: ['WRONG_FIT'],
      priorityScore: 5,
      suggestedNextAction: 'Mark wrong fit',
    });

    expect(plan.reason).toBe('WRONG_FIT');
    expect(plan.message).toContain('focus on IIT-JEE coaching');
  });

  it('prioritizes the most actionable specific tag over admission', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'ADMISSION',
      tags: ['ADMISSION', 'FEE_ENQUIRY'],
      priorityScore: 25,
      suggestedNextAction: 'Share fee details',
    });

    expect(plan.reason).toBe('FEE_ENQUIRY');
    expect(plan.message).toContain('fee structure');
  });
});
