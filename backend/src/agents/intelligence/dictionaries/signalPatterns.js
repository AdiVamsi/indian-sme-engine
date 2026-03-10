'use strict';

/*
 * Signal Pattern Definitions
 *
 * Each entry: { p: phrase (case-insensitive substring), s: signal name }
 * Patterns are matched longest-first at runtime (sorted by caller).
 * Extend any array to grow intelligence over time.
 */

/* ── A. Strong Positive Intent ─────────────────────────────────────────────── */
const POSITIVE = [
    /* Admission / enrollment */
    { p: 'need admission', s: 'ADMISSION' },
    { p: 'admission open', s: 'ADMISSION' },
    { p: 'want admission', s: 'ADMISSION' },
    { p: 'admission lena', s: 'ADMISSION' },
    { p: 'admission', s: 'ADMISSION' },
    { p: 'enroll', s: 'ENROLLMENT' },
    { p: 'enrollment', s: 'ENROLLMENT' },
    { p: 'registration', s: 'ENROLLMENT' },
    { p: 'sign up', s: 'ENROLLMENT' },
    { p: 'join', s: 'ENROLLMENT' },

    /* Coaching / tuition */
    { p: 'need coaching', s: 'COACHING_NEED' },
    { p: 'want coaching', s: 'COACHING_NEED' },
    { p: 'coaching class', s: 'COACHING_NEED' },
    { p: 'coaching for', s: 'COACHING_NEED' },
    { p: 'coaching', s: 'COACHING_NEED' },
    { p: 'tuition', s: 'COACHING_NEED' },
    { p: 'classes', s: 'COACHING_NEED' },

    /* Demo / trial */
    { p: 'demo class', s: 'DEMO_REQUEST' },
    { p: 'trial class', s: 'DEMO_REQUEST' },
    { p: 'demo session', s: 'DEMO_REQUEST' },
    { p: 'free trial', s: 'DEMO_REQUEST' },
    { p: 'demo', s: 'DEMO_REQUEST' },
    { p: 'trial', s: 'DEMO_REQUEST' },

    /* Fee / pricing */
    { p: 'fee structure', s: 'FEE_ENQUIRY' },
    { p: 'share fees', s: 'FEE_ENQUIRY' },
    { p: 'batch timing', s: 'BATCH_TIMING' },
    { p: 'batch timings', s: 'BATCH_TIMING' },
    { p: 'fees', s: 'FEE_ENQUIRY' },
    { p: 'fee', s: 'FEE_ENQUIRY' },
    { p: 'price', s: 'FEE_ENQUIRY' },
    { p: 'cost', s: 'FEE_ENQUIRY' },
    { p: 'charges', s: 'FEE_ENQUIRY' },

    /* Course / syllabus */
    { p: 'syllabus', s: 'COURSE_INFO' },
    { p: 'curriculum', s: 'COURSE_INFO' },
    { p: 'course', s: 'COURSE_INFO' },
    { p: 'subject', s: 'COURSE_INFO' },

    /* Scholarship / discount */
    { p: 'scholarship', s: 'SCHOLARSHIP_ENQUIRY' },
    { p: 'merit seat', s: 'SCHOLARSHIP_ENQUIRY' },
    { p: 'free seat', s: 'SCHOLARSHIP_ENQUIRY' },
    { p: 'discount', s: 'SCHOLARSHIP_ENQUIRY' },
    { p: 'concession', s: 'SCHOLARSHIP_ENQUIRY' },

    /* Batch / schedule */
    { p: 'batch timing', s: 'BATCH_TIMING' },
    { p: 'batch schedule', s: 'BATCH_TIMING' },
    { p: 'new batch', s: 'BATCH_TIMING' },
    { p: 'batch', s: 'BATCH_TIMING' },
    { p: 'schedule', s: 'BATCH_TIMING' },
    { p: 'timing', s: 'BATCH_TIMING' },
    { p: 'session', s: 'BATCH_TIMING' },
    { p: 'shift', s: 'BATCH_TIMING' },
];

/* ── B. Guardian / Family Proxy ────────────────────────────────────────────── */
const GUARDIAN = [
    { p: 'my daughter', s: 'DAUGHTER' },
    { p: 'my brother', s: 'BROTHER' },
    { p: 'my sister', s: 'SISTER' },
    { p: 'my child', s: 'CHILD' },
    { p: 'my ward', s: 'WARD' },
    { p: 'my son', s: 'SON' },
    { p: 'my nephew', s: 'NEPHEW' },
    { p: 'my niece', s: 'NIECE' },
    { p: 'my cousin', s: 'COUSIN' },
    { p: 'for my kid', s: 'CHILD' },
    /* Hinglish guardian — also in hinglish.js but kept here for completeness */
    { p: 'bhai ke liye', s: 'BROTHER' },
    { p: 'behen ke liye', s: 'SISTER' },
    { p: 'behan ke liye', s: 'SISTER' },
    { p: 'bete ke liye', s: 'SON' },
    { p: 'beti ke liye', s: 'DAUGHTER' },
    { p: 'bacche ke liye', s: 'CHILD' },
    { p: 'mere bhai', s: 'BROTHER' },
    { p: 'mera bhai', s: 'BROTHER' },
    { p: 'meri behen', s: 'SISTER' },
    { p: 'meri behan', s: 'SISTER' },
    { p: 'mere bete', s: 'SON' },
    { p: 'mera beta', s: 'SON' },
    { p: 'meri beti', s: 'DAUGHTER' },
    { p: 'mere bacche', s: 'CHILD' },
];

