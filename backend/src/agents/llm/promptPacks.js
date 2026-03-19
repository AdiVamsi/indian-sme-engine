'use strict';

const COMMON_DISPOSITIONS = ['valid', 'weak', 'wrong_fit', 'not_interested', 'junk', 'conflicting'];
const COMMON_LANGUAGE_MODES = ['english', 'hinglish', 'mixed', 'other'];
const COMMON_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
const COMMON_CONFIDENCE_LABELS = ['low', 'medium', 'high'];

const BASE_TAGS = ['URGENT', 'CALLBACK_REQUEST', 'WHATSAPP_REQUEST', 'FEES', 'TIMING_QUERY', 'GUARDIAN'];

function makePack({
  vertical,
  label,
  nicheRole,
  intents,
  tags,
  wrongFitExamples,
  junkExamples,
  priorityGuidance,
  nextActionGuidance,
}) {
  const allowedIntents = Array.from(new Set(['GENERAL_ENQUIRY', ...intents]));
  const allowedTags = Array.from(new Set([...allowedIntents, ...BASE_TAGS, ...tags]));

  return {
    key: `${vertical}_classifier_v1`,
    version: 'llm_classifier_v1',
    vertical,
    label,
    nicheRole,
    allowedIntents,
    allowedTags,
    allowedDispositions: COMMON_DISPOSITIONS,
    allowedLanguageModes: COMMON_LANGUAGE_MODES,
    allowedPriorities: COMMON_PRIORITIES,
    allowedConfidenceLabels: COMMON_CONFIDENCE_LABELS,
    safeIntent: 'GENERAL_ENQUIRY',
    wrongFitExamples,
    junkExamples,
    priorityGuidance,
    nextActionGuidance,
  };
}

