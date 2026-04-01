'use strict';

const crypto = require('crypto');

const { prisma } = require('../lib/prisma');
const { logger } = require('../lib/logger');
const { normalizePhoneNumber } = require('./messageNormalizer');

const GRAPH_API_BASE_URL = 'https://graph.facebook.com/v18.0';
const MAX_WHATSAPP_TEXT_LENGTH = 4096;
/*
 * Legacy demo fallbacks for pre-configured local/test showcase environments.
 * Normal tenant routing should come from Business.whatsAppPhoneNumberId /
 * Business.whatsAppDisplayPhoneNumber instead.
 */
const META_TEST_PHONE_NUMBER_ID_TO_SLUG = {
  '1000851389785357': 'sharma-jee-academy-delhi',
};
const META_TEST_DISPLAY_PHONE_TO_SLUG = {
  [normalizePhoneNumber('15556451322')]: 'sharma-jee-academy-delhi',
};
const META_TOKEN_ERROR_CODE = 190;

function getWhatsAppConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_ID,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET || null,
  };
}

function getBusinessRoutingDisplayPhone(business = {}) {
  return normalizePhoneNumber(
    business.whatsAppDisplayPhoneNumber || business.phone || null
  );
}

function toSelectedBusiness(business = {}) {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    phone: business.phone || null,
    industry: business.industry || null,
    whatsAppPhoneNumberId: business.whatsAppPhoneNumberId || null,
    whatsAppDisplayPhoneNumber: business.whatsAppDisplayPhoneNumber || null,
  };
}

async function getBusinessWhatsAppConfig(businessId) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      industry: true,
      whatsAppPhoneNumberId: true,
      whatsAppDisplayPhoneNumber: true,
    },
  });

  if (!business) return null;

  const globalConfig = getWhatsAppConfig();
  return {
    business: toSelectedBusiness(business),
    outbound: {
      token: globalConfig.token || null,
      phoneNumberId: business.whatsAppPhoneNumberId || globalConfig.phoneNumberId || null,
      senderSelection: business.whatsAppPhoneNumberId
        ? 'business_phone_number_id'
        : 'global_phone_number_id',
    },
    inboundRouting: {
      phoneNumberId: business.whatsAppPhoneNumberId || null,
      displayPhoneNumber: getBusinessRoutingDisplayPhone(business),
    },
  };
}

function verifyWhatsAppSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) {
    return { checked: false, valid: true, reason: 'app_secret_not_configured' };
  }

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return { checked: true, valid: false, reason: 'missing_raw_body' };
  }

  if (typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return { checked: true, valid: false, reason: 'missing_signature_header' };
  }

  const providedDigest = signatureHeader.slice('sha256='.length).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedDigest)) {
    return { checked: true, valid: false, reason: 'malformed_signature' };
  }

  const expectedDigest = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const providedBuffer = Buffer.from(providedDigest, 'hex');
  const expectedBuffer = Buffer.from(expectedDigest, 'hex');
  const valid = providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  return {
    checked: true,
    valid,
    reason: valid ? 'ok' : 'signature_mismatch',
  };
}

function createWhatsAppSendFailure({
  category = 'WHATSAPP_SEND_FAILED',
  title = 'WhatsApp reply failed',
  detail = 'The WhatsApp reply could not be sent. Review the Meta connection and follow up manually.',
  healthSeverity = 'warning',
  retryable = false,
  status = null,
  providerCode = null,
  providerSubcode = null,
  providerType = null,
  providerMessage = null,
  operatorActionRequired = null,
} = {}) {
  return {
    category,
    title,
    detail,
    healthSeverity,
    retryable,
    status,
    providerCode,
    providerSubcode,
    providerType,
    providerMessage,
    operatorActionRequired,
  };
}