/* ── C. Negative Intent ────────────────────────────────────────────────────── */
const NEGATIVE = [
    { p: 'not interested', s: 'NOT_INTERESTED' },
    { p: 'no need', s: 'NO_NEED' },
    { p: 'not looking for', s: 'NOT_LOOKING' },
    { p: 'not required', s: 'NOT_REQUIRED' },
    { p: 'don\'t need', s: 'DONT_NEED' },
    { p: 'dont need', s: 'DONT_NEED' },
    { p: 'do not need', s: 'DONT_NEED' },
    { p: 'don\'t want', s: 'DONT_WANT' },
    { p: 'dont want', s: 'DONT_WANT' },
    { p: 'do not want', s: 'DONT_WANT' },
    { p: 'not looking', s: 'NOT_LOOKING' },
    /* Hinglish negatives */
    { p: 'nahi chahiye', s: 'NAHI_CHAHIYE' },
    { p: 'nhi chahiye', s: 'NAHI_CHAHIYE' },
    { p: 'nahi lena', s: 'NAHI_LENA' },
    { p: 'nhi lena', s: 'NAHI_LENA' },
    { p: 'nahi karna', s: 'NAHI_KARNA' },
    { p: 'interest nahi', s: 'NOT_INTERESTED_HI' },
    { p: 'zaroorat nahi', s: 'NO_NEED_HI' },
    { p: 'zarurat nahi', s: 'NO_NEED_HI' },
];

/* ── D. Junk / Spam / Prank ────────────────────────────────────────────────── */
const JUNK = [
    { p: 'wasting your time', s: 'WASTING_TIME' },
    { p: 'wasting time', s: 'WASTING_TIME' },
    { p: 'waste of time', s: 'WASTING_TIME' },
    { p: 'timepass', s: 'TIMEPASS' },
    { p: 'time pass', s: 'TIMEPASS' },
    { p: 'just testing', s: 'TESTING' },
    { p: 'test message', s: 'TESTING' },
    { p: 'wrong number', s: 'WRONG_NUMBER' },
    { p: 'spam', s: 'SPAM' },
    { p: 'ignore this', s: 'IGNORE' },
    { p: 'ignore', s: 'IGNORE' },
    { p: 'prank', s: 'PRANK' },
    { p: 'fraud', s: 'FRAUD' },
    { p: 'scam', s: 'SCAM' },
    /* Hinglish junk */
    { p: 'bakwas', s: 'JUNK_HI' },
    { p: 'faltu', s: 'JUNK_HI' },
    { p: 'mazak', s: 'PRANK_HI' },
    { p: 'bewakoof', s: 'ABUSE_HI' },
    { p: 'pagal', s: 'ABUSE_HI' },
];

/* ── E. Weak / Vague ──────────────────────────────────────────────────────── */
const VAGUE = [
    { p: 'just checking', s: 'JUST_CHECKING' },
    { p: 'maybe later', s: 'MAYBE_LATER' },
    { p: 'not sure yet', s: 'NOT_SURE' },
    { p: 'not sure', s: 'NOT_SURE' },
    { p: 'need info', s: 'NEED_INFO' },
    { p: 'some information', s: 'NEED_INFO' },
    { p: 'can you help', s: 'GENERIC_HELP' },
    { p: 'details?', s: 'DETAILS_QUESTION' },
    { p: 'hello', s: 'GREETING' },
    { p: 'hi', s: 'GREETING' },
    /* Hinglish vague */
    { p: 'pata karna tha', s: 'JUST_CHECKING_HI' },
    { p: 'dekh raha hu', s: 'BROWSING_HI' },
    { p: 'dekh raha', s: 'BROWSING_HI' },
    { p: 'sochte hain', s: 'UNDECIDED_HI' },
    { p: 'soch raha', s: 'UNDECIDED_HI' },
    { p: 'abhi confirm nahi', s: 'UNDECIDED_HI' },
];

