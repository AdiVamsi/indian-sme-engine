'use strict';

const {
  buildWhatsAppReplyPlan,
  buildAcademyContinuationPlan,
  maybeBuildGroundedKnowledgeReplyPlan,
} = require('../services/automation.service');

describe('WhatsApp academy reply selection', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_CLASSIFIER_PROVIDER;
    delete process.env.LLM_CLASSIFIER_MODEL;
  });

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

  it('answers direct business identity questions before falling back to handoff', () => {
    const plan = buildWhatsAppReplyPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      message: 'Hello. is this a gym ?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      priorityScore: 10,
    });

    expect(plan.reason).toBe('DIRECT_BUSINESS_CLARIFICATION');
    expect(plan.message).toContain('Sharma JEE Academy');
    expect(plan.message).toContain('IIT-JEE coaching');
    expect(plan.message).toContain('do not provide gym services');
    expect(plan.message).not.toContain('will continue with you on WhatsApp shortly');
  });

  it('answers direct offering clarification questions before asking for more details', () => {
    const plan = buildWhatsAppReplyPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      message: 'Do you provide JEE coaching?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      priorityScore: 10,
    });

    expect(plan.reason).toBe('DIRECT_BUSINESS_CLARIFICATION');
    expect(plan.message).toContain('Yes, this is Sharma JEE Academy.');
    expect(plan.message).toContain('We provide IIT-JEE coaching.');
    expect(plan.message).not.toContain('Please share the student\'s class');
  });

  it('answers wrong-business fee questions directly instead of using generic handoff wording', () => {
    const plan = buildWhatsAppReplyPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      message: 'tell me something about the gym fee',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      priorityScore: 10,
    });

    expect(plan.reason).toBe('DIRECT_BUSINESS_CLARIFICATION');
    expect(plan.message).toContain('Sharma JEE Academy');
    expect(plan.message).toContain('IIT-JEE coaching');
    expect(plan.message).toContain('do not provide gym services');
    expect(plan.message).not.toContain('will continue with you on WhatsApp shortly');
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

  it('supports course-interest collection for academy businesses that do not use student class', () => {
    const plan = buildWhatsAppReplyPlan({
      businessIndustry: 'academy',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      priorityScore: 20,
      agentConfig: {
        classificationRules: {
          whatsappReplyConfig: {
            institutionLabel: 'counsellor',
            primaryOffering: 'IELTS and spoken English coaching',
            supportedOfferings: ['IELTS batch details', 'spoken English programme', 'PTE support'],
            requiredCollectedFields: {
              FEE_ENQUIRY: ['courseInterest'],
            },
          },
        },
      },
    });

    expect(plan.reason).toBe('FEE_ENQUIRY');
    expect(plan.message).toContain('course or programme');
    expect(plan.message).toContain('IELTS batch details');
    expect(plan.conversationState.pendingField).toBe('course_interest');
  });

  it('builds a grounded business-knowledge answer when a confident FAQ match exists', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LLM_CLASSIFIER_PROVIDER = 'openai';
    process.env.LLM_CLASSIFIER_MODEL = 'gpt-4o-mini';

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                grounded: true,
                confidence: 0.91,
                reply: 'Certainly. Classroom programmes start from INR 78,000 per year depending on class and batch.',
                usedEntryIds: ['fees_overview'],
                reason: 'Used the stored fee overview entry.',
              }),
            },
          },
        ],
      }),
    }));

    const plan = await maybeBuildGroundedKnowledgeReplyPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      message: 'fees kitni hai?',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      agentConfig: {
        classificationRules: {
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                id: 'fees_overview',
                title: 'Fee structure',
                category: 'fees',
                intents: ['FEE_ENQUIRY', 'GENERAL_ENQUIRY'],
                keywords: ['fee', 'fees', 'fee structure'],
                content: 'Classroom programmes start from INR 78,000 per year depending on class and batch.',
              },
            ],
          },
        },
      },
    });

    expect(plan.reason).toBe('BUSINESS_KNOWLEDGE_ANSWER');
    expect(plan.message).toContain('INR 78,000');
    expect(plan.groundedAnswer).toBe(true);
    expect(plan.knowledgeRetrieval.sourceIds).toContain('fees_overview');
    expect(plan.conversationState.pendingField).toBe('knowledge_follow_up');
  });

  it('falls back to safe human handoff when a factual question is not confidently grounded', async () => {
    const plan = await maybeBuildGroundedKnowledgeReplyPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      message: 'Where exactly is your hostel campus?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      agentConfig: {
        classificationRules: {
          businessKnowledge: {
            enabled: true,
            entries: [
              {
                id: 'fees_overview',
                title: 'Fee structure',
                category: 'fees',
                intents: ['FEE_ENQUIRY'],
                keywords: ['fee', 'fees'],
                content: 'Classroom programmes start from INR 78,000 per year depending on class and batch.',
              },
            ],
          },
        },
      },
    });

    expect(plan.reason).toBe('BUSINESS_KNOWLEDGE_UNCERTAIN');
    expect(plan.groundedAnswer).toBe(false);
    expect(plan.conversationState.status).toBe('handoff');
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

  it('answers direct business clarification during handoff instead of generic in-progress wording', () => {
    const plan = buildAcademyContinuationPlan({
      businessName: 'Sharma JEE Academy',
      businessIndustry: 'academy',
      conversationState: {
        flowIntent: 'ADMISSION',
        pendingField: null,
        collected: { studentClass: 'Class 11' },
        status: 'handoff',
      },
      message: 'Hello. is this a gym ?',
      priorityScore: 35,
      replyConfig: {
        primaryOffering: 'IIT-JEE coaching',
      },
    });

    expect(plan.reason).toBe('DIRECT_BUSINESS_CLARIFICATION');
    expect(plan.message).toContain('Sharma JEE Academy');
    expect(plan.message).toContain('IIT-JEE coaching');
    expect(plan.message).toContain('do not provide gym services');
    expect(plan.message).not.toContain('will continue with you on WhatsApp shortly');
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

  it('handles course-interest follow-up replies for non-school academy businesses', () => {
    const plan = buildAcademyContinuationPlan({
      conversationState: {
        flowIntent: 'FEE_ENQUIRY',
        pendingField: 'course_interest',
        collected: {},
        status: 'awaiting_user',
      },
      message: 'IELTS',
      priorityScore: 20,
      replyConfig: {
        institutionLabel: 'counsellor',
      },
    });

    expect(plan.reason).toBe('FEE_ENQUIRY_HANDOFF');
    expect(plan.message).toContain('For IELTS');
    expect(plan.message).toContain('fee details and batch timings');
    expect(plan.conversationState.collected.courseInterest).toBe('IELTS');
    expect(plan.conversationState.status).toBe('handoff');
  });
});
