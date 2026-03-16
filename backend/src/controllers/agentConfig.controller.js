'use strict';

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
    } = await getResolved(req.user.businessId);
    return res.json({
      toneStyle:           config.toneStyle,
      followUpMinutes:     config.followUpMinutes,
      classificationRules: config.classificationRules,
      priorityRules:       config.priorityRules,
      industry,
      whatsappReplyConfig,
      whatsappReplyPreset,
    });
  } catch (err) {
    console.error('[AgentConfig] GET failed:', err.message);
    return res.status(500).json({ error: 'Failed to fetch agent config' });
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
    errors.push('classificationRules must be { keywords: { TAG: ["kw", ...] }, whatsappReplyConfig?: valid config }');
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
    });
  } catch (err) {
    console.error('[AgentConfig] PUT failed:', err.message);
    return res.status(500).json({ error: 'Failed to update agent config' });
  }
};

module.exports = { getConfig, updateConfig };
