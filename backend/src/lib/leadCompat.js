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
  const metaText = [
    err?.meta?.column,
    err?.meta?.field_name,
    Array.isArray(err?.meta?.target) ? err.meta.target.join(' ') : err?.meta?.target,
  ]
    .filter(Boolean)
    .join(' ');
  const haystack = `${message} ${metaText}`.toLowerCase();

  if (!haystack.includes('snoozeduntil')) return false;

  return (
    err?.code === 'P2022'
    || haystack.includes('lead.snoozeduntil')
    || haystack.includes('column "snoozeduntil" does not exist')
    || haystack.includes("column 'lead.snoozeduntil' does not exist")
    || haystack.includes('does not exist in the current database')
  );
}

module.exports = {
  LEGACY_SAFE_LEAD_SELECT,
  isMissingLeadSnoozedUntilColumnError,
};
