'use strict';

/**
 * agentConfig.presets.js — Industry-specific AgentConfig presets.
 *
 * Used by activation.controller.js on first-run setup.
 * Each preset's testMessage is derived from the preset's own keywords,
 * guaranteeing at least two tag matches on the demo lead.
 *
 * Shape mirrors AgentConfig exactly (minus id/businessId/createdAt).
 */

const PRESETS = {
  academy: {
    toneStyle: 'professional',
    followUpMinutes: 30,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        DEMO_REQUEST: ['demo', 'demo class', 'trial class'],
        ADMISSION:    ['admission', 'enroll', 'join', 'admission open'],
        FEE_ENQUIRY:  ['fee', 'fees', 'price', 'cost', 'charges'],
        CALL_REQUEST: ['call me', 'phone call', 'callback'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, immediately: 25, today: 20,
        admission: 25, demo: 20, fee: 10, fees: 10,
      },
    },
    /* 'admission' → ADMISSION, 'fee' → FEE_ENQUIRY */
    testMessage: 'I want admission details and fee information',
  },

  gym: {
    toneStyle: 'professional',
    followUpMinutes: 30,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        TRIAL_REQUEST: ['trial', 'trial session', 'free trial'],
        MEMBERSHIP:    ['membership', 'join', 'enroll'],
        FEE_ENQUIRY:   ['fee', 'fees', 'price', 'cost', 'charges'],
        TIMING_QUERY:  ['timing', 'timings', 'schedule', 'hours', 'batch'],
        CALL_REQUEST:  ['call me', 'callback', 'phone call'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, immediately: 25, today: 20,
        trial: 20, membership: 15, fee: 10,
      },
    },
    /* 'trial', 'trial session' → TRIAL_REQUEST (score 2); 'membership' → MEMBERSHIP */
    testMessage: 'Looking for a trial session and membership details',
  },

  salon: {
    toneStyle: 'professional',
    followUpMinutes: 30,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        APPOINTMENT:    ['appointment', 'book', 'booking', 'slot'],
        PRICING:        ['price', 'cost', 'charges', 'rate', 'fees'],
        LOCATION_QUERY: ['location', 'address', 'where', 'directions'],
        CALL_REQUEST:   ['call me', 'callback', 'phone call'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, immediately: 25, today: 20,
        appointment: 20, bridal: 20, book: 15, price: 10,
      },
    },
    /* 'book', 'appointment' → APPOINTMENT (score 2) */
    testMessage: 'I want to book an appointment this weekend',
  },

  clinic: {
    toneStyle: 'professional',
    followUpMinutes: 15,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        APPOINTMENT:  ['appointment', 'book', 'consult', 'consultation', 'visit'],
        EMERGENCY:    ['urgent', 'emergency', 'immediately', 'asap'],
        FEE_ENQUIRY:  ['fee', 'fees', 'charges', 'cost'],
        CALL_REQUEST: ['call me', 'callback', 'phone call'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, emergency: 40, immediately: 30, today: 20,
        appointment: 15, consultation: 15,
      },
    },
    /* 'book', 'consultation' → APPOINTMENT (score 2); 'call me' → CALL_REQUEST */
    testMessage: 'Need to book a consultation, please call me',
  },

  restaurant: {
    toneStyle: 'professional',
    followUpMinutes: 20,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        RESERVATION:    ['reservation', 'reserve', 'book', 'table', 'booking'],
        CATERING:       ['catering', 'event', 'party', 'bulk', 'corporate'],
        MENU_ENQUIRY:   ['menu', 'food', 'veg', 'non-veg', 'cuisine'],
        LOCATION_QUERY: ['location', 'address', 'where', 'directions'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, immediately: 25, today: 20,
        reservation: 20, event: 25, catering: 25,
      },
    },
    /* 'book', 'table' → RESERVATION (score 2) */
    testMessage: 'Want to book a table for 4 this Saturday',
  },

  retail: {
    toneStyle: 'professional',
    followUpMinutes: 30,
    autoReplyEnabled: false,
    classificationRules: {
      keywords: {
        PRODUCT_ENQUIRY: ['product', 'item', 'stock', 'do you have'],
        PRICING:         ['price', 'cost', 'charges', 'rate'],
        AVAILABILITY:    ['available', 'in stock', 'availability'],
        LOCATION_QUERY:  ['location', 'address', 'store', 'shop', 'where'],
      },
    },
    priorityRules: {
      weights: {
        urgent: 30, immediately: 25, today: 20,
        order: 20, buy: 20, price: 10,
      },
    },
    /* 'product', 'do you have' → PRODUCT_ENQUIRY (score 2); 'price' → PRICING */
    testMessage: 'Do you have this product and what is the price?',
  },
};

/* Fallback for 'other' and any unrecognised industry */
const FALLBACK_PRESET = {
  toneStyle: 'professional',
  followUpMinutes: 30,
  autoReplyEnabled: false,
  classificationRules: {
    keywords: {
      DEMO_REQUEST:    ['demo', 'trial'],
      GENERAL_ENQUIRY: ['info', 'details', 'information', 'more'],
      FEE_ENQUIRY:     ['fee', 'fees', 'price', 'cost'],
      CALL_REQUEST:    ['call me', 'callback', 'phone call'],
    },
  },
  priorityRules: {
    weights: {
      urgent: 30, immediately: 25, today: 20,
      demo: 15, fee: 10, price: 10,
    },
  },
  /* 'information', 'more', 'details' → GENERAL_ENQUIRY (score 3); 'fee' → FEE_ENQUIRY */
  testMessage: 'I need more information about your services and fee details',
};

/**
 * Returns the AgentConfig-shaped preset for the given industry
 * (strips the testMessage field).
 */
function getAgentConfigPreset(industry) {
  const preset = PRESETS[industry] ?? FALLBACK_PRESET;
  const { testMessage: _discarded, ...config } = preset;
  return config;
}

/** Returns the pre-filled test message for the given industry. */
function getTestMessage(industry) {
  return (PRESETS[industry] ?? FALLBACK_PRESET).testMessage;
}

module.exports = { getAgentConfigPreset, getTestMessage };
