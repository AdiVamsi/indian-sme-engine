'use strict';

const {
  buildWhatsAppReplyPlan,
  buildAcademyContinuationPlan,
} = require('../services/automation.service');

describe('WhatsApp academy reply selection', () => {
  it('builds a fee enquiry first reply with a single follow-up question', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      priorityScore: 15,
    });

    expect(plan.reason).toBe('FEE_ENQUIRY');
    expect(plan.message).toContain('which class is the student in?');
    expect(plan.conversationState.pendingField).toBe('student_class');
    expect(plan.conversationState.status).toBe('awaiting_user');
  });

  it('builds a demo request first reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'DEMO_REQUEST',
      tags: ['DEMO_REQUEST', 'ADMISSION'],
      priorityScore: 35,
    });

    expect(plan.reason).toBe('DEMO_REQUEST');
    expect(plan.message).toContain('right demo batch');
    expect(plan.conversationState.pendingField).toBe('student_class');
  });

  it('builds an admission first reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'ADMISSION',
      tags: ['ADMISSION', 'URGENT'],
      priorityScore: 35,
    });

    expect(plan.reason).toBe('ADMISSION');
    expect(plan.message).toContain('Admissions are open');
    expect(plan.message).toContain('Which class is the student in?');
  });

  it('builds a scholarship enquiry first reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'SCHOLARSHIP_ENQUIRY',
      tags: ['SCHOLARSHIP_ENQUIRY'],
      priorityScore: 20,
    });

    expect(plan.reason).toBe('SCHOLARSHIP_ENQUIRY');
    expect(plan.message).toContain('recent marks or percentage');
    expect(plan.conversationState.pendingField).toBe('recent_marks');
  });

  it('builds a wrong-fit reply without opening a conversation state', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'WRONG_FIT',
      tags: ['WRONG_FIT'],
      priorityScore: 5,
    });

    expect(plan.reason).toBe('WRONG_FIT');
    expect(plan.message).toContain('focus on IIT-JEE coaching');
    expect(plan.conversationState.status).toBe('closed');
  });

  it('prioritizes the most actionable specific tag over admission', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'ADMISSION',
      tags: ['ADMISSION', 'FEE_ENQUIRY'],
      priorityScore: 25,
    });

    expect(plan.reason).toBe('FEE_ENQUIRY');
    expect(plan.message).toContain('fee structure');
  });
});

describe('WhatsApp academy continuation planning', () => {
  it('handles an admission follow-up with student class and queues handoff', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'ADMISSION',
        pendingField: 'student_class',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'Class 11',
      priorityScore: 35,
    });

    expect(plan.reason).toBe('ADMISSION_HANDOFF');
    expect(plan.message).toContain('For Class 11');
    expect(plan.conversationState.status).toBe('handoff');
    expect(plan.conversationState.collected.studentClass).toBe('Class 11');
  });

  it('handles a scholarship follow-up with marks', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'SCHOLARSHIP_ENQUIRY',
        pendingField: 'recent_marks',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'He scored 88%',
      priorityScore: 20,
    });

    expect(plan.reason).toBe('SCHOLARSHIP_ENQUIRY_HANDOFF');
    expect(plan.message).toContain('88%');
    expect(plan.conversationState.collected.recentMarks).toBe('88%');
  });

  it('routes off-flow follow-up replies to human handoff', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'FEE_ENQUIRY',
        pendingField: 'student_class',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'Where is your branch located?',
      priorityScore: 15,
    });

    expect(plan.reason).toBe('OFF_FLOW_HANDOFF');
    expect(plan.conversationState.status).toBe('handoff');
  });
});
