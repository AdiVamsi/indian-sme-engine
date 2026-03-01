/**
 * config.js — ALL site content lives here.
 * Edit this file to change any text, data, or API settings.
 * The HTML is a blank template; script.js renders everything from SITE.
 */

const SITE = {

  /* ── API ───────────────────────────────────────────────────── */
  api: {
    // ✏️  Replace with your Render URL once the backend is deployed.
    // Example: 'https://indian-sme-engine.onrender.com'
    baseUrl: 'https://YOUR-BACKEND-URL.onrender.com',
    slug:    'sharma-jee-academy-delhi',
  },

  /* ── Navigation ────────────────────────────────────────────── */
  nav: {
    logo: { icon: '🎯', name: 'Sharma JEE Academy' },
    links: [
      { label: 'About',       href: '#about' },
      { label: 'Programmes',  href: '#services' },
      { label: 'Results',     href: '#testimonials' },
    ],
    ctaLabel: 'Enquire Now',
  },

  /* ── Hero ──────────────────────────────────────────────────── */
  hero: {
    badge:        'Trusted since 2005 · New Delhi',
    titleLines:   ["Delhi's Most Trusted", 'IIT-JEE Coaching', 'Institute'],
    gradientLine: 1,    // 0-indexed: which line gets the gradient text
    subtitle:     'Expert faculty, small batches, and a proven track record of <strong>450+ IIT selections</strong>. Your journey to IIT starts here.',
    cta: {
      primary:   'Book a Free Trial Class',
      secondary: 'View Programmes',
    },
    proof: [
      { value: '450+',   label: 'IIT Selections' },
      { value: '5,000+', label: 'Students Coached' },
      { value: '18+',    label: 'Years Experience' },
    ],
  },

  /* ── Stats ─────────────────────────────────────────────────── */
  stats: [
    { target: 18,   suffix: '+',   label: 'Years of Excellence' },
    { target: 5000, suffix: '+',   label: 'Students Coached' },
    { target: 450,  suffix: '+',   label: 'IIT Selections' },
    { target: 99,   suffix: '.4%', label: 'Top Percentile' },
  ],

  /* ── About ─────────────────────────────────────────────────── */
  about: {
    label: 'About Us',
    title: 'Built for One Purpose — Your IIT Seat',
    paragraphs: [
      'Sharma JEE Academy was founded in 2005 by Ramesh Sharma, a former IIT Delhi graduate and seasoned educator. Our mission is simple: give every student the structured guidance, rigorous practice, and personal mentoring needed to crack India\'s toughest entrance exams.',
      'We keep batch sizes small (max 25 students) so faculty can give individual attention. Every student gets a personalised study plan, weekly one-on-one feedback, and access to our test portal with 2,000+ questions.',
    ],
    highlights: [
      'IIT-alumni faculty',
      'Max 25 students per batch',
      '2,000+ practice questions',
    ],
    cta: 'Talk to a Counsellor →',
    floatingCards: [
      { icon: '🏆', strong: 'AIR 312',   sub: 'JEE Advanced 2024', pos: 'bottom-left' },
      { icon: '⭐', strong: '99.4%ile',  sub: 'JEE Main 2024',     pos: 'top-right' },
    ],
  },

  /* ── Services ──────────────────────────────────────────────── */
  services: {
    label:    'Our Programmes',
    title:    'Choose the Right Programme for You',
    subtitle: 'Three pathways to IIT — designed for where you are in your journey.',
    items: [
      {
        icon:     '📘',
        title:    'JEE Main Foundation',
        desc:     'A 12-month classroom programme covering Physics, Chemistry & Mathematics for Class XI & XII students targeting JEE Main.',
        features: ['250+ hours of classroom teaching', 'Weekly chapter tests', 'Doubt clearing sessions'],
        price:    '₹60,000',
        period:   '/ year',
        featured: false,
      },
      {
        icon:     '🏆',
        title:    'JEE Advanced (IIT)',
        desc:     'Intensive two-year programme for JEE Advanced aspirants taught by IIT-alumni faculty with all-India mock tests and personal mentors.',
        features: ['IIT-alumni faculty', 'Full-length all-India mock tests', 'Personal mentor assigned'],
        price:    '₹90,000',
        period:   '/ year',
        featured: true,
        badge:    'Most Popular',
      },
      {
        icon:     '📝',
        title:    'Test Series & Revision',
        desc:     'Standalone all-India mock test series with detailed performance analytics — perfect for students in their final preparation months.',
        features: ['20 full-length mock tests', 'Detailed performance report', 'Rank prediction'],
        price:    '₹8,000',
        period:   '/ series',
        featured: false,
      },
    ],
  },

  /* ── Testimonials ──────────────────────────────────────────── */
  testimonials: {
    label:    'Student Results',
    title:    'Straight from Our Students',
    subtitle: 'Real results from real students who trusted us with their IIT dream.',
    items: [
      {
        stars:    5,
        text:     'The structured approach and doubt-clearing sessions at Sharma JEE Academy helped me crack JEE Advanced with AIR 312. The faculty genuinely cares about each student\'s progress. Best decision I ever made.',
        name:     'Arjun Kumar',
        result:   'JEE Advanced 2024 · AIR 312 · IIT Bombay',
        initials: 'AK',
      },
      {
        stars:    5,
        text:     'The mock test series and personal mentoring from Sharma sir gave me the confidence I needed. I scored 99.4 percentile in JEE Main and I couldn\'t have done it without this team.',
        name:     'Priya Sharma',
        result:   'JEE Main 2024 · 99.4 Percentile · NIT Delhi',
        initials: 'PS',
      },
    ],
  },

  /* ── Contact ───────────────────────────────────────────────── */
  contact: {
    label:    'Get in Touch',
    title:    "We'll Call You\nWithin 24 Hours",
    subtitle: 'Fill in your details and one of our academic counsellors will get in touch to answer all your questions — no obligation.',
    details: [
      { icon: '📍', text: 'Plot 14, Pitampura, New Delhi – 110034' },
      { icon: '📞', text: '+91 98000 00000' },
      { icon: '✉️', text: 'admissions@sharmajeeacademy.in' },
      { icon: '🕑', text: 'Monday – Saturday: 9 AM – 7 PM' },
    ],
    formHeader:    'Send an Enquiry',
    formSubheader: 'Usually responds within a few hours',
  },

  /* ── Footer ────────────────────────────────────────────────── */
  footer: {
    copy: '© 2025 Sharma JEE Academy, New Delhi. All rights reserved.',
  },
};
