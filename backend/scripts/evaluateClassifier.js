'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const BUSINESS_SLUG = process.env.BUSINESS_SLUG || 'sharma-jee-academy-delhi';
const CLASSIFICATION_WAIT_MS = Number(process.env.CLASSIFICATION_WAIT_MS || 3000);
const OUTPUT_DIR = path.resolve(__dirname, '../artifacts/classifier-evals');

const TEST_CASES = [
  {
    name: 'Rahul Sharma',
    phone: '+91 91000 00001',
    email: 'rahul.eval+1@example.com',
    message: 'My son wants admission for JEE coaching. Please call me today.',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'HIGH',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Pooja Verma',
    phone: '+91 91000 00002',
    email: 'pooja.eval+2@example.com',
    message: 'fees kitni hai for the JEE batch?',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Amit Singh',
    phone: '+91 91000 00003',
    email: 'amit.eval+3@example.com',
    message: 'Please whatsapp me the brochure and details.',
    expectedIntent: 'WHATSAPP_REQUEST',
    expectedPriority: 'NORMAL',
    expectedTags: ['WHATSAPP_REQUEST'],
  },
  {
    name: 'Sneha Gupta',
    phone: '+91 91000 00004',
    email: 'sneha.eval+4@example.com',
    message: 'I want a demo class before joining.',
    expectedIntent: 'DEMO_REQUEST',
    expectedPriority: 'HIGH',
    expectedTags: ['DEMO_REQUEST'],
  },
  {
    name: 'Nikhil Rao',
    phone: '+91 91000 00005',
    email: 'nikhil.eval+5@example.com',
    message: 'My favourite food is mango. but i need coaching from next month, give me the details now',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Kiran Patel',
    phone: '+91 91000 00006',
    email: 'kiran.eval+6@example.com',
    message: 'Do you have NEET coaching?',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Riya Malhotra',
    phone: '+91 91000 00007',
    email: 'riya.eval+7@example.com',
    message: 'I dont need coaching. just checking.',
    expectedIntent: 'NOT_INTERESTED',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Arjun Mehta',
    phone: '+91 91000 00008',
    email: 'arjun.eval+8@example.com',
    message: 'scholarship mil sakta hai kya for jee coaching?',
    expectedIntent: 'SCHOLARSHIP_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['SCHOLARSHIP_ENQUIRY'],
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function tagsMatch(expectedTags, actualTags) {
  const expected = [...new Set(expectedTags)].sort();
  const actual = [...new Set(actualTags)].sort();
  return expected.length === actual.length && expected.every((tag, index) => tag === actual[index]);
}

function buildCasePayload(testCase, index) {
  const suffix = `${Date.now()}-${index + 1}`;
  const digits = String(testCase.phone || '').replace(/\D/g, '');
  const baseDigits = digits.slice(-10) || String(9100000000 + index);
  const uniqueDigits = `${baseDigits.slice(0, 6)}${suffix.slice(-4)}`.slice(-10);

  return {
    ...testCase,
    phone: `+91 ${uniqueDigits.slice(0, 5)} ${uniqueDigits.slice(5)}`,
    email: testCase.email?.replace('@', `+${suffix}@`) || undefined,
  };
}

async function submitLead(testCase) {
  const response = await fetch(`${BASE_URL}/api/public/${BUSINESS_SLUG}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: testCase.name,
      phone: testCase.phone,
      email: testCase.email,
      message: testCase.message,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
}

async function findLeadWithActivities(businessId, phone) {
  return prisma.lead.findFirst({
    where: { businessId, phone },
    orderBy: { createdAt: 'desc' },
    include: {
      activities: {
        where: { type: { in: ['AGENT_CLASSIFIED', 'AGENT_PRIORITIZED'] } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

async function waitForClassification(businessId, phone) {
  await sleep(CLASSIFICATION_WAIT_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lead = await findLeadWithActivities(businessId, phone);
    const classified = lead?.activities?.find((activity) => activity.type === 'AGENT_CLASSIFIED');
    const prioritized = lead?.activities?.find((activity) => activity.type === 'AGENT_PRIORITIZED');

    if (lead && classified && prioritized) {
      return { lead, classified, prioritized };
    }

    await sleep(500);
  }

  return { lead: await findLeadWithActivities(businessId, phone), classified: null, prioritized: null };
}

function extractResult({ lead, classified, prioritized }) {
  const actualTags = classified?.metadata?.tags ?? [];
  const actualPriority = prioritized?.metadata?.priorityLabel
    || (prioritized?.metadata?.priorityScore >= 30 ? 'HIGH'
      : prioritized?.metadata?.priorityScore >= 10 ? 'NORMAL'
      : 'LOW');

  return {
    leadId: lead?.id || null,
    actualIntent: classified?.metadata?.bestCategory || null,
    actualPriority: actualPriority || null,
    actualPriorityScore: prioritized?.metadata?.priorityScore ?? null,
    actualTags,
    actualConfidence: classified?.metadata?.confidenceScore ?? null,
    actualDisposition: classified?.metadata?.leadDisposition ?? null,
  };
}

function summarizeResult(testCase, actual) {
  const intentPassed = actual.actualIntent === testCase.expectedIntent;
  const priorityPassed = actual.actualPriority === testCase.expectedPriority;
  const tagsPassed = tagsMatch(testCase.expectedTags, actual.actualTags || []);
  const passed = intentPassed && priorityPassed && tagsPassed;

  return {
    ...testCase,
    ...actual,
    intentPassed,
    priorityPassed,
    tagsPassed,
    passed,
  };
}

function buildCsv(rows) {
  const headers = [
    'name',
    'phone',
    'message',
    'expectedIntent',
    'actualIntent',
    'intentPassed',
    'expectedPriority',
    'actualPriority',
    'priorityPassed',
    'expectedTags',
    'actualTags',
    'tagsPassed',
    'actualPriorityScore',
    'actualConfidence',
    'actualDisposition',
    'passed',
    'leadId',
  ];

  return [
    headers.join(','),
    ...rows.map((row) => ([
      row.name,
      row.phone,
      row.message,
      row.expectedIntent,
      row.actualIntent,
      row.intentPassed,
      row.expectedPriority,
      row.actualPriority,
      row.priorityPassed,
      row.expectedTags.join('|'),
      (row.actualTags || []).join('|'),
      row.tagsPassed,
      row.actualPriorityScore,
      row.actualConfidence,
      row.actualDisposition,
      row.passed,
      row.leadId,
    ].map(escapeCsv).join(','))),
  ].join('\n');
}

async function main() {
  console.log(`Running classifier evaluation against ${BASE_URL}/api/public/${BUSINESS_SLUG}/leads`);
  console.log(`Initial wait time: ${CLASSIFICATION_WAIT_MS}ms`);

  const business = await prisma.business.findUnique({
    where: { slug: BUSINESS_SLUG },
    select: { id: true, slug: true, name: true },
  });

  if (!business) {
    throw new Error(`Business slug not found in database: ${BUSINESS_SLUG}`);
  }

  const results = [];

  for (const [index, baseCase] of TEST_CASES.entries()) {
    const testCase = buildCasePayload(baseCase, index);
    console.log(`Submitting case ${index + 1}/${TEST_CASES.length}: ${testCase.message}`);

    await submitLead(testCase);

    const evaluation = await waitForClassification(business.id, testCase.phone);
    const actual = extractResult(evaluation);
    const row = summarizeResult(testCase, actual);
    results.push(row);

    console.log(
      `${row.passed ? 'PASS' : 'FAIL'} ` +
      `intent=${row.actualIntent || 'n/a'} priority=${row.actualPriority || 'n/a'} tags=${(row.actualTags || []).join('|') || 'none'}`
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const jsonPath = path.join(OUTPUT_DIR, `classifier-eval-${timestamp}.json`);
  const csvPath = path.join(OUTPUT_DIR, `classifier-eval-${timestamp}.csv`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  fs.writeFileSync(csvPath, `${buildCsv(results)}\n`, 'utf8');

  const total = results.length;
  const passed = results.filter((row) => row.passed).length;
  const failed = total - passed;
  const intentPassed = results.filter((row) => row.intentPassed).length;
  const priorityPassed = results.filter((row) => row.priorityPassed).length;

  console.log('\nSummary');
  console.log(`Total tests      : ${total}`);
  console.log(`Passed           : ${passed}`);
  console.log(`Failed           : ${failed}`);
  console.log(`Intent accuracy  : ${((intentPassed / total) * 100).toFixed(1)}%`);
  console.log(`Priority accuracy: ${((priorityPassed / total) * 100).toFixed(1)}%`);
  console.log(`JSON report      : ${jsonPath}`);
  console.log(`CSV report       : ${csvPath}`);
}

main()
  .catch((err) => {
    console.error('Classifier evaluation failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
