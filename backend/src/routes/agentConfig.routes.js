'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const {
  getConfig,
  previewKnowledge,
  updateConfig,
} = require('../controllers/agentConfig.controller');

const router = Router();

router.get('/',  authenticate, getConfig);
router.post('/knowledge-preview', authenticate, previewKnowledge);
router.put('/',  authenticate, updateConfig);

module.exports = router;
