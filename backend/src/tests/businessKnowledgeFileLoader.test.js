'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  buildAgentConfigFromBusinessKnowledgeFiles,
  loadBusinessKnowledgeFileBundle,
  mergeBusinessKnowledgeIntoAgentConfig,
} = require('../services/businessKnowledgeFileLoader.service');
const { retrieveBusinessKnowledge } = require('../services/businessKnowledge.service');

describe('Business knowledge file loader', () => {
  let tempRoot = null;

  afterEach(async () => {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('loads and compiles the Aarohan sample files into the existing businessKnowledge shape', async () => {
    const bundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'aarohan-jee-academy-delhi',
    });

    expect(bundle.business).toEqual(expect.objectContaining({
      name: 'Aarohan JEE Academy',
      slug: 'aarohan-jee-academy-delhi',
      area: 'Pitampura',
    }));
    expect(bundle.fileNames).toEqual([
      'business-profile.json',
      'courses-and-batches.json',
      'fees-and-payment.json',
      'admissions-and-demo.json',
      'scholarship-and-policies.json',
      'locations-and-timings.json',
      'faqs.json',
    ]);
    expect(bundle.knowledge).toEqual(expect.objectContaining({
      enabled: true,
      entries: expect.any(Array),
    }));
    expect(bundle.entryCount).toBe(23);
    expect(bundle.knowledge.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'class_11_fee_range',
        category: 'fees',
        sourceLabel: 'Aarohan JEE Academy fees and payment',
      }),
      expect.objectContaining({
        id: 'pitampura_branch_location',
        category: 'branch_location',
      }),
      expect.objectContaining({
        id: 'online_classes_availability',
        category: 'online_classes',
      }),
    ]));
  });

  it('loads and compiles the Lexicon IELTS sample files into the existing businessKnowledge shape', async () => {
    const bundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'lexicon-ielts-spoken-english-gurugram',
    });

    expect(bundle.business).toEqual(expect.objectContaining({
      name: 'Lexicon IELTS & Spoken English Institute',
      slug: 'lexicon-ielts-spoken-english-gurugram',
      area: 'Sector 14',
    }));
    expect(bundle.fileNames).toEqual([
      'business-profile.json',
      'courses-and-batches.json',
      'fees-and-payment.json',
      'admissions-and-demo.json',
      'scholarship-and-policies.json',
      'locations-and-timings.json',
      'faqs.json',
    ]);
    expect(bundle.entryCount).toBe(23);
    expect(bundle.knowledge.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ielts_regular_fee_range',
        category: 'fees',
        sourceLabel: 'Lexicon IELTS and Spoken English Institute fees and payment',
      }),
      expect.objectContaining({
        id: 'spoken_english_fluency_programme',
        category: 'courses',
      }),
      expect.objectContaining({
        id: 'online_classes_availability',
        category: 'online_classes',
      }),
    ]));
  });

  it('auto-generates ids for file entries that omit them', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'business-knowledge-loader-'));
    const folder = path.join(tempRoot, 'temp-academy');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'business-profile.json'), JSON.stringify({
      sourceLabel: 'Temp file',
      entries: [
        {
          title: 'Language support',
          category: 'general',
          intents: ['GENERAL_ENQUIRY'],
          keywords: ['hindi', 'english'],
          content: 'Hindi and English support is available.',
        },
      ],
    }, null, 2));

    const bundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'temp-academy',
      rootDir: tempRoot,
    });

    expect(bundle.knowledge.entries).toHaveLength(1);
    expect(bundle.knowledge.entries[0].id).toBe('general_language_support');
  });

  it('rejects invalid file data with clear validation errors', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'business-knowledge-loader-'));
    const folder = path.join(tempRoot, 'broken-academy');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'business-profile.json'), JSON.stringify({
      entries: [
        {
          title: 'Broken entry',
          category: 'unknown_category',
          intents: ['GENERAL_ENQUIRY'],
          keywords: ['broken'],
          content: 'This entry should fail.',
        },
      ],
    }, null, 2));

    await expect(loadBusinessKnowledgeFileBundle({
      businessSlug: 'broken-academy',
      rootDir: tempRoot,
    })).rejects.toThrow('unsupported "category"');
  });

  it('merges file-loaded business knowledge into agent config without touching unrelated config', async () => {
    const baseConfig = {
      toneStyle: 'professional',
      followUpMinutes: 45,
      autoReplyEnabled: false,
      classificationRules: {
        keywords: {
          ADMISSION: ['admission', 'join'],
        },
        whatsappReplyConfig: {
          institutionLabel: 'counsellor',
          primaryOffering: 'IIT-JEE coaching',
        },
      },
      priorityRules: {
        weights: {
          urgent: 30,
        },
      },
    };

    const { agentConfig, knowledgeBundle } = await buildAgentConfigFromBusinessKnowledgeFiles({
      businessSlug: 'aarohan-jee-academy-delhi',
      industry: 'academy',
      baseConfig,
    });

    expect(baseConfig.classificationRules.businessKnowledge).toBeUndefined();
    expect(agentConfig.followUpMinutes).toBe(45);
    expect(agentConfig.priorityRules).toEqual(baseConfig.priorityRules);
    expect(agentConfig.classificationRules.keywords).toEqual(baseConfig.classificationRules.keywords);
    expect(agentConfig.classificationRules.whatsappReplyConfig).toEqual(baseConfig.classificationRules.whatsappReplyConfig);
    expect(agentConfig.classificationRules.businessKnowledge.entries).toHaveLength(knowledgeBundle.entryCount);
  });

  it('keeps retrieval compatible with file-loaded entries for fee, language, and callback questions', async () => {
    const bundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'aarohan-jee-academy-delhi',
    });
    const agentConfig = mergeBusinessKnowledgeIntoAgentConfig({
      classificationRules: {},
    }, bundle.knowledge);

    const feeResult = retrieveBusinessKnowledge({
      message: 'fees kitni hai for class 11?',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig,
    });

    const languageResult = retrieveBusinessKnowledge({
      message: 'Hindi mein samjha sakte ho?',
      intent: 'GENERAL_ENQUIRY',
      tags: ['GENERAL_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig,
    });

    const callbackResult = retrieveBusinessKnowledge({
      message: 'call kar sakte ho?',
      intent: 'CALLBACK_REQUEST',
      tags: ['CALLBACK_REQUEST'],
      businessIndustry: 'academy',
      agentConfig,
    });

    expect(feeResult.hasConfidentMatch).toBe(true);
    expect(feeResult.topMatch.id).toBe('class_11_fee_range');
    expect(languageResult.hasConfidentMatch).toBe(true);
    expect(languageResult.topMatch.id).toBe('language_support');
    expect(callbackResult.hasConfidentMatch).toBe(true);
    expect(['callback_support', 'contact_and_whatsapp_support']).toContain(callbackResult.topMatch.id);
  });

  it('keeps retrieval compatible with the Lexicon IELTS sample for fee, timing, and policy questions', async () => {
    const bundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'lexicon-ielts-spoken-english-gurugram',
    });
    const agentConfig = mergeBusinessKnowledgeIntoAgentConfig({
      classificationRules: {},
    }, bundle.knowledge);

    const feeResult = retrieveBusinessKnowledge({
      message: 'IELTS fees kitni hai?',
      intent: 'FEE_ENQUIRY',
      tags: ['FEE_ENQUIRY'],
      businessIndustry: 'academy',
      agentConfig,
    });

    const timingResult = retrieveBusinessKnowledge({
      message: 'weekend batch timing kya hai?',
      intent: 'BATCH_TIMING',
      tags: ['BATCH_TIMING'],
      businessIndustry: 'academy',
      agentConfig,
    });

    const policyResult = retrieveBusinessKnowledge({
      message: 'IELTS band score guarantee hai kya?',
      intent: 'COURSE_INFO',
      tags: ['COURSE_INFO'],
      businessIndustry: 'academy',
      agentConfig,
    });

    expect(feeResult.hasConfidentMatch).toBe(true);
    expect(feeResult.topMatch.id).toBe('ielts_regular_fee_range');
    expect(timingResult.hasConfidentMatch).toBe(true);
    expect(timingResult.topMatch.id).toBe('weekday_and_weekend_timings');
    expect(policyResult.hasConfidentMatch).toBe(true);
    expect(policyResult.topMatch.id).toBe('no_band_score_guarantee');
  });

  it('shows different grounded matches across the JEE and IELTS sample businesses', async () => {
    const aarohanBundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'aarohan-jee-academy-delhi',
    });
    const lexiconBundle = await loadBusinessKnowledgeFileBundle({
      businessSlug: 'lexicon-ielts-spoken-english-gurugram',
    });

    const aarohanAgentConfig = mergeBusinessKnowledgeIntoAgentConfig({
      classificationRules: {},
    }, aarohanBundle.knowledge);
    const lexiconAgentConfig = mergeBusinessKnowledgeIntoAgentConfig({
      classificationRules: {},
    }, lexiconBundle.knowledge);

    const spokenEnglishForLexicon = retrieveBusinessKnowledge({
      message: 'spoken english course hai kya?',
      intent: 'COURSE_INFO',
      tags: ['COURSE_INFO'],
      businessIndustry: 'academy',
      agentConfig: lexiconAgentConfig,
    });

    const spokenEnglishForAarohan = retrieveBusinessKnowledge({
      message: 'spoken english course hai kya?',
      intent: 'COURSE_INFO',
      tags: ['COURSE_INFO'],
      businessIndustry: 'academy',
      agentConfig: aarohanAgentConfig,
    });

    const jeeForLexicon = retrieveBusinessKnowledge({
      message: 'jee course hai kya?',
      intent: 'COURSE_INFO',
      tags: ['COURSE_INFO'],
      businessIndustry: 'academy',
      agentConfig: lexiconAgentConfig,
    });

    expect(spokenEnglishForLexicon.hasConfidentMatch).toBe(true);
    expect(spokenEnglishForLexicon.topMatch.id).toBe('spoken_english_fluency_programme');
    expect(spokenEnglishForAarohan.hasConfidentMatch).toBe(true);
    expect(spokenEnglishForAarohan.topMatch.id).toBe('non_jee_scope_clarification');
    expect(jeeForLexicon.hasConfidentMatch).toBe(true);
    expect(jeeForLexicon.topMatch.id).toBe('entrance_exam_scope_boundary');
  });
});
