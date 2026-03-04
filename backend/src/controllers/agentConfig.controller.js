'use strict';

const { getOrCreate, update } = require('../services/agentConfig.service');

/* ─── Validation helpers ─────────────────────────────────────────────────── */

/**
 * isValidClassificationRules
 * Accepts: { keywords: { TAG_NAME: ["kw", ...], ... } }
 */
function isValidClassificationRules(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!v.keywords || typeof v.keywords !== 'object' || Array.isArray(v.keywords)) return false;
  return Object.values(v.keywords).every(
    (arr) => Array.isArray(arr) && arr.every((kw) => typeof kw === 'string')
  );
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
    const config = await getOrCreate(req.user.businessId);
    return res.json({
      toneStyle:           config.toneStyle,
      followUpMinutes:     config.followUpMinutes,
      classificationRules: config.classificationRules,
      priorityRules:       config.priorityRules,
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
    errors.push('classificationRules must be { keywords: { TAG: ["kw", ...] } }');
  }

  /* Validate priorityRules */
  if (priorityRules !== undefined && !isValidPriorityRules(priorityRules)) {
    errors.push('priorityRules must be { weights: { keyword: number } }');
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  try {
    const config = await update(req.user.businessId, {
      followUpMinutes:     followUpMinutes !== undefined ? Number(followUpMinutes) : undefined,
      classificationRules: classificationRules ?? undefined,
      priorityRules:       priorityRules       ?? undefined,
    });

    return res.json({
      ok:                  true,
      toneStyle:           config.toneStyle,
      followUpMinutes:     config.followUpMinutes,
      classificationRules: config.classificationRules,
      priorityRules:       config.priorityRules,
    });
  } catch (err) {
    console.error('[AgentConfig] PUT failed:', err.message);
    return res.status(500).json({ error: 'Failed to update agent config' });
  }
};

module.exports = { getConfig, updateConfig };
