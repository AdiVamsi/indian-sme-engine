'use strict';

/*
  industry.config.js — single source of truth for all industry-specific copy,
  stat labels, notification text, and mood theme name.

  Keys must match Business.industry values stored in the DB:
    gym | academy | salon | restaurant | clinic | retail | other (fallback)

  Nothing here is hardcoded in the frontend; the whole object (minus the
  internal `_notifText` key) is returned via GET /api/admin/config and
  GET /api/admin/business.
*/

const INDUSTRY = {
  gym: {
    mood:     'gym',           /* CSS body[data-mood] selector */
    label:    'Gym / Fitness',
    statCards: [
      { key: 'totalLeads',           label: 'Total Members'   },
      { key: 'newLeads',             label: 'New Enquiries'   },
      { key: 'totalAppointments',    label: 'Sessions Booked' },
      { key: 'upcomingAppointments', label: 'Upcoming Sessions'},
      { key: 'totalServices',        label: 'Programmes'      },
      { key: 'totalTestimonials',    label: 'Reviews'         },
    ],
    tableColumns: {
      leads:        ['Member Name', 'Phone', 'Email', 'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Member',      'Phone', 'Session Time',    'Status', 'Notes'],
      services:     ['Programme',   'Description',              'Fee (₹)', 'Added'],
      testimonials: ['Member',      'Review',                   'Rating',  'Added'],
    },
    notifText: {
      newLead: 'New membership enquiry',
    },
  },

  academy: {
    mood:     'academy',
    label:    'Coaching / Academy',
    statCards: [
      { key: 'totalLeads',           label: 'Total Students'   },
      { key: 'newLeads',             label: 'New Enquiries'    },
      { key: 'totalAppointments',    label: 'Demo Classes'     },
      { key: 'upcomingAppointments', label: 'Upcoming Demos'   },
      { key: 'totalServices',        label: 'Courses'          },
      { key: 'totalTestimonials',    label: 'Student Reviews'  },
    ],
    tableColumns: {
      leads:        ['Student Name', 'Phone', 'Email',          'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Student',      'Phone', 'Demo Scheduled', 'Status', 'Notes'],
      services:     ['Course',       'Description',             'Fee (₹)', 'Added'],
      testimonials: ['Student',      'Feedback',                'Rating',  'Added'],
    },
    notifText: {
      newLead: 'New admission enquiry',
    },
    formCopy: {
      industryLabel: 'Coaching Centre',
      sub:           'Our academic counsellor will call you within 24 hours.',
      placeholder:   'e.g. JEE Advanced batch for Class 12, what are the timings and fees?',
      submitLabel:   'Request a Callback',
      successSub:    'will call you within 24 hours.',
      callStep:      'Our counsellor calls you within 24 hours',
    },
  },

  salon: {
    mood:     'salon',
    label:    'Salon / Beauty',
    statCards: [
      { key: 'totalLeads',           label: 'Total Clients'   },
      { key: 'newLeads',             label: 'New Enquiries'   },
      { key: 'totalAppointments',    label: 'Bookings'        },
      { key: 'upcomingAppointments', label: 'Today\'s Bookings'},
      { key: 'totalServices',        label: 'Services'        },
      { key: 'totalTestimonials',    label: 'Reviews'         },
    ],
    tableColumns: {
      leads:        ['Client Name', 'Phone', 'Email',       'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Client',      'Phone', 'Appointment', 'Status', 'Notes'],
      services:     ['Service',     'Description',          'Price (₹)', 'Added'],
      testimonials: ['Client',      'Review',               'Rating',    'Added'],
    },
    notifText: {
      newLead: 'New booking enquiry',
    },
  },

  restaurant: {
    mood:     'restaurant',
    label:    'Restaurant / Café',
    statCards: [
      { key: 'totalLeads',           label: 'Total Guests'     },
      { key: 'newLeads',             label: 'New Enquiries'    },
      { key: 'totalAppointments',    label: 'Reservations'     },
      { key: 'upcomingAppointments', label: 'Upcoming Tables'  },
      { key: 'totalServices',        label: 'Menu Items'       },
      { key: 'totalTestimonials',    label: 'Reviews'          },
    ],
    tableColumns: {
      leads:        ['Guest Name', 'Phone', 'Email',       'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Guest',      'Phone', 'Reservation', 'Status', 'Notes'],
      services:     ['Dish',       'Description',          'Price (₹)', 'Added'],
      testimonials: ['Guest',      'Review',               'Rating',    'Added'],
    },
    notifText: {
      newLead: 'New table enquiry',
    },
  },

  clinic: {
    mood:     'clinic',
    label:    'Clinic / Healthcare',
    statCards: [
      { key: 'totalLeads',           label: 'Total Patients'   },
      { key: 'newLeads',             label: 'New Enquiries'    },
      { key: 'totalAppointments',    label: 'Appointments'     },
      { key: 'upcomingAppointments', label: 'Upcoming'         },
      { key: 'totalServices',        label: 'Treatments'       },
      { key: 'totalTestimonials',    label: 'Patient Reviews'  },
    ],
    tableColumns: {
      leads:        ['Patient Name', 'Phone', 'Email',       'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Patient',      'Phone', 'Appointment', 'Status', 'Notes'],
      services:     ['Treatment',    'Description',          'Fee (₹)',  'Added'],
      testimonials: ['Patient',      'Feedback',             'Rating',   'Added'],
    },
    notifText: {
      newLead: 'New patient enquiry',
    },
  },

  retail: {
    mood:     'retail',
    label:    'Retail / Shop',
    statCards: [
      { key: 'totalLeads',           label: 'Total Customers'  },
      { key: 'newLeads',             label: 'New Enquiries'    },
      { key: 'totalAppointments',    label: 'Appointments'     },
      { key: 'upcomingAppointments', label: 'Upcoming'         },
      { key: 'totalServices',        label: 'Products'         },
      { key: 'totalTestimonials',    label: 'Reviews'          },
    ],
    tableColumns: {
      leads:        ['Customer Name', 'Phone', 'Email',       'Status', 'Priority', 'Score', 'Enquired'],
      appointments: ['Customer',      'Phone', 'Appointment', 'Status', 'Notes'],
      services:     ['Product',       'Description',          'Price (₹)', 'Added'],
      testimonials: ['Customer',      'Review',               'Rating',    'Added'],
    },
    notifText: {
      newLead: 'New customer enquiry',
    },
  },
};