function prepareWhatsAppTextMessage(message = '') {
  const normalized = String(message || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!normalized) {
    const err = new Error('WhatsApp reply message is empty after normalization');
    err.name = 'WhatsAppSendError';
    err.failureCategory = 'INVALID_WHATSAPP_MESSAGE';
    err.operatorTitle = 'WhatsApp reply could not be prepared';
    err.operatorDetail = 'The generated WhatsApp reply became empty after text normalization, so it was not sent.';
    err.healthSeverity = 'warning';
    err.retryable = false;
    err.operatorActionRequired = 'Review the generated reply text and follow up manually if the lead needs a response now.';
    throw err;
  }

  if (normalized.length <= MAX_WHATSAPP_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_WHATSAPP_TEXT_LENGTH - 1).trimEnd()}…`;
}

function classifyWhatsAppResponseFailure({ status = null, payload = {} } = {}) {
  const providerError = payload?.error || {};
  const providerMessage = String(providerError.message || '').trim() || null;
  const normalizedProviderMessage = String(providerMessage || '').toLowerCase();
  const providerCode = providerError.code ?? null;
  const providerSubcode = providerError.error_subcode ?? null;
  const providerType = providerError.type ?? null;

  const isTokenExpired = providerCode === META_TOKEN_ERROR_CODE
    || /access token.*expired|session has expired|error validating access token|invalid oauth access token/.test(normalizedProviderMessage);

  if (isTokenExpired) {
    return createWhatsAppSendFailure({
      category: 'META_TOKEN_EXPIRED',
      title: 'Meta access token expired',
      detail: 'Reconnect or refresh the Meta WhatsApp access token. Automated WhatsApp replies are not being delivered.',
      healthSeverity: 'critical',
      retryable: false,
      status,
      providerCode,
      providerSubcode,
      providerType,
      providerMessage,
      operatorActionRequired: 'Refresh the Meta access token and follow up with the lead manually until sending recovers.',
    });
  }

  if (status === 401 || status === 403) {
    return createWhatsAppSendFailure({
      category: 'META_AUTH_FAILED',
      title: 'Meta authentication failed',
      detail: 'Meta rejected the WhatsApp send request. Check the active access token and app permissions.',
      healthSeverity: 'critical',
      retryable: false,
      status,
      providerCode,
      providerSubcode,
      providerType,
      providerMessage,
      operatorActionRequired: 'Verify the Meta app credentials and refresh the access token before retrying outbound replies.',
    });
  }

  if (status === 429 || providerCode === 4 || providerCode === 80007) {
    return createWhatsAppSendFailure({
      category: 'META_RATE_LIMITED',
      title: 'Meta rate limited WhatsApp sending',
      detail: 'Meta temporarily rate limited outbound WhatsApp replies. Retry after the rate limit window resets.',
      healthSeverity: 'warning',
      retryable: true,
      status,
      providerCode,
      providerSubcode,
      providerType,
      providerMessage,
      operatorActionRequired: 'Retry the reply later and handle urgent leads manually in the meantime.',
    });
  }

  if (status === 400) {
    return createWhatsAppSendFailure({
      category: 'META_REQUEST_REJECTED',
      title: 'Meta rejected the WhatsApp reply',
      detail: providerMessage
        ? `Meta rejected the outbound WhatsApp reply: ${providerMessage}`
        : 'Meta rejected the outbound WhatsApp reply payload.',
      healthSeverity: 'warning',
      retryable: false,
      status,
      providerCode,
      providerSubcode,
      providerType,
      providerMessage,
      operatorActionRequired: 'Review the Meta error details, fix the outbound payload or WhatsApp configuration, and retry the reply manually if needed.',
    });
  }

  if (status >= 500) {
    return createWhatsAppSendFailure({
      category: 'META_PROVIDER_UNAVAILABLE',
      title: 'Meta WhatsApp API is unavailable',
      detail: 'Meta returned a server-side failure while sending the WhatsApp reply.',
      healthSeverity: 'warning',
      retryable: true,
      status,
      providerCode,
      providerSubcode,
      providerType,
      providerMessage,
      operatorActionRequired: 'Retry the reply later or follow up manually if the lead is time-sensitive.',
    });
  }

  return createWhatsAppSendFailure({
    category: 'WHATSAPP_SEND_FAILED',
    title: 'WhatsApp reply failed',
    detail: 'Meta did not accept the outbound WhatsApp reply. Review the provider error details and follow up manually if needed.',
    healthSeverity: 'warning',
    retryable: false,
    status,
    providerCode,
    providerSubcode,
    providerType,
    providerMessage,
    operatorActionRequired: 'Check the Meta error details and retry the reply after fixing the issue.',
  });
}

function normalizeWhatsAppSendError(err) {
  if (err?.failureCategory && err?.operatorTitle) {
    return createWhatsAppSendFailure({
      category: err.failureCategory,
      title: err.operatorTitle,
      detail: err.operatorDetail,
      healthSeverity: err.healthSeverity,
      retryable: Boolean(err.retryable),
      status: err.status ?? null,
      providerCode: err.providerCode ?? null,
      providerSubcode: err.providerSubcode ?? null,
      providerType: err.providerType ?? null,
      providerMessage: err.providerMessage ?? err.message ?? null,
      operatorActionRequired: err.operatorActionRequired ?? null,
    });
  }

  if (err?.message === 'WhatsApp API credentials are not configured') {
    return createWhatsAppSendFailure({
      category: 'WHATSAPP_NOT_CONFIGURED',
      title: 'WhatsApp sending is not configured',
      detail: 'The WhatsApp token or phone number ID is missing. Automated replies cannot be sent until configuration is fixed.',
      healthSeverity: 'critical',
      retryable: false,
      operatorActionRequired: 'Set the WhatsApp API token and phone number ID, then retry the follow-up manually.',
    });
  }

  if (err?.message === 'Invalid WhatsApp recipient phone number') {
    return createWhatsAppSendFailure({
      category: 'INVALID_WHATSAPP_RECIPIENT',
      title: 'WhatsApp recipient number is invalid',
      detail: 'The lead phone number could not be normalized for a WhatsApp send attempt.',
      healthSeverity: 'warning',
      retryable: false,
      operatorActionRequired: 'Fix the lead phone number and retry the reply manually.',
    });
  }

  return createWhatsAppSendFailure({
    category: 'WHATSAPP_SEND_FAILED',
    title: 'WhatsApp reply failed',
    detail: 'The outbound WhatsApp request did not complete successfully.',
    healthSeverity: 'warning',
    retryable: false,
    providerMessage: err?.message || null,
    operatorActionRequired: 'Review the server logs and follow up manually if the lead needs a response now.',
  });
}

function extractIncomingMessages(payload = {}) {
  const extracted = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const metadata = value.metadata || {};

      for (const message of messages) {
        const text =
          message?.text?.body
          || message?.button?.text
          || message?.interactive?.button_reply?.title
          || message?.interactive?.list_reply?.title
          || '';

        if (!text.trim()) continue;

        const contact = contacts.find((candidate) => candidate.wa_id === message.from) || contacts[0] || {};
        extracted.push({
          senderPhone: normalizePhoneNumber(message.from),
          senderName: contact?.profile?.name || 'WhatsApp User',
          message: text.trim(),
          timestamp: message.timestamp,
          messageId: message.id,
          displayPhoneNumber: metadata.display_phone_number,
          phoneNumberId: metadata.phone_number_id,
        });
      }
    }
  }

  return extracted;
}

async function findBusinessForWhatsAppInbound({ displayPhoneNumber, phoneNumberId } = {}, log = logger) {
  const normalizedDestination = normalizePhoneNumber(displayPhoneNumber);

  if (phoneNumberId) {
    const businessesByPhoneNumberId = await prisma.business.findMany({
      where: { whatsAppPhoneNumberId: phoneNumberId },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        industry: true,
        whatsAppPhoneNumberId: true,
        whatsAppDisplayPhoneNumber: true,
      },
    });

    if (businessesByPhoneNumberId.length === 1) {
      const matchedBusiness = toSelectedBusiness(businessesByPhoneNumberId[0]);
      log.info(
        {
          phoneNumberId,
          slug: matchedBusiness.slug,
          businessId: matchedBusiness.id,
        },
        'WhatsApp tenant matched by configured business phoneNumberId'
      );
      return matchedBusiness;
    }

    if (businessesByPhoneNumberId.length > 1) {
      log.warn(
        { phoneNumberId, businessIds: businessesByPhoneNumberId.map((business) => business.id) },
        'WhatsApp tenant resolution failed: multiple businesses share the same configured phoneNumberId'
      );
      return null;
    }
  }

  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      industry: true,
      whatsAppPhoneNumberId: true,
      whatsAppDisplayPhoneNumber: true,
    },
  });

  if (normalizedDestination) {
    const explicitDisplayMatches = businesses.filter((business) =>
      normalizePhoneNumber(business.whatsAppDisplayPhoneNumber) === normalizedDestination
    );
    if (explicitDisplayMatches.length === 1) {
      const matchedBusiness = toSelectedBusiness(explicitDisplayMatches[0]);
      log.info(
        {
          displayPhoneNumber: normalizedDestination,
          slug: matchedBusiness.slug,
          businessId: matchedBusiness.id,
        },
        'WhatsApp tenant matched by configured business display phone'
      );
      return matchedBusiness;
    }

    if (explicitDisplayMatches.length > 1) {
      log.warn(
        {
          displayPhoneNumber: normalizedDestination,
          businessIds: explicitDisplayMatches.map((business) => business.id),
        },
        'WhatsApp tenant resolution failed: multiple businesses share the same configured display phone'
      );
      return null;
    }

    const fallbackPhoneMatches = businesses.filter((business) =>
      normalizePhoneNumber(business.phone) === normalizedDestination
    );
    if (fallbackPhoneMatches.length === 1) {
      const matchedBusiness = toSelectedBusiness(fallbackPhoneMatches[0]);
      log.info(
        {
          displayPhoneNumber: normalizedDestination,
          slug: matchedBusiness.slug,
          businessId: matchedBusiness.id,
        },
        'WhatsApp tenant matched by fallback business phone lookup'
      );
      return matchedBusiness;
    }

    if (fallbackPhoneMatches.length > 1) {
      log.warn(
        {
          displayPhoneNumber: normalizedDestination,
          businessIds: fallbackPhoneMatches.map((business) => business.id),
        },
        'WhatsApp tenant resolution failed: multiple businesses share the same fallback business phone'
      );
      return null;
    }
  } else {
    log.warn({ displayPhoneNumber, phoneNumberId }, 'WhatsApp tenant resolution did not receive a usable destination phone');
  }

  const mappedSlugByPhoneNumberId = phoneNumberId ? META_TEST_PHONE_NUMBER_ID_TO_SLUG[phoneNumberId] : null;
  if (mappedSlugByPhoneNumberId) {
    const mappedBusiness = await prisma.business.findUnique({
      where: { slug: mappedSlugByPhoneNumberId },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        industry: true,
        whatsAppPhoneNumberId: true,
        whatsAppDisplayPhoneNumber: true,
      },
    });

    if (mappedBusiness) {
      const selectedBusiness = toSelectedBusiness(mappedBusiness);
      log.info(
        {
          phoneNumberId,
          slug: selectedBusiness.slug,
          businessId: selectedBusiness.id,
        },
        'WhatsApp tenant matched by legacy test phoneNumberId mapping'
      );
      return selectedBusiness;
    }

    log.warn(
      { phoneNumberId, slug: mappedSlugByPhoneNumberId },
      'WhatsApp legacy phoneNumberId mapping matched a slug, but the business is missing'
    );
  }

  const mappedSlugByDisplayPhone = META_TEST_DISPLAY_PHONE_TO_SLUG[normalizedDestination];
  if (mappedSlugByDisplayPhone) {
    const mappedBusiness = await prisma.business.findUnique({
      where: { slug: mappedSlugByDisplayPhone },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        industry: true,
        whatsAppPhoneNumberId: true,
        whatsAppDisplayPhoneNumber: true,
      },
    });

    if (mappedBusiness) {
      const selectedBusiness = toSelectedBusiness(mappedBusiness);
      log.info(
        {
          displayPhoneNumber: normalizedDestination,
          slug: selectedBusiness.slug,
          businessId: selectedBusiness.id,
        },
        'WhatsApp tenant matched by legacy test display phone mapping'
      );
      return selectedBusiness;
    }

    log.warn(
      { displayPhoneNumber: normalizedDestination, slug: mappedSlugByDisplayPhone },
      'WhatsApp legacy display phone mapping matched a slug, but the business is missing'
    );
  }

  log.warn(
    { displayPhoneNumber: normalizedDestination, phoneNumberId },
    'WhatsApp tenant resolution failed'
  );
  return null;
}

async function sendWhatsAppMessage({ businessId = null, phone, message }) {
  const businessConfig = businessId ? await getBusinessWhatsAppConfig(businessId) : null;
  const { token, phoneNumberId, senderSelection } = businessConfig?.outbound || {
    token: getWhatsAppConfig().token,
    phoneNumberId: getWhatsAppConfig().phoneNumberId,
    senderSelection: 'global_phone_number_id',
  };

  if (!token || !phoneNumberId) {
    throw new Error('WhatsApp API credentials are not configured');
  }

  const to = normalizePhoneNumber(phone, { withPlus: false });
  if (!to) {
    throw new Error('Invalid WhatsApp recipient phone number');
  }

  const preparedMessage = prepareWhatsAppTextMessage(message);

  const response = await fetch(`${GRAPH_API_BASE_URL}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: preparedMessage },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = classifyWhatsAppResponseFailure({
      status: response.status,
      payload,
    });

    logger.error(
      {
        status: response.status,
        failureCategory: failure.category,
        failureTitle: failure.title,
        providerCode: failure.providerCode,
        providerSubcode: failure.providerSubcode,
        providerType: failure.providerType,
        payload,
      },
      'WhatsApp API request failed'
    );

    const err = new Error(failure.providerMessage || `WhatsApp API error ${response.status}`);
    err.name = 'WhatsAppSendError';
    err.failureCategory = failure.category;
    err.operatorTitle = failure.title;
    err.operatorDetail = failure.detail;
    err.healthSeverity = failure.healthSeverity;
    err.retryable = failure.retryable;
    err.status = failure.status;
    err.providerCode = failure.providerCode;
    err.providerSubcode = failure.providerSubcode;
    err.providerType = failure.providerType;
    err.providerMessage = failure.providerMessage;
    err.operatorActionRequired = failure.operatorActionRequired;
    throw err;
  }

  return {
    payload,
    phoneNumberId,
    senderSelection,
  };
}

module.exports = {
  classifyWhatsAppResponseFailure,
  extractIncomingMessages,
  findBusinessForWhatsAppInbound,
  getBusinessWhatsAppConfig,
  getWhatsAppConfig,
  normalizeWhatsAppSendError,
  prepareWhatsAppTextMessage,
  sendWhatsAppMessage,
  verifyWhatsAppSignature,
};
