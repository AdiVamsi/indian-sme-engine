'use strict';

const { Router } = require('express');

const { create, list, updateStatus, remove, activity } = require('../controllers/leads.controller');

const router = Router();

router.post('/', create);
router.get('/', list);
router.get('/:id/activity', activity);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);

module.exports = router;