/* Fallback for unknown / null industry values */
const FALLBACK = {
  mood:     'default',
  label:    'Business',
  statCards: [
    { key: 'totalLeads',           label: 'Total Leads'  },
    { key: 'newLeads',             label: 'New Leads'    },
    { key: 'totalAppointments',    label: 'Appointments' },
    { key: 'upcomingAppointments', label: 'Upcoming'     },
    { key: 'totalServices',        label: 'Services'     },
    { key: 'totalTestimonials',    label: 'Testimonials' },
  ],
  tableColumns: {
    leads:        ['Name', 'Phone', 'Email', 'Status', 'Priority', 'Score', 'Received'],
    appointments: ['Customer', 'Phone', 'Scheduled', 'Status', 'Notes'],
    services:     ['Title', 'Description', 'Price (₹)', 'Added'],
    testimonials: ['Customer', 'Testimonial', 'Rating', 'Added'],
  },
  notifText: {
    newLead: 'New lead arrived',
  },
  formCopy: {
    industryLabel: null,
    sub:           'Fill in your details and we\'ll get back to you as soon as possible.',
    placeholder:   'Tell us what you\'re looking for\u2026',
    submitLabel:   'Send enquiry',
    successSub:    'will be in touch with you shortly.',
    callStep:      'We get back to you as soon as possible',
  },
};

/**
 * Returns the industry config for a given industry string.
 * Falls back to FALLBACK if the industry is unknown or null.
 * @param {string|null|undefined} industry
 * @returns {object}
 */
function getIndustryConfig(industry) {
  return INDUSTRY[industry?.toLowerCase()] ?? FALLBACK;
}

module.exports = { getIndustryConfig };
