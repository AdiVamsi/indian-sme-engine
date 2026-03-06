'use strict';

const { Router } = require('express');
const { authenticateSuperAdmin } = require('../middleware/superadmin.middleware');
const ctrl = require('../controllers/superadmin.controller');

const router = Router();

/* Public */
router.post('/login', ctrl.login);

/* Protected — SUPERADMIN token required */
router.get  ('/overview',                   authenticateSuperAdmin, ctrl.overview);
router.get  ('/businesses',                 authenticateSuperAdmin, ctrl.businesses);
router.patch('/businesses/:id/stage',       authenticateSuperAdmin, ctrl.updateBusinessStage);
router.get  ('/leads',                      authenticateSuperAdmin, ctrl.leads);
router.get  ('/logs',                       authenticateSuperAdmin, ctrl.logs);

module.exports = router;
