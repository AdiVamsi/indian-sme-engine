'use strict';

/*
 * Hinglish (Hindi written in Roman script) signal patterns.
 * Each entry: { p: phrase, s: signal, family: 'positive'|'negative'|... }
 *
 * These supplement the English patterns in signalPatterns.js.
 * Extend as new real-world Hinglish patterns are observed.
 */

const HINGLISH_POSITIVE = [
    { p: 'coaching chahiye', s: 'COACHING_NEED' },
    { p: 'admission lena hai', s: 'ADMISSION' },
    { p: 'admission lena', s: 'ADMISSION' },
    { p: 'join karna hai', s: 'ENROLLMENT' },
    { p: 'join karna', s: 'ENROLLMENT' },
    { p: 'shuru karna hai', s: 'START_INTENT' },
    { p: 'shuru karna', s: 'START_INTENT' },
    { p: 'lena hai', s: 'WANT_TO_TAKE' },
    { p: 'karna hai', s: 'WANT_TO_DO' },
    { p: 'chahiye', s: 'NEED_WANT' },
    { p: 'chaiye', s: 'NEED_WANT' },
    { p: 'chahye', s: 'NEED_WANT' },
    { p: 'fees kitni hai', s: 'FEE_ENQUIRY' },
    { p: 'fees kitni', s: 'FEE_ENQUIRY' },
    { p: 'fees kya hai', s: 'FEE_ENQUIRY' },
    { p: 'fees kya', s: 'FEE_ENQUIRY' },
    { p: 'kitni fees', s: 'FEE_ENQUIRY' },
    { p: 'batch kab se', s: 'BATCH_TIMING' },
    { p: 'batch kab', s: 'BATCH_TIMING' },
    { p: 'kab se', s: 'TIMING' },
    { p: 'kab hai', s: 'TIMING' },
    { p: 'ke liye', s: 'FOR_PURPOSE' },
    { p: 'hai kya', s: 'AVAILABILITY_CHECK' },
    { p: 'milega kya', s: 'AVAILABILITY_CHECK' },
    { p: 'hota hai kya', s: 'AVAILABILITY_CHECK' },
    { p: 'padhate ho', s: 'TEACHING_CHECK' },
    { p: 'padhate hain', s: 'TEACHING_CHECK' },
    { p: 'sikhate ho', s: 'TEACHING_CHECK' },
    { p: 'puch raha hu', s: 'ENQUIRING' },
    { p: 'puch rahi hu', s: 'ENQUIRING' },
    { p: 'jaankari', s: 'INFO_REQUEST' },
    { p: 'jankari', s: 'INFO_REQUEST' },
];

const HINGLISH_NEGATIVE = [
    { p: 'nahi chahiye', s: 'NAHI_CHAHIYE' },
    { p: 'nhi chahiye', s: 'NAHI_CHAHIYE' },
    { p: 'nahin chahiye', s: 'NAHI_CHAHIYE' },
    { p: 'nahi lena', s: 'NAHI_LENA' },
    { p: 'nhi lena', s: 'NAHI_LENA' },
    { p: 'nahi karna', s: 'NAHI_KARNA' },
    { p: 'nhi karna', s: 'NAHI_KARNA' },
    { p: 'interest nahi hai', s: 'NOT_INTERESTED_HI' },
    { p: 'interest nahi', s: 'NOT_INTERESTED_HI' },
    { p: 'zaroorat nahi', s: 'NO_NEED_HI' },
    { p: 'zarurat nahi', s: 'NO_NEED_HI' },
    { p: 'abhi nahi', s: 'NOT_NOW_HI' },
    { p: 'bilkul nahi', s: 'ABSOLUTELY_NOT_HI' },
    { p: 'kabhi nahi', s: 'NEVER_HI' },
];

const HINGLISH_VAGUE = [
    { p: 'pata karna tha', s: 'JUST_CHECKING_HI' },
    { p: 'dekh raha hu', s: 'BROWSING_HI' },
    { p: 'dekh raha', s: 'BROWSING_HI' },
    { p: 'sochte hain', s: 'UNDECIDED_HI' },
    { p: 'soch raha', s: 'UNDECIDED_HI' },
    { p: 'abhi confirm nahi', s: 'UNDECIDED_HI' },
    { p: 'baad mein', s: 'LATER_HI' },
    { p: 'baad me', s: 'LATER_HI' },
];

module.exports = { HINGLISH_POSITIVE, HINGLISH_NEGATIVE, HINGLISH_VAGUE };
