'use strict';

const {
  KNOWLEDGE_CATEGORIES,
  SUPPORTED_KNOWLEDGE_INTENTS,
  normalizeBusinessKnowledgeConfig,
} = require('../services/businessKnowledge.service');
const { previewBusinessKnowledgeAnswer } = require('../services/businessKnowledgePreview.service');
const { getResolved, update } = require('../services/agentConfig.service');

const WHATSAPP_REPLY_INTENTS = new Set([
  'ADMISSION',
  'DEMO_REQUEST',
  'FEE_ENQUIRY',
  'SCHOLARSHIP_ENQUIRY',
  'CALLBACK_REQUEST',
  'GENERAL_ENQUIRY',
]);

const WHATSAPP_REQUIRED_FIELDS = new Set([
  'studentClass',
  'courseInterest',
  'preferredCallTime',
  'recentMarks',
  'topic',
]);

const WHATSAPP_HANDOFF_KEYS = new Set([
  'genericHighPriority',
  'lowConfidence',
  'inProgress',
  'offFlow',
]);

function isValidBusinessKnowledge(v) {
  if (v === null) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return false;
  if (v.entries === undefined) return true;
  if (!Array.isArray(v.entries)) return false;

  const seenIds = new Set();
  return v.entries.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;

    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') return false;

    const stringKeys = ['id', 'title', 'category', 'content', 'answer', 'question', 'sourceLabel'];
    if (!stringKeys.every((key) => entry[key] === undefined || typeof entry[key] === 'string')) {
      return false;
    }

    const title = String(entry.title || entry.question || '').trim();
    const category = String(entry.category || '').trim();
    const content = String(entry.content || entry.answer || '').trim();
    const entryId = String(entry.id || '').trim();
    const sourceLabel = String(entry.sourceLabel || '').trim();

    if (!title || !category || !content) return false;
    if (!KNOWLEDGE_CATEGORIES.includes(category)) return false;
    if (title.length > 120 || content.length > 1200 || entryId.length > 120 || sourceLabel.length > 160) {
      return false;
    }

    if (entryId) {
      if (seenIds.has(entryId)) return false;
      seenIds.add(entryId);
    }

    if (
      entry.intents !== undefined
      && (
        !Array.isArray(entry.intents)
        || entry.intents.some((value) => !SUPPORTED_KNOWLEDGE_INTENTS.has(String(value || '').trim().toUpperCase()))
      )
    ) {
      return false;
    }

    const listKeys = ['intents', 'keywords'];
    if (!listKeys.every((key) =>
      entry[key] === undefined
      || (Array.isArray(entry[key]) && entry[key].every((value) => typeof value === 'string'))
    )) {
      return false;
    }

    if (Array.isArray(entry.keywords) && entry.keywords.some((value) => !String(value || '').trim())) {
      return false;
    }

    return true;
  });
}

/* ─── Validation helpers ─────────────────────────────────────────────────── */

/**
 * isValidClassificationRules
 * Accepts: { keywords: { TAG_NAME: ["kw", ...], ... } }
 */
function isValidClassificationRules(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!v.keywords || typeof v.keywords !== 'object' || Array.isArray(v.keywords)) return false;
  const keywordsOk = Object.values(v.keywords).every(
    (arr) => Array.isArray(arr) && arr.every((kw) => typeof kw === 'string')
  );
  if (!keywordsOk) return false;

  const replyConfig = v.whatsappReplyConfig;
  if (replyConfig === undefined) return true;
  if (!replyConfig || typeof replyConfig !== 'object' || Array.isArray(replyConfig)) return false;

  const stringKeys = ['institutionLabel', 'primaryOffering', 'preferredLanguage'];
  if (!stringKeys.every((key) => replyConfig[key] === undefined || typeof replyConfig[key] === 'string')) {
    return false;
  }

  const listKeys = ['supportedOfferings', 'wrongFitCategories'];
  if (!listKeys.every((key) =>
    replyConfig[key] === undefined
    || (Array.isArray(replyConfig[key]) && replyConfig[key].every((value) => typeof value === 'string'))
  )) {
    return false;
  }

  if (replyConfig.requiredCollectedFields !== undefined) {
    const fields = replyConfig.requiredCollectedFields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false;
    if (!Object.keys(fields).every((intent) => WHATSAPP_REPLY_INTENTS.has(intent))) return false;
    if (!Object.values(fields).every((value) =>
      Array.isArray(value) && value.every((fieldName) => WHATSAPP_REQUIRED_FIELDS.has(fieldName))
    )) {
      return false;
    }
  }

  if (replyConfig.handoffWording !== undefined) {
    const wording = replyConfig.handoffWording;
    if (!wording || typeof wording !== 'object' || Array.isArray(wording)) return false;
    if (!Object.keys(wording).every((key) => WHATSAPP_HANDOFF_KEYS.has(key))) return false;
    if (!Object.values(wording).every((value) => typeof value === 'string')) return false;
  }

  if (v.businessKnowledge !== undefined && !isValidBusinessKnowledge(v.businessKnowledge)) {
    return false;
  }

  return true;
}

