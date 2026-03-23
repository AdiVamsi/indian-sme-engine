'use strict';

const LEGACY_SAFE_LEAD_SELECT = {
  id: true,
  businessId: true,
  name: true,
  phone: true,
  email: true,
  message: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

function isMissingLeadSnoozedUntilColumnError(err) {
  const message = String(err?.message || '');
  return message.includes('Lead.snoozedUntil') || message.includes('column "snoozedUntil" does not exist');
}

module.exports = {
  LEGACY_SAFE_LEAD_SELECT,
  isMissingLeadSnoozedUntilColumnError,
};
