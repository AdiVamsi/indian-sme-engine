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
    name: 'Aakash Sharma',
    phone: '+91 9876500001',
    email: 'aakash.sharma1@example.com',
    message: 'I need coaching for JEE',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Neha Verma',
    phone: '+91 9876500002',
    email: 'neha.verma2@example.com',
    message: 'My sister needs coaching',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Rohit Gupta',
    phone: '+91 9876500003',
    email: 'rohit.gupta3@example.com',
    message: 'My brother needs coaching from next month',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Priya Nair',
    phone: '+91 9876500004',
    email: 'priya.nair4@example.com',
    message: 'Need admission details',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Karan Mehta',
    phone: '+91 9876500005',
    email: 'karan.mehta5@example.com',
    message: 'I want to join your classes',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Sneha Iyer',
    phone: '+91 9876500006',
    email: 'sneha.iyer6@example.com',
    message: 'Can I enroll for JEE coaching',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Vivek Reddy',
    phone: '+91 9876500007',
    email: 'vivek.reddy7@example.com',
    message: 'Please share course details',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'NORMAL',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Anjali Singh',
    phone: '+91 9876500008',
    email: 'anjali.singh8@example.com',
    message: 'I need coaching immediately',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'HIGH',
    expectedTags: ['ADMISSION', 'URGENT'],
  },
  {
    name: 'Rahul Joshi',
    phone: '+91 9876500009',
    email: 'rahul.joshi9@example.com',
    message: 'Need coaching from tomorrow',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'HIGH',
    expectedTags: ['ADMISSION', 'URGENT'],
  },
  {
    name: 'Meera Kapoor',
    phone: '+91 9876500010',
    email: 'meera.kapoor10@example.com',
    message: 'I want admission for class 11',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Arjun Malhotra',
    phone: '+91 9876500011',
    email: 'arjun.malhotra11@example.com',
    message: 'fees kitni hai',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Kavya Menon',
    phone: '+91 9876500012',
    email: 'kavya.menon12@example.com',
    message: 'What is the fee structure',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Nikhil Rao',
    phone: '+91 9876500013',
    email: 'nikhil.rao13@example.com',
    message: 'Please share fees for JEE batch',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Pooja Das',
    phone: '+91 9876500014',
    email: 'pooja.das14@example.com',
    message: 'How much does your coaching cost',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Sandeep Kulkarni',
    phone: '+91 9876500015',
    email: 'sandeep.kulkarni15@example.com',
    message: 'Any discount on fees',
    expectedIntent: 'SCHOLARSHIP_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['SCHOLARSHIP'],
  },
  {
    name: 'Divya Bansal',
    phone: '+91 9876500016',
    email: 'divya.bansal16@example.com',
    message: 'What are the batch timings',
    expectedIntent: 'BATCH_TIMING',
    expectedPriority: 'NORMAL',
    expectedTags: ['BATCH_TIMING'],
  },
  {
    name: 'Tejas Patel',
    phone: '+91 9876500017',
    email: 'tejas.patel17@example.com',
    message: 'Classes eppudu start avthayi',
    expectedIntent: 'BATCH_TIMING',
    expectedPriority: 'NORMAL',
    expectedTags: ['BATCH_TIMING'],
  },
  {
    name: 'Riya Chawla',
    phone: '+91 9876500018',
    email: 'riya.chawla18@example.com',
    message: 'Next batch start date enti',
    expectedIntent: 'BATCH_TIMING',
    expectedPriority: 'NORMAL',
    expectedTags: ['BATCH_TIMING'],
  },
  {
    name: 'Mohit Arora',
    phone: '+91 9876500019',
    email: 'mohit.arora19@example.com',
    message: 'Can I attend a demo class',
    expectedIntent: 'DEMO_REQUEST',
    expectedPriority: 'NORMAL',
    expectedTags: ['DEMO_REQUEST'],
  },
  {
    name: 'Ishita Roy',
    phone: '+91 9876500020',
    email: 'ishita.roy20@example.com',
    message: 'Trial class available aa',
    expectedIntent: 'DEMO_REQUEST',
    expectedPriority: 'NORMAL',
    expectedTags: ['DEMO_REQUEST'],
  },
  {
    name: 'Harsha Vardhan',
    phone: '+91 9876500021',
    email: 'harsha.vardhan21@example.com',
    message: 'My favourite food is mango but I need coaching from next month',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Simran Kaur',
    phone: '+91 9876500022',
    email: 'simran.kaur22@example.com',
    message: 'I drink tea every day. Need JEE coaching urgently',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'HIGH',
    expectedTags: ['ADMISSION', 'URGENT'],
  },
  {
    name: 'Aditya Jain',
    phone: '+91 9876500023',
    email: 'aditya.jain23@example.com',
    message: 'Hello sir, I live in Delhi and I want coaching',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Nandini Rao',
    phone: '+91 9876500024',
    email: 'nandini.rao24@example.com',
    message: 'Just asking, do you have coaching for my brother',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Manav Sehgal',
    phone: '+91 9876500025',
    email: 'manav.sehgal25@example.com',
    message: 'Need details now, joining soon',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'NORMAL',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Bhavna Tiwari',
    phone: '+91 9876500026',
    email: 'bhavna.tiwari26@example.com',
    message: 'Do you offer NEET coaching',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Ritesh Kumar',
    phone: '+91 9876500027',
    email: 'ritesh.kumar27@example.com',
    message: 'IAS coaching available?',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Sanjana Pillai',
    phone: '+91 9876500028',
    email: 'sanjana.pillai28@example.com',
    message: 'Do you teach dance classes',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Deepak Yadav',
    phone: '+91 9876500029',
    email: 'deepak.yadav29@example.com',
    message: 'Need guitar lessons',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Aditi Bhardwaj',
    phone: '+91 9876500030',
    email: 'aditi.bhardwaj30@example.com',
    message: 'Do you provide coding bootcamps',
    expectedIntent: 'WRONG_FIT',
    expectedPriority: 'LOW',
    expectedTags: ['WRONG_FIT'],
  },
  {
    name: 'Vishal Saxena',
    phone: '+91 9876500031',
    email: 'vishal.saxena31@example.com',
    message: 'I dont need coaching',
    expectedIntent: 'NOT_INTERESTED',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Tanvi Ghosh',
    phone: '+91 9876500032',
    email: 'tanvi.ghosh32@example.com',
    message: 'Just wasting your time',
    expectedIntent: 'JUNK',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Chetan Mishra',
    phone: '+91 9876500033',
    email: 'chetan.mishra33@example.com',
    message: 'test',
    expectedIntent: 'JUNK',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Aisha Thomas',
    phone: '+91 9876500034',
    email: 'aisha.thomas34@example.com',
    message: 'hello',
    expectedIntent: 'JUNK',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Lokesh Naidu',
    phone: '+91 9876500035',
    email: 'lokesh.naidu35@example.com',
    message: 'wrong number',
    expectedIntent: 'JUNK',
    expectedPriority: 'LOW',
    expectedTags: [],
  },
  {
    name: 'Shreya Bhat',
    phone: '+91 9876500036',
    email: 'shreya.bhat36@example.com',
    message: 'details?',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'LOW',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Gaurav Soni',
    phone: '+91 9876500037',
    email: 'gaurav.soni37@example.com',
    message: 'call me',
    expectedIntent: 'CALLBACK_REQUEST',
    expectedPriority: 'NORMAL',
    expectedTags: ['CALLBACK_REQUEST'],
  },
  {
    name: 'Ritika Paul',
    phone: '+91 9876500038',
    email: 'ritika.paul38@example.com',
    message: 'send info',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'LOW',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Amarjeet Singh',
    phone: '+91 9876500039',
    email: 'amarjeet.singh39@example.com',
    message: 'interested',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'LOW',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Muskan Ali',
    phone: '+91 9876500040',
    email: 'muskan.ali40@example.com',
    message: 'need help',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'LOW',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Faizan Khan',
    phone: '+91 9876500041',
    email: 'faizan.khan41@example.com',
    message: 'mujhe jee coaching chahiye',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Lavanya Krishnan',
    phone: '+91 9876500042',
    email: 'lavanya.krishnan42@example.com',
    message: 'bhai ke liye coaching chahiye',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Yash Agarwal',
    phone: '+91 9876500043',
    email: 'yash.agarwal43@example.com',
    message: 'fees kitni padegi',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Shruti Narang',
    phone: '+91 9876500044',
    email: 'shruti.narang44@example.com',
    message: 'kal se class join karna hai',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'HIGH',
    expectedTags: ['ADMISSION', 'URGENT'],
  },
  {
    name: 'Imran Sheikh',
    phone: '+91 9876500045',
    email: 'imran.sheikh45@example.com',
    message: 'mera beta class 11 mein hai, jee coaching chahiye',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Sai Kiran',
    phone: '+91 9876500046',
    email: 'sai.kiran46@example.com',
    message: 'naaku jee coaching kavali',
    expectedIntent: 'ADMISSION',
    expectedPriority: 'NORMAL',
    expectedTags: ['ADMISSION'],
  },
  {
    name: 'Keerthana M',
    phone: '+91 9876500047',
    email: 'keerthana.m47@example.com',
    message: 'naa sister ki coaching details kavali',
    expectedIntent: 'COURSE_INFO',
    expectedPriority: 'NORMAL',
    expectedTags: ['COURSE_INFO'],
  },
  {
    name: 'Pranav R',
    phone: '+91 9876500048',
    email: 'pranav.r48@example.com',
    message: 'batch timings enti',
    expectedIntent: 'BATCH_TIMING',
    expectedPriority: 'NORMAL',
    expectedTags: ['BATCH_TIMING'],
  },
  {
    name: 'Sravani P',
    phone: '+91 9876500049',
    email: 'sravani.p49@example.com',
    message: 'fees entha untundi',
    expectedIntent: 'FEE_ENQUIRY',
    expectedPriority: 'NORMAL',
    expectedTags: ['FEE_ENQUIRY'],
  },
  {
    name: 'Charan Tej',
    phone: '+91 9876500050',
    email: 'charan.tej50@example.com',
    message: 'naaku classes eppudu start avthayo cheppandi',
    expectedIntent: 'BATCH_TIMING',
    expectedPriority: 'NORMAL',
    expectedTags: ['BATCH_TIMING'],
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
