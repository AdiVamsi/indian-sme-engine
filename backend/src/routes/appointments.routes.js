'use strict';

const { Router } = require('express');

const { create, list, updateStatus, remove } = require('../controllers/appointments.controller');

const router = Router();

router.post('/', create);
router.get('/', list);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);

module.exports = router;
