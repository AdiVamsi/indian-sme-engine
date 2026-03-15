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
    expect(plan.message).toContain('Please share the student\'s class');
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
    expect(plan.message).toContain('right demo class');
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
    expect(plan.message).toContain('Please share the student\'s class');
  });

  it('builds a callback request first reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'CALLBACK_REQUEST',
      tags: ['CALLBACK_REQUEST', 'GENERAL_ENQUIRY'],
      priorityScore: 20,
    });

    expect(plan.reason).toBe('CALLBACK_REQUEST');
    expect(plan.message).toContain('preferred call time');
    expect(plan.message).toContain('Please share the student\'s class');
    expect(plan.conversationState.pendingField).toBe('callback_details');
  });

  it('builds a general enquiry first reply', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      priorityScore: 20,
    });

    expect(plan.reason).toBe('GENERAL_ENQUIRY');
    expect(plan.message).toContain('Please share the student\'s class');
    expect(plan.message).toContain('fee details');
    expect(plan.message).toContain('admission guidance');
    expect(plan.conversationState.pendingField).toBe('general_enquiry_details');
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
    expect(plan.message).toContain('fee details and batch timings');
  });

  it('uses business reply config to change offerings, language support, and collected fields', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      priorityScore: 20,
      agentConfig: {
        toneStyle: 'professional',
        classificationRules: {
          whatsappReplyConfig: {
            institutionLabel: 'admissions team',
            supportedOfferings: ['foundation batch details', 'hostel guidance', 'admission counselling'],
            preferredLanguage: 'english_hindi_friendly',
            requiredCollectedFields: {
              GENERAL_ENQUIRY: ['topic'],
            },
          },
        },
      },
    });

    expect(plan.reason).toBe('GENERAL_ENQUIRY');
    expect(plan.message).toContain('foundation batch details, hostel guidance, and admission counselling');
    expect(plan.message).toContain('our admissions team will guide you further');
    expect(plan.message).toContain('Hindi as well');
    expect(plan.conversationState.pendingField).toBe('general_enquiry_details');
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
    expect(plan.message).toContain('connect with you shortly');
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

  it('handles a callback request follow-up with class and call time', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'CALLBACK_REQUEST',
        pendingField: 'callback_details',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'Class 10, please call after 6 pm',
      priorityScore: 20,
    });

    expect(plan.reason).toBe('CALLBACK_REQUEST_HANDOFF');
    expect(plan.message).toContain('regarding Class 10');
    expect(plan.message).toContain('after 6 pm');
    expect(plan.conversationState.collected.studentClass).toBe('Class 10');
    expect(plan.conversationState.collected.preferredCallTime).toBe('after 6 pm');
  });

  it('handles a general enquiry follow-up by routing to the requested topic', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'GENERAL_ENQUIRY',
        pendingField: 'general_enquiry_details',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'Class 11 fees details chahiye',
      priorityScore: 20,
    });

    expect(plan.reason).toBe('GENERAL_ENQUIRY_HANDOFF');
    expect(plan.message).toContain('fee details');
    expect(plan.message).toContain('Class 11');
    expect(plan.conversationState.flowIntent).toBe('FEE_ENQUIRY');
    expect(plan.conversationState.collected.studentClass).toBe('Class 11');
    expect(plan.conversationState.collected.topic).toBe('FEE_ENQUIRY');
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

  it('uses business reply config to change institution labels and handoff wording', () => {
    const inProgressPlan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'ADMISSION',
        pendingField: null,
        collected: { studentClass: 'Class 11' },
        status: 'handoff',
      },
      message: 'following up',
      priorityScore: 35,
      replyConfig: {
        institutionLabel: 'admissions team',
        handoffWording: {
          inProgress: 'Thank you. Our {{institutionLabel}} will take this forward shortly.',
        },
      },
    });

    expect(inProgressPlan.reason).toBe('HANDOFF_IN_PROGRESS');
    expect(inProgressPlan.message).toBe('Thank you. Our admissions team will take this forward shortly.');

    const callbackPlan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'CALLBACK_REQUEST',
        pendingField: 'callback_details',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'Please call around 7 pm',
      priorityScore: 20,
      replyConfig: {
        institutionLabel: 'admissions team',
      },
    });

    expect(callbackPlan.reason).toBe('CALLBACK_REQUEST_HANDOFF');
    expect(callbackPlan.message).toContain('our admissions team will call you');
    expect(callbackPlan.message).toContain('7 pm');
  });
});
