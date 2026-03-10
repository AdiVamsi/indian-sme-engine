'use strict';

/*
 * Spelling / phonetic correction map.
 * Keys = misspelling (lowercase), Values = correction.
 * Extend this map as new real-world typos are observed.
 */
const SPELLING = {
    /* WhatsApp variants */
    'watsapp': 'whatsapp', 'wattsapp': 'whatsapp', 'whtsapp': 'whatsapp',
    'whtasapp': 'whatsapp', 'wahtsapp': 'whatsapp', 'watsap': 'whatsapp',
    'whatsaap': 'whatsapp', 'whtsp': 'whatsapp',

    /* Admission */
    'admision': 'admission', 'addmission': 'admission', 'admissin': 'admission',
    'addmision': 'admission', 'admisssion': 'admission',

    /* Coaching */
    'coching': 'coaching', 'couching': 'coaching', 'coacing': 'coaching',
    'coachin': 'coaching', 'cochng': 'coaching',

    /* Fee */
    'feee': 'fee', 'feees': 'fees', 'fess': 'fees', 'fes': 'fees',

    /* Common abbreviations */
    'nxt': 'next', 'plz': 'please', 'pls': 'please',
    'msg': 'message', 'dtls': 'details', 'clss': 'class',
    'yr': 'year', 'yrs': 'years', 'tmrw': 'tomorrow', 'tdy': 'today',
    'abt': 'about', 'thx': 'thanks', 'thnks': 'thanks',
    'admsn': 'admission', 'schlrshp': 'scholarship',

    /* Education terms */
    'scholership': 'scholarship', 'scholrship': 'scholarship',
    'enrollement': 'enrollment', 'scedule': 'schedule',
    'bathc': 'batch', 'batchs': 'batches',
    'curriculam': 'curriculum', 'syllbus': 'syllabus', 'sylabus': 'syllabus',
    'tution': 'tuition', 'tutions': 'tuitions',
    'examinaton': 'examination', 'registraton': 'registration',
};

/*
 * Repeated-character normalization.
 * Collapses runs of 3+ identical chars to 2 (e.g. "feeeees" → "fees").
 * Applied AFTER spelling correction.
 */
const REPEATED_CHAR_RE = /(.)\1{2,}/g;

module.exports = { SPELLING, REPEATED_CHAR_RE };
