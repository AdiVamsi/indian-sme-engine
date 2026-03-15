'use strict';

const { getAgentConfigPreset } = require('../constants/agentConfig.presets');

const DEFAULT_REQUIRED_FIELDS_BY_INTENT = {
  ADMISSION: ['studentClass'],
  DEMO_REQUEST: ['studentClass'],
  FEE_ENQUIRY: ['studentClass'],
  SCHOLARSHIP_ENQUIRY: ['recentMarks'],
  CALLBACK_REQUEST: ['studentClass', 'preferredCallTime'],
  GENERAL_ENQUIRY: ['studentClass', 'topic'],
};

const DEFAULT_HANDOFF_WORDING = {
  genericHighPriority: 'Thank you for your enquiry. Our {{institutionLabel}} will contact you shortly.',
  lowConfidence: 'Thank you. Our {{institutionLabel}} will continue with you on WhatsApp shortly.',
  inProgress: 'Thank you. Our {{institutionLabel}} will continue with you on WhatsApp shortly.',
  offFlow: 'Thank you. Our {{institutionLabel}} will continue with you on WhatsApp shortly.',
};

const DEFAULT_CONFIG_BY_INDUSTRY = {
  academy: {
    institutionLabel: 'counsellor',
    primaryOffering: 'IIT-JEE coaching',
    supportedOfferings: [
      'fee details',
      'demo class',
      'admission guidance',
    ],
    wrongFitCategories: [
      'NEET coaching',
      'IAS preparation',
      'dance coaching',
    ],
    preferredLanguage: 'english',
    requiredCollectedFields: DEFAULT_REQUIRED_FIELDS_BY_INTENT,
    handoffWording: DEFAULT_HANDOFF_WORDING,
  },
  other: {
    institutionLabel: 'team',
    primaryOffering: 'our services',
    supportedOfferings: [],
    wrongFitCategories: [],
    preferredLanguage: 'english',
    requiredCollectedFields: DEFAULT_REQUIRED_FIELDS_BY_INTENT,
    handoffWording: DEFAULT_HANDOFF_WORDING,
  },
};

function dedupeStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRequiredCollectedFields(raw = {}, fallback = DEFAULT_REQUIRED_FIELDS_BY_INTENT) {
  const keys = new Set([
    ...Object.keys(fallback || {}),
    ...Object.keys(raw || {}),
  ]);

  const normalized = {};
  for (const key of keys) {
    const source = raw?.[key];
    const fallbackValue = fallback?.[key] || [];
    normalized[key] = Array.isArray(source)
      ? dedupeStrings(source)
      : dedupeStrings(fallbackValue);
  }

  return normalized;
}

function mergeReplyConfig(base = {}, override = {}) {
  return {
    ...base,
    ...override,
    supportedOfferings: override.supportedOfferings !== undefined
      ? dedupeStrings(override.supportedOfferings)
      : dedupeStrings(base.supportedOfferings),
    wrongFitCategories: override.wrongFitCategories !== undefined
      ? dedupeStrings(override.wrongFitCategories)
      : dedupeStrings(base.wrongFitCategories),
    requiredCollectedFields: normalizeRequiredCollectedFields(
      override.requiredCollectedFields,
      base.requiredCollectedFields
    ),
    handoffWording: {
      ...(base.handoffWording || {}),
      ...(override.handoffWording || {}),
    },
  };
}

function resolveWhatsAppReplyConfig({ businessIndustry = 'other', agentConfig = null } = {}) {
  const industry = businessIndustry || 'other';
  const preset = getAgentConfigPreset(industry);
  const presetReplyConfig = preset?.classificationRules?.whatsappReplyConfig || {};
  const base = DEFAULT_CONFIG_BY_INDUSTRY[industry] || DEFAULT_CONFIG_BY_INDUSTRY.other;
  const resolved = mergeReplyConfig(base, presetReplyConfig);
  const businessOverride = agentConfig?.classificationRules?.whatsappReplyConfig || {};

  return {
    ...mergeReplyConfig(resolved, businessOverride),
    toneStyle: agentConfig?.toneStyle || preset?.toneStyle || 'professional',
  };
}

function getRequiredCollectedFields(replyConfig = {}, intent = '') {
  const normalizedIntent = String(intent || '').trim().toUpperCase();
  return replyConfig?.requiredCollectedFields?.[normalizedIntent] || [];
}

module.exports = {
  getRequiredCollectedFields,
  resolveWhatsAppReplyConfig,
};