/**
 * isValidPriorityRules
 * Accepts: { weights: { keyword: number, ... } }
 */
function isValidPriorityRules(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!v.weights || typeof v.weights !== 'object' || Array.isArray(v.weights)) return false;
  return Object.values(v.weights).every((w) => typeof w === 'number' && isFinite(w));
}

/* ─── Handlers ───────────────────────────────────────────────────────────── */

/**
 * GET /api/agent/config
 * Returns the AgentConfig for the authenticated business.
 * Creates one with defaults if none exists.
 */
const getConfig = async (req, res) => {
  try {
    const {
      config,
      industry,
      whatsappReplyConfig,
      whatsappReplyPreset,
      businessKnowledgeConfig,
      businessKnowledgePreset,
      businessKnowledgeUsesPreset,
    } = await getResolved(req.user.businessId);
    return res.json({
      toneStyle:           config.toneStyle,
      followUpMinutes:     config.followUpMinutes,
      classificationRules: config.classificationRules,
      priorityRules:       config.priorityRules,
      industry,
      whatsappReplyConfig,
      whatsappReplyPreset,
      businessKnowledgeConfig,
      businessKnowledgePreset,
      businessKnowledgeUsesPreset,
    });
  } catch (err) {
    console.error('[AgentConfig] GET failed:', err.message);
    return res.status(500).json({ error: 'Failed to fetch agent config' });
  }
};

/**
 * POST /api/agent/knowledge-preview
 * Runs a dry business-knowledge preview for the authenticated business.
 * Does not create leads, activities, or outbound messages.
 */
const previewKnowledge = async (req, res) => {
  const { message, businessKnowledge } = req.body || {};

  if (typeof message !== 'string' || !message.trim() || message.trim().length > 500) {
    return res.status(400).json({ error: 'message must be a non-empty string up to 500 characters' });
  }

  if (businessKnowledge !== undefined && !isValidBusinessKnowledge(businessKnowledge)) {
    return res.status(400).json({ error: 'businessKnowledge must be a valid knowledge config, null, or undefined' });
  }

  try {
    const {
      config,
      industry,
      businessName,
    } = await getResolved(req.user.businessId);

    const previewAgentConfig = {
      ...config,
      classificationRules: {
        ...(config.classificationRules || {}),
      },
    };

    if (businessKnowledge === null) {
      delete previewAgentConfig.classificationRules.businessKnowledge;
    } else if (businessKnowledge !== undefined) {
      previewAgentConfig.classificationRules.businessKnowledge = normalizeBusinessKnowledgeConfig(businessKnowledge);
    }

    const preview = await previewBusinessKnowledgeAnswer({
      businessName,
      businessIndustry: industry,
      agentConfig: previewAgentConfig,
      message,
    });

    return res.json(preview);
  } catch (err) {
    console.error('[AgentConfig] POST knowledge preview failed:', err.message);
    return res.status(500).json({ error: 'Failed to preview business knowledge' });
  }
};

/**
 * PUT /api/agent/config
 * Updates followUpMinutes, classificationRules, priorityRules.
 * Validates structure before writing. Rejects malformed payloads with 400.
 */
const updateConfig = async (req, res) => {
  const { followUpMinutes, classificationRules, priorityRules } = req.body;
  const errors = [];

  /* Validate followUpMinutes */
  if (followUpMinutes !== undefined) {
    const mins = Number(followUpMinutes);
    if (!Number.isInteger(mins) || mins < 1 || mins > 1440) {
      errors.push('followUpMinutes must be an integer between 1 and 1440');
    }
  }

  /* Validate classificationRules */
  if (classificationRules !== undefined && !isValidClassificationRules(classificationRules)) {
    errors.push('classificationRules must be { keywords: { TAG: ["kw", ...] }, whatsappReplyConfig?: valid config, businessKnowledge?: valid knowledge config }');
  }

  /* Validate priorityRules */
  if (priorityRules !== undefined && !isValidPriorityRules(priorityRules)) {
    errors.push('priorityRules must be { weights: { keyword: number } }');
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  try {
    await update(req.user.businessId, {
      followUpMinutes:     followUpMinutes !== undefined ? Number(followUpMinutes) : undefined,
      classificationRules: classificationRules ?? undefined,
      priorityRules:       priorityRules       ?? undefined,
    });
    const {
      config,
      industry,
      whatsappReplyConfig,
      whatsappReplyPreset,
      businessKnowledgeConfig,
      businessKnowledgePreset,
      businessKnowledgeUsesPreset,
    } = await getResolved(req.user.businessId);

    return res.json({
      ok:                  true,
      toneStyle:           config.toneStyle,
      followUpMinutes:     config.followUpMinutes,
      classificationRules: config.classificationRules,
      priorityRules:       config.priorityRules,
      industry,
      whatsappReplyConfig,
      whatsappReplyPreset,
      businessKnowledgeConfig,
      businessKnowledgePreset,
      businessKnowledgeUsesPreset,
    });
  } catch (err) {
    console.error('[AgentConfig] PUT failed:', err.message);
    return res.status(500).json({ error: 'Failed to update agent config' });
  }
};

module.exports = { getConfig, previewKnowledge, updateConfig };