const PROMPT_PACKS = {
  academy: makePack({
    vertical: 'academy',
    label: 'Academy / Coaching Center',
    nicheRole: [
      'ROLE: You are an AI lead-classification engine for a coaching institute, training center, or language academy.',
      'TASK: Analyze each message and classify the true business intent.',
      'Focus on the strongest enquiry intent, not unrelated chatter.',
      'Ignore irrelevant sentences if the message still contains a clear coaching enquiry.',
      'Treat coaching, admission, classes, course details, fees, batch timing, enrollment, IELTS, spoken English, PTE, and communication-training requests as valid lead intent.',
    ].join(' '),
    intents: [
      'ADMISSION',
      'DEMO_REQUEST',
      'FEE_ENQUIRY',
      'BATCH_TIMING',
      'SCHOLARSHIP_ENQUIRY',
      'WHATSAPP_REQUEST',
      'COURSE_INFO',
      'CALLBACK_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['COURSE_INFO', 'SCHOLARSHIP', 'ADMISSION', 'DEMO_REQUEST'],
    wrongFitExamples: [
      'NEET enquiry for a JEE-focused academy',
      'JEE or NEET enquiry for an IELTS or spoken-English institute',
      'Visa-consultancy request for a coaching-only institute',
      'IAS, dance, music, or unrelated coaching requests',
    ],
    junkExamples: [
      'sir bas checking',
      'timepass',
      'just wasting your time',
      'test only',
    ],
    priorityGuidance: [
      'Use both intent and urgency, but never let unrelated chatter override a real coaching enquiry.',
      'A valid coaching, admission, classes, course-detail, fee, batch, or enrollment enquiry must never be LOW.',
      'HIGH: valid admission or coaching intent plus today, tomorrow, urgent, immediately, or join now.',
      'NORMAL: valid coaching, admission, course, batch, or fee intent with future timeline like next month or soon.',
      'LOW: vague greeting, unclear message, unrelated conversation, wrong-fit, junk, or not interested.',
      'Use priorityScore 30-60 for HIGH, 10-29 for NORMAL, and 0-9 for LOW.',
      'Example: "My brother needs coaching soon" -> intent ADMISSION, priority NORMAL, tags [ADMISSION].',
      'Example: "I need coaching immediately" -> intent ADMISSION, priority HIGH, tags [ADMISSION, URGENT].',
      'Example: "fees kitni hai" -> intent FEE_ENQUIRY, priority NORMAL, tags [FEE_ENQUIRY].',
      'Example: "IELTS fees and weekend batch details chahiye" -> intent FEE_ENQUIRY, priority NORMAL, tags [FEE_ENQUIRY, COURSE_INFO].',
      'Example: "spoken english demo class chahiye" -> intent DEMO_REQUEST, priority NORMAL, tags [DEMO_REQUEST, COURSE_INFO].',
      'Example: "I dont need coaching" -> intent NOT_INTERESTED, priority LOW, tags [].',
      'Example: "My favourite food is mango but I need coaching next month" -> intent ADMISSION, priority NORMAL, tags [ADMISSION].',
      'Example: "My favourite food is mango. but i need coaching from next month, give me the details now" -> intent ADMISSION, priority NORMAL, tags [ADMISSION].',
    ],
    nextActionGuidance: [
      'Call within 15 minutes for HIGH.',
      'Share brochure, fees, or batch timing for NORMAL.',
      'Manual review or ignore for LOW.',
    ],
  }),
  clinic: makePack({
    vertical: 'clinic',
    label: 'Clinic',
    nicheRole: 'Classify inbound leads for an Indian clinic or healthcare practice.',
    intents: [
      'APPOINTMENT_REQUEST',
      'TREATMENT_ENQUIRY',
      'CONSULTATION_REQUEST',
      'FEES',
      'FOLLOW_UP',
      'URGENT_HEALTH_QUERY',
      'CALLBACK_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['APPOINTMENT_REQUEST', 'CONSULTATION_REQUEST', 'URGENT_HEALTH_QUERY', 'FOLLOW_UP'],
    wrongFitExamples: [
      'Beauty salon or gym membership requests',
      'School admission questions',
    ],
    junkExamples: ['just checking', 'wrong number', 'spam'],
    priorityGuidance: [
      'HIGH for urgent health concern, same-day appointment request, or immediate callback.',
      'NORMAL for treatment, consultation, fees, and follow-up queries without urgency.',
      'LOW for wrong-fit, junk, or not interested.',
    ],
    nextActionGuidance: [
      'Call immediately for urgent medical relevance.',
      'Offer appointment slots or fee details for standard enquiries.',
    ],
  }),
  gym: makePack({
    vertical: 'gym',
    label: 'Gym',
    nicheRole: 'Classify inbound leads for an Indian gym or fitness studio.',
    intents: [
      'MEMBERSHIP_ENQUIRY',
      'TRIAL_REQUEST',
      'TRAINER_INFO',
      'TIMING_QUERY',
      'FEES',
      'CALLBACK_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['MEMBERSHIP_ENQUIRY', 'TRIAL_REQUEST', 'TRAINER_INFO'],
    wrongFitExamples: ['Clinic appointment request', 'Salon bridal package enquiry'],
    junkExamples: ['checking only', 'spam', 'test'],
    priorityGuidance: [
      'HIGH for trial request, ready-to-join message, or urgent callback.',
      'NORMAL for membership, trainer info, timings, and fee questions.',
      'LOW for junk, wrong-fit, or not interested.',
    ],
    nextActionGuidance: [
      'Offer trial slot or membership call for HIGH.',
      'Share pricing and timings for NORMAL.',
    ],
  }),
  salon: makePack({
    vertical: 'salon',
    label: 'Salon',
    nicheRole: 'Classify inbound leads for an Indian salon or beauty studio.',
    intents: [
      'APPOINTMENT_REQUEST',
      'SERVICE_ENQUIRY',
      'PRICING',
      'BRIDAL_PACKAGE',
      'CALLBACK_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['APPOINTMENT_REQUEST', 'SERVICE_ENQUIRY', 'BRIDAL_PACKAGE', 'PRICING'],
    wrongFitExamples: ['Gym trainer request', 'Restaurant reservation'],
    junkExamples: ['just checking', 'spam', 'test'],
    priorityGuidance: [
      'HIGH for appointment booking, bridal package, or immediate callback.',
      'NORMAL for pricing and service enquiries.',
      'LOW for wrong-fit, junk, or not interested.',
    ],
    nextActionGuidance: [
      'Offer the nearest slot for HIGH.',
      'Share service menu and pricing for NORMAL.',
    ],
  }),
  restaurant: makePack({
    vertical: 'restaurant',
    label: 'Restaurant',
    nicheRole: 'Classify inbound leads for an Indian restaurant or cafe.',
    intents: [
      'RESERVATION_REQUEST',
      'CATERING_ENQUIRY',
      'MENU_QUERY',
      'EVENT_BOOKING',
      'CALLBACK_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['RESERVATION_REQUEST', 'CATERING_ENQUIRY', 'MENU_QUERY', 'EVENT_BOOKING'],
    wrongFitExamples: ['Clinic consultation', 'Retail stock enquiry'],
    junkExamples: ['checking only', 'test', 'spam'],
    priorityGuidance: [
      'HIGH for same-day reservation, event booking, or urgent callback.',
      'NORMAL for menu and catering questions.',
      'LOW for wrong-fit, junk, or not interested.',
    ],
    nextActionGuidance: [
      'Confirm table or event availability for HIGH.',
      'Share menu or catering details for NORMAL.',
    ],
  }),
  retail: makePack({
    vertical: 'retail',
    label: 'Retail',
    nicheRole: 'Classify inbound leads for an Indian retail shop or store.',
    intents: [
      'PRODUCT_ENQUIRY',
      'PRICE_CHECK',
      'STOCK_CHECK',
      'DELIVERY_QUERY',
      'CALLBACK_REQUEST',
      'WHATSAPP_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['PRODUCT_ENQUIRY', 'PRICE_CHECK', 'STOCK_CHECK', 'DELIVERY_QUERY'],
    wrongFitExamples: ['School admission enquiry', 'Medical consultation request'],
    junkExamples: ['just checking', 'test', 'spam'],
    priorityGuidance: [
      'HIGH for ready-to-buy, urgent stock need, or immediate callback.',
      'NORMAL for product, price, stock, and delivery questions.',
      'LOW for wrong-fit, junk, or not interested.',
    ],
    nextActionGuidance: [
      'Confirm stock or call quickly for HIGH.',
      'Share product, price, or delivery details for NORMAL.',
    ],
  }),
  other: makePack({
    vertical: 'other',
    label: 'Generic Business',
    nicheRole: 'Classify inbound leads for an Indian small business.',
    intents: [
      'PRODUCT_OR_SERVICE_ENQUIRY',
      'PRICE_QUERY',
      'APPOINTMENT_REQUEST',
      'CALLBACK_REQUEST',
      'WHATSAPP_REQUEST',
      'WRONG_FIT',
      'NOT_INTERESTED',
      'JUNK',
    ],
    tags: ['PRODUCT_OR_SERVICE_ENQUIRY', 'PRICE_QUERY', 'APPOINTMENT_REQUEST'],
    wrongFitExamples: ['Clearly unrelated business request', 'Spam or random text'],
    junkExamples: ['checking only', 'test', 'spam'],
    priorityGuidance: [
      'HIGH for strong buying intent, urgent appointment, or urgent callback.',
      'NORMAL for clear enquiry without urgency.',
      'LOW for wrong-fit, junk, or not interested.',
    ],
    nextActionGuidance: [
      'Call quickly for HIGH.',
      'Reply with core details for NORMAL.',
    ],
  }),
};

function getPromptPack(industry) {
  return PROMPT_PACKS[industry?.toLowerCase()] ?? PROMPT_PACKS.other;
}

module.exports = {
  COMMON_CONFIDENCE_LABELS,
  COMMON_DISPOSITIONS,
  COMMON_LANGUAGE_MODES,
  COMMON_PRIORITIES,
  getPromptPack,
  promptPacks: PROMPT_PACKS,
};
