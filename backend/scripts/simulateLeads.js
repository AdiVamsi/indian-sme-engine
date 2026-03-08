'use strict';

/**
 * Lead Simulation Engine
 *
 * Submits realistic fake leads through the real public API.
 * Does NOT write directly to Prisma / the database.
 *
 * ── Configuration ─────────────────────────────────────────
 */
const BASE_URL        = 'http://localhost:4000';
const LEADS_PER_MINUTE = 5;          // used in normal mode to derive interval range
const BURST_MODE      = false;        // true → fires 20 rapid leads then exits
const BURST_COUNT     = 20;           // number of leads to fire in burst mode
const ANALYSE_AFTER   = true;         // fetch the created lead and log agent tags/score
// ──────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/* ── Random-data pools ────────────────────────────────────── */

const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Arjun', 'Ananya', 'Bhavesh', 'Chitra', 'Deepak', 'Divya',
  'Gaurav', 'Ishaan', 'Kavya', 'Kiran', 'Manish', 'Meera', 'Nishant', 'Pooja',
  'Rahul', 'Riya', 'Rohit', 'Sakshi', 'Sanjay', 'Shreya', 'Suresh', 'Tanvi',
  'Varun', 'Vidya', 'Vikram', 'Yash', 'Zara', 'Priya',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Singh', 'Patel', 'Mehta', 'Joshi', 'Rao',
  'Nair', 'Iyer', 'Pillai', 'Reddy', 'Kumar', 'Malhotra', 'Kapoor', 'Bose',
  'Chatterjee', 'Das', 'Ghosh', 'Pandey',
];

const MESSAGES = [
  'I would like to book a demo session as soon as possible.',
  'Please call me — interested in admission details.',
  'Saw your ad online, wanted more information about pricing.',
  'Looking for a trial class this weekend.',
  'Need urgent help with my business requirements.',
  'Can we schedule a consultation?',
  'Interested in your premium plan.',
  'A friend referred me. What packages do you offer?',
  'Hi, I need a demo of your product.',
  'Please share your brochure and pricing.',
  'Want to know more about the admission process.',
  'I run a small business and need your services.',
  'Saw the review on Google, very impressed.',
  null, // no message — tests the optional field path
];

const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

/* ── Helpers ─────────────────────────────────────────────── */

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randPhone() {
  const prefix = rand(['98', '97', '96', '95', '94', '93', '91', '88', '87', '86', '79', '70']);
  const digits = String(randInt(10000000, 99999999));
  return `+91 ${prefix}${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function generateRandomLead() {
  const first   = rand(FIRST_NAMES);
  const last    = rand(LAST_NAMES);
  const name    = `${first} ${last}`;
  const phone   = randPhone();
  const email   = Math.random() > 0.4
    ? `${first.toLowerCase()}.${last.toLowerCase()}${randInt(1, 99)}@${rand(DOMAINS)}`
    : undefined;
  const message = rand(MESSAGES) ?? undefined;

  return { name, phone, email, message };
}

/** POST one lead to the public API. Returns { status, body }. */
async function postLead(slug, lead) {
  const url = `${BASE_URL}/api/public/${slug}/leads`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(lead),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/**
 * After a lead is created, look it up in the DB and log
 * the agent classification tags, priority score, and any
 * automation activities that fired.
 */
async function analyseLastLead(slug, lead) {
  try {
    const business = await prisma.business.findUnique({ where: { slug } });
    if (!business) return;

    const dbLead = await prisma.lead.findFirst({
      where:   { businessId: business.id, phone: lead.phone },
      orderBy: { createdAt: 'desc' },
      include: { activities: { orderBy: { createdAt: 'asc' } } },
    });

    if (!dbLead) return;

    const classified  = dbLead.activities.find((a) => a.type === 'AGENT_CLASSIFIED');
    const prioritised = dbLead.activities.find((a) => a.type === 'AGENT_PRIORITIZED');
    const automations = dbLead.activities.filter((a) => a.type.startsWith('AUTOMATION_'));

    const tags  = classified?.metadata?.tags  ?? [];
    const score = prioritised?.metadata?.score ?? 'n/a';

    console.log(
      `    [SIM][AI] tags=[${tags.join(', ')}]  score=${score}` +
      (automations.length ? `  automations=${automations.map((a) => a.type).join(',')}` : ''),
    );
  } catch (err) {
    console.error('    [SIM][AI] analysis error:', err.message);
  }
}

/* ── Timing helpers ──────────────────────────────────────── */

/** Derive a random interval (ms) that averages out to LEADS_PER_MINUTE. */
function nextIntervalMs() {
  const avgMs = (60 / LEADS_PER_MINUTE) * 1000;  // e.g. 12 000 ms for 5/min
  const minMs = avgMs * 0.4;                       // ~5 s
  const maxMs = avgMs * 1.6;                       // ~19 s
  return randInt(minMs, maxMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ── Core simulation functions ───────────────────────────── */

async function fireLead(businesses) {
  const business = rand(businesses);
  const lead     = generateRandomLead();

  process.stdout.write(
    `[SIM] slug=${business.slug}  name="${lead.name}"  msg="${lead.message ?? '(none)'}"\n`,
  );

  const { status } = await postLead(business.slug, lead);
  console.log(`    [SIM] → HTTP ${status}`);

  if (ANALYSE_AFTER && status === 201) {
    await sleep(300); // brief pause so agent pipeline can write activities
    await analyseLastLead(business.slug, lead);
  }

  return status;
}

async function runBurst(businesses) {
  console.log(`[SIM] BURST MODE — firing ${BURST_COUNT} leads rapidly…\n`);
  for (let i = 0; i < BURST_COUNT; i++) {
    await fireLead(businesses);
    await sleep(200); // minimal gap so we don't overwhelm the event loop
  }
  console.log('\n[SIM] Burst complete.');
}

async function runContinuous(businesses) {
  console.log(
    `[SIM] CONTINUOUS MODE — target ${LEADS_PER_MINUTE} leads/min` +
    ` (intervals ${Math.round(((60 / LEADS_PER_MINUTE) * 0.4 * 1000) / 1000)}s – ` +
    `${Math.round(((60 / LEADS_PER_MINUTE) * 1.6 * 1000) / 1000)}s)\n`,
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await fireLead(businesses);

    const wait = nextIntervalMs();
    console.log(`    [SIM] next lead in ${(wait / 1000).toFixed(1)}s\n`);
    await sleep(wait);
  }
}

/* ── Main ────────────────────────────────────────────────── */

async function main() {
  const businesses = await prisma.business.findMany({
    select: { id: true, slug: true, name: true },
  });

  if (!businesses.length) {
    console.error('[SIM] No businesses found in the database. Run the seed first.');
    process.exit(1);
  }

  console.log(`[SIM] Loaded ${businesses.length} businesses.`);
  console.log(`[SIM] BASE_URL  : ${BASE_URL}`);
  console.log(`[SIM] BURST_MODE: ${BURST_MODE}`);
  console.log(`[SIM] ANALYSE   : ${ANALYSE_AFTER}\n`);

  if (BURST_MODE) {
    await runBurst(businesses);
    await prisma.$disconnect();
  } else {
    await runContinuous(businesses);   // exits only on SIGINT
  }
}

/* ── Graceful shutdown ───────────────────────────────────── */

process.on('SIGINT', async () => {
  console.log('\n[SIM] Caught SIGINT — shutting down gracefully…');
  await prisma.$disconnect();
  process.exit(0);
});

main().catch(async (err) => {
  console.error('[SIM] Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