/* ── F. Wrong-Fit (by industry) ────────────────────────────────────────────── */
const WRONG_FIT = {
    academy: [
        { p: 'dance class', s: 'DANCE' },
        { p: 'yoga class', s: 'YOGA' },
        { p: 'music class', s: 'MUSIC' },
        { p: 'cooking class', s: 'COOKING' },
        { p: 'beauty course', s: 'BEAUTY' },
        { p: 'neet', s: 'NEET' },
        { p: 'upsc', s: 'UPSC' },
        { p: 'ias', s: 'IAS' },
        { p: 'ssc', s: 'SSC' },
    ],
    gym: [
        { p: 'coaching', s: 'COACHING' },
        { p: 'tuition', s: 'TUITION' },
        { p: 'admission', s: 'ADMISSION' },
        { p: 'syllabus', s: 'SYLLABUS' },
    ],
    salon: [
        { p: 'coaching', s: 'COACHING' },
        { p: 'tuition', s: 'TUITION' },
        { p: 'gym', s: 'GYM' },
    ],
};

/* ── G. Channel Preference ─────────────────────────────────────────────────── */
const CHANNEL = [
    { p: 'send on whatsapp', s: 'WHATSAPP' },
    { p: 'whatsapp pe', s: 'WHATSAPP' },
    { p: 'whatsapp me', s: 'WHATSAPP' },
    { p: 'send details', s: 'SEND_DETAILS' },
    { p: 'send brochure', s: 'SEND_BROCHURE' },
    { p: 'whatsapp', s: 'WHATSAPP' },
    { p: 'call me', s: 'CALL' },
    { p: 'call back', s: 'CALL' },
    { p: 'callback', s: 'CALL' },
    { p: 'phone call', s: 'CALL' },
    { p: 'email me', s: 'EMAIL' },
    { p: 'mail me', s: 'EMAIL' },
    /* Hinglish */
    { p: 'call karo', s: 'CALL_HI' },
    { p: 'bhej do', s: 'SEND_HI' },
    { p: 'bhejo', s: 'SEND_HI' },
    { p: 'batao', s: 'TELL_HI' },
    { p: 'bata do', s: 'TELL_HI' },
];

/* ── Urgency / Timing ──────────────────────────────────────────────────────── */
const URGENCY = [
    { p: 'immediately', s: 'IMMEDIATELY' },
    { p: 'right now', s: 'RIGHT_NOW' },
    { p: 'as soon as possible', s: 'ASAP' },
    { p: 'asap', s: 'ASAP' },
    { p: 'urgent', s: 'URGENT' },
    { p: 'urgently', s: 'URGENT' },
    { p: 'today', s: 'TODAY' },
    { p: 'tomorrow', s: 'TOMORROW' },
    { p: 'this week', s: 'THIS_WEEK' },
    { p: 'next week', s: 'NEXT_WEEK' },
    { p: 'next month', s: 'NEXT_MONTH' },
    { p: 'from next', s: 'FROM_NEXT' },
    /* Hinglish timing */
    { p: 'abhi', s: 'NOW_HI' },
    { p: 'turant', s: 'IMMEDIATELY_HI' },
    { p: 'jaldi', s: 'QUICK_HI' },
    { p: 'kal', s: 'TOMORROW_HI' },
    { p: 'agle hafte', s: 'NEXT_WEEK_HI' },
    { p: 'is hafte', s: 'THIS_WEEK_HI' },
    { p: 'agle mahine', s: 'NEXT_MONTH_HI' },
    { p: 'next month se', s: 'NEXT_MONTH' },
    { p: 'next week se', s: 'NEXT_WEEK' },
];

/* ── Negation Markers ──────────────────────────────────────────────────────── */
const NEGATION_MARKERS = [
    'don\'t', 'dont', 'do not', 'does not', 'doesn\'t', 'doesnt',
    'not', 'no', 'never', 'neither',
    'won\'t', 'wont', 'will not',
    'cannot', 'can\'t', 'cant',
    /* Hinglish */
    'nahi', 'nhi', 'nahin', 'na', 'mat',
];

/* Regex for clause boundaries that break negation scope */
const NEGATION_BREAKER_RE = /[.!?;]|\bbut\b|\bhowever\b|\bthough\b|\blekin\b|\bmagar\b|\bpar\b/gi;

/* ── Gibberish detection ───────────────────────────────────────────────────── */
const GIBBERISH_RE = /^([a-z])\1{2,}$/; // e.g. "hhh", "aaa"
const KEYBOARD_SMASH_RE = /^([asdfghjkl]{5,}|[qwertyuiop]{5,}|[zxcvbnm]{5,})$/;

module.exports = {
    POSITIVE, GUARDIAN, NEGATIVE, JUNK, VAGUE, WRONG_FIT,
    CHANNEL, URGENCY, NEGATION_MARKERS, NEGATION_BREAKER_RE,
    GIBBERISH_RE, KEYBOARD_SMASH_RE,
};
