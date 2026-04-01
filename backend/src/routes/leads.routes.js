'use strict';

const { Router } = require('express');

const { create, list, updateStatus, runAction, remove, activity } = require('../controllers/leads.controller');
const { createForLead: createLeadAppointment } = require('../controllers/appointments.controller');

const router = Router();

router.post('/', create);
router.get('/', list);
router.get('/:id/activity', activity);
router.post('/:id/appointments', createLeadAppointment);
router.post('/:id/actions', runAction);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);

module.exports = router;
