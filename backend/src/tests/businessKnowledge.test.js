'use strict';

const {
  resolveBusinessKnowledge,
  retrieveBusinessKnowledge,
} = require('../services/businessKnowledge.service');

describe('Business knowledge retrieval', () => {
  const agentConfig = {
    classificationRules: {
      businessKnowledge: {
        enabled: true,
        entries: [
          {
            id: 'fees_overview',
            title: 'Fee structure',
            category: 'fees',
            intents: ['FEE_ENQUIRY', 'GENERAL_ENQUIRY'],
            keywords: ['fee', 'fees', 'fee structure', 'cost'],
            content: 'Programmes start from INR 78,000 per year depending on class and batch.',
          },
          {
            id: 'branch_location',
            title: 'Branch location',
            category: 'location',
            intents: ['GENERAL_ENQUIRY'],
            keywords: ['branch', 'location', 'address', 'where'],
            content: 'The branch is in Connaught Place, New Delhi.',
          },
          {
            id: 'online_classes',
            title: 'Online classes',
            category: 'delivery',
            intents: ['GENERAL_ENQUIRY'],
            keywords: ['online classes', 'online coaching', 'live class', 'online'],
            content: 'Online support and live learning options are available depending on the programme and class.',
          },
        ],
      },
    },
  };

  it('resolves business-scoped knowledge entries from AgentConfig', () => {
    const knowledge = resolveBusinessKnowledge({
      businessIndustry: 'academy',
      agentConfig,
    });

    expect(knowledge.enabled).toBe(true);
    expect(knowledge.entries).toHaveLength(3);
    expect(knowledge.entries[0].id).toBe('fees_overview');
  });

  it('retrieves the most relevant fee answer for a fee question', () => {
    const result = retrieveBusinessKnowledge({
      message: 'fees kitni hai for class 11 batch?',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig,
    });

    expect(result.shouldAttempt).toBe(true);
    expect(result.hasConfidentMatch).toBe(true);
    expect(result.topMatch.id).toBe('fees_overview');
  });

  it('stays inactive when business knowledge is disabled', () => {
    const result = retrieveBusinessKnowledge({
      message: 'where is your branch?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig: {
        classificationRules: {
          businessKnowledge: {
            enabled: false,
            entries: agentConfig.classificationRules.businessKnowledge.entries,
          },
        },
      },
    });

    expect(result.shouldAttempt).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('retrieves online-class information for common academy delivery questions', () => {
    const result = retrieveBusinessKnowledge({
      message: 'Do you have online classes for JEE students?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig,
    });

    expect(result.shouldAttempt).toBe(true);
    expect(result.hasConfidentMatch).toBe(true);
    expect(result.topMatch.id).toBe('online_classes');
  });
});
