'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { getConfig, updateConfig } = require('../controllers/agentConfig.controller');

const router = Router();

router.get('/',  authenticate, getConfig);
router.put('/',  authenticate, updateConfig);

module.exports = router;
