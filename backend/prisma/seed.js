'use strict';

/**
 * seed.js — SME Engine demo data seed
 *
 * Preserves the two primary businesses (upsert).
 * Wipes and recreates 10 demo businesses with realistic leads + activities.
 *
 * Run:  npx prisma db seed
 *       cd backend && npm run prisma:seed
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { getAgentConfigPreset } = require('../src/constants/agentConfig.presets');

const prisma = new PrismaClient();

/* ── Deterministic helpers ──────────────────────────────────────────────── */
function pick(arr)         { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max)    { return Math.floor(Math.random() * (max - min + 1)) + min; }

/** Random Date in the past, between minDays and maxDays ago. */
function randDate(minDays, maxDays) {
  return new Date(
    Date.now()
      - rand(minDays, maxDays) * 86_400_000
      - rand(0, 82_800_000), // random hour offset
  );
}

/* ── Sample content pools ───────────────────────────────────────────────── */
const FIRST_NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Arjun', 'Pooja',
  'Rahul', 'Kavya', 'Amit', 'Nisha', 'Sanjay', 'Divya', 'Mohit', 'Sakshi',
  'Deepak', 'Meera', 'Raj', 'Simran', 'Kiran', 'Riya', 'Suresh', 'Isha',
  'Anil', 'Neha', 'Pankaj', 'Shruti', 'Vijay', 'Manisha', 'Gaurav', 'Shweta',
  'Harsh', 'Preeti', 'Nikhil', 'Komal', 'Ravi', 'Pallavi', 'Tarun', 'Anjali',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Verma', 'Mishra', 'Joshi',
  'Shah', 'Yadav', 'Mehta', 'Nair', 'Reddy', 'Chauhan', 'Tiwari', 'Pandey',
  'Bansal', 'Agarwal', 'Malhotra', 'Kapoor', 'Bose', 'Iyer', 'Pillai', 'Rajan',
];

const MESSAGES = [
  'I want admission details for your course.',
  'Can I book a demo class? Please let me know.',
  'I need to join immediately, what is the process?',
  'What are the fees for the program?',
  'Please call me regarding the enrollment.',
  'Looking for more information about your services.',
  'Can I get a free trial session?',
  'I saw your ad and want to know more details.',
  'My daughter wants to join. What are the timings?',
  'I am interested in the batch starting next month.',
  'Is there a discount for early registration?',
  'Please send me the brochure on WhatsApp.',
  'I want to know about the faculty and curriculum.',
  'What is the batch size? I prefer small groups.',
  'I want to speak with someone on call, please.',
  'Interested in the weekend batch only.',
  'Do you offer online classes as well?',
  'I heard great reviews, want to enroll ASAP.',
  'Is there a trial class before full enrollment?',
  'My son needs coaching urgently for entrance exams.',
  'Looking for a demo before committing to the course.',
  'What results have your students achieved?',
  'Can you share the schedule for next month?',
  'I want to join today itself if possible.',
  'Please contact me ASAP, very urgent.',
];

/* Realistic coaching-centre enquiry messages.
   Deliberately exercise the expanded academy preset tags:
   ADMISSION, FEE_ENQUIRY, DEMO_REQUEST, BATCH_TIMING,
   WHATSAPP_REQUEST, SCHOLARSHIP_ENQUIRY, COURSE_INFO. */
const ACADEMY_MESSAGES = [
  'My son is in Class 12, targeting JEE Advanced 2026. What are the batch timings and fees?',
  'Please WhatsApp me the fee structure and batch schedule for JEE Main.',
  'Looking for IIT coaching for my daughter. She is aiming for JEE Advanced next year.',
  'What are the morning batch timings? My son can only attend before 9 AM.',
  'Is there a scholarship or concession available for merit students?',
  'We want a demo class before enrolling. When is the next one scheduled?',
  'My daughter scored 96% in Class 10 boards. Which batch should she join?',
  'Urgent — need to enroll before March end. What is the admission process?',
  'Can you send the syllabus and study material details on WhatsApp?',
  'What is the batch size? We prefer small groups with individual attention.',
  'My son is a dropper, targeting JEE 2026. Do you have a dedicated drop-year batch?',
  'How many students cleared IIT from your academy last year? Please share results.',
  'Is there an evening or weekend batch for students still attending school?',
  'Please call me. I want to understand the JEE Advanced programme in detail.',
  'What is the fee for the JEE Advanced 2-year programme? Is there a sibling discount?',
  'I heard about your 99 percentile results. Want to know more about the programme.',
  'Want to book a free trial class. What are the upcoming dates?',
  'My son needs coaching urgently, Class 12 boards are approaching fast.',
  'Can I speak with one of the faculty members before making a decision?',
  'Please send your brochure on WhatsApp. We are comparing two institutes.',
  'My son finished Class 11 and wants to start intensive preparation. What batch fits?',
  'Is there a crash course option for students already in Class 12?',
  'We are three siblings interested in joining. Any concession for siblings?',
  'Looking for a demo session before I commit to a full-year programme.',
  'What chapters does the JEE Main batch cover in the first 3 months?',
];

const TAGS_POOL = [
  'DEMO_REQUEST', 'ADMISSION', 'FEE_ENQUIRY',
  'CALL_REQUEST', 'WHATSAPP_REQUEST', 'GENERAL_ENQUIRY', 'COURSE_INFO',
];

/* Weighted lead statuses — NEW is most common, WON least */
const STATUSES        = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];
const STATUS_WEIGHTS  = [0.35, 0.28, 0.18, 0.12, 0.07];

const AUTOMATION_TYPES = [
  'AUTOMATION_ALERT',
  'AUTOMATION_DEMO_INTENT',
  'AUTOMATION_ADMISSION_INTENT',
];

/* ── 10 demo businesses spanning all lifecycle stages ───────────────────── */
const DEMO_BUSINESSES = [
  {
    name: 'Fitness First Gym',
    slug: 'demo-fitness-first-mumbai',
    industry: 'gym',
    city: 'Mumbai',
    stage: 'SCALING',
    email: 'owner@demo-fitnessfirst.in',
    phone: '+91 98001 11001',
    address: 'Bandra West, Mumbai',
  },
  {
    name: 'Sunrise Dance Academy',
    slug: 'demo-sunrise-dance-delhi',
    industry: 'academy',
    city: 'Delhi',
    stage: 'AUTOMATION_ACTIVE',
    email: 'owner@demo-sunrisedance.in',
    phone: '+91 98001 11002',
    address: 'Lajpat Nagar, Delhi',
  },
  {
    name: 'Radiant Beauty Salon',
    slug: 'demo-radiant-salon-bangalore',
    industry: 'salon',
    city: 'Bangalore',
    stage: 'LEADS_ACTIVE',
    email: 'owner@demo-radiantsalon.in',
    phone: '+91 98001 11003',
    address: 'Koramangala, Bangalore',
  },
  {
    name: 'Spice Garden Restaurant',
    slug: 'demo-spice-garden-chennai',
    industry: 'restaurant',
    city: 'Chennai',
    stage: 'WEBSITE_LIVE',
    email: 'owner@demo-spicegarden.in',
    phone: '+91 98001 11004',
    address: 'T Nagar, Chennai',
  },
  {
    name: 'HealthPath Clinic',
    slug: 'demo-healthpath-hyderabad',
    industry: 'clinic',
    city: 'Hyderabad',
    stage: 'AUTOMATION_ACTIVE',
    email: 'owner@demo-healthpath.in',
    phone: '+91 98001 11005',
    address: 'Jubilee Hills, Hyderabad',
  },
  {
    name: 'TechMart Electronics',
    slug: 'demo-techmart-pune',
    industry: 'retail',
    city: 'Pune',
    stage: 'LEADS_ACTIVE',
    email: 'owner@demo-techmart.in',
    phone: '+91 98001 11006',
    address: 'FC Road, Pune',
  },
  {
    name: 'Harmony Music School',
    slug: 'demo-harmony-music-kolkata',
    industry: 'academy',
    city: 'Kolkata',
    stage: 'WEBSITE_DESIGN',
    email: 'owner@demo-harmonymusic.in',
    phone: '+91 98001 11007',
    address: 'Park Street, Kolkata',
  },
  {
    name: 'FlexZone Yoga Studio',
    slug: 'demo-flexzone-yoga-ahmedabad',
    industry: 'gym',
    city: 'Ahmedabad',
    stage: 'LEADS_ACTIVE',
    email: 'owner@demo-flexzone.in',
    phone: '+91 98001 11008',
    address: 'SG Highway, Ahmedabad',
  },
  {
    name: 'Bright Minds Coaching',
    slug: 'demo-bright-minds-jaipur',
    industry: 'academy',
    city: 'Jaipur',
    stage: 'AUTOMATION_ACTIVE',
    email: 'owner@demo-brightminds.in',
    phone: '+91 98001 11009',
    address: 'Malviya Nagar, Jaipur',
  },
  {
    name: 'Urban Threads Fashion',
    slug: 'demo-urban-threads-surat',
    industry: 'retail',
    city: 'Surat',
    stage: 'STARTING',
    email: 'owner@demo-urbanthreads.in',
    phone: '+91 98001 11010',
    address: 'Ring Road, Surat',
  },
];

/* ── Weighted random helpers ────────────────────────────────────────────── */
function randomStatus() {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < STATUSES.length; i++) {
    cum += STATUS_WEIGHTS[i];
    if (r < cum) return STATUSES[i];
  }
  return 'NEW';
}

function randomPhone() {
  return `+91 ${rand(70000, 99999)} ${rand(10000, 99999)}`;
}

/**
 * Builds LeadActivity rows for one lead.
 * Returns an array of plain objects ready for prisma.leadActivity.createMany().
 */
function buildActivities(leadId, status, bizStage, leadCreatedAt) {
  const acts = [];
  const tags          = [pick(TAGS_POOL)];
  const priorityScore = rand(5, 60);

  /* Always: classify + prioritize within the first 10 minutes */
  acts.push({
    leadId,
    type:      'AGENT_CLASSIFIED',
    message:   `Lead classified with tags: ${tags.join(', ')}`,
    metadata:  { tags },
    createdAt: new Date(leadCreatedAt.getTime() + rand(60_000, 180_000)),
  });

  acts.push({
    leadId,
    type:      'AGENT_PRIORITIZED',
    message:   `Priority score computed: ${priorityScore}`,
    metadata:  { priorityScore },
    createdAt: new Date(leadCreatedAt.getTime() + rand(200_000, 600_000)),
  });

  /* Status progression — one STATUS_CHANGED per status transition */
  if (status !== 'NEW') {
    const contactedAt = new Date(leadCreatedAt.getTime() + rand(1, 24) * 3_600_000);
    acts.push({
      leadId,
      type:      'STATUS_CHANGED',
      message:   'Status changed from NEW to CONTACTED',
      metadata:  { from: 'NEW', to: 'CONTACTED' },
      createdAt: contactedAt,
    });

    if (status === 'QUALIFIED' || status === 'WON' || status === 'LOST') {
      acts.push({
        leadId,
        type:      'STATUS_CHANGED',
        message:   `Status changed from CONTACTED to ${status}`,
        metadata:  { from: 'CONTACTED', to: status },
        createdAt: new Date(contactedAt.getTime() + rand(2, 48) * 3_600_000),
      });
    }
  }

  /* Automation events — AUTOMATION_ACTIVE / SCALING businesses get these */
  if (['AUTOMATION_ACTIVE', 'SCALING'].includes(bizStage) && Math.random() < 0.65) {
    acts.push({
      leadId,
      type:      pick(AUTOMATION_TYPES),
      message:   'Automation event triggered based on lead signal',
      metadata:  { auto: true, tag: tags[0], score: priorityScore },
      createdAt: new Date(leadCreatedAt.getTime() + rand(600_000, 1_800_000)),
    });
  }

  /* Follow-up scheduled — LEADS_ACTIVE and above, 30% chance */
  if (
    ['LEADS_ACTIVE', 'AUTOMATION_ACTIVE', 'SCALING'].includes(bizStage) &&
    Math.random() < 0.30
  ) {
    acts.push({
      leadId,
      type:    'FOLLOW_UP_SCHEDULED',
      message: 'Follow-up scheduled based on lead inactivity',
      metadata: {
        scheduledFor: new Date(
          leadCreatedAt.getTime() + rand(12, 48) * 3_600_000,
        ).toISOString(),
      },
      createdAt: new Date(leadCreatedAt.getTime() + rand(1_800_000, 3_600_000)),
    });
  }

  /* High-urgency leads get an SLA alert */
  if (priorityScore >= 40 && status === 'NEW' && Math.random() < 0.5) {
    acts.push({
      leadId,
      type:      'SLA_ALERT',
      message:   'High-priority lead has not been contacted within SLA window',
      metadata:  { priorityScore, slaMinutes: 60 },
      createdAt: new Date(leadCreatedAt.getTime() + rand(3_600_000, 7_200_000)),
    });
  }

  return acts;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* MAIN                                                                       */
/* ══════════════════════════════════════════════════════════════════════════ */
async function main() {
  /* ── 1. Preserve existing primary + demo businesses ──────────────────── */
  console.log('Upserting primary businesses...');

  const primaryBiz = await prisma.business.upsert({
    where: { slug: 'sharma-jee-academy-delhi' },
    update: {
      name: 'Sharma JEE Academy',
      phone: '+91 98765 43210',
      email: 'admin@sharmajeeacademy.in',
      address: 'Connaught Place, New Delhi',
      industry: 'academy', city: 'Delhi', country: 'India',
      timezone: 'Asia/Kolkata', currency: 'INR',
    },
    create: {
      name: 'Sharma JEE Academy', slug: 'sharma-jee-academy-delhi',
      phone: '+91 98765 43210', email: 'admin@sharmajeeacademy.in',
      address: 'Connaught Place, New Delhi',
      industry: 'academy', city: 'Delhi', country: 'India',
      timezone: 'Asia/Kolkata', currency: 'INR',
    },
  });

  const primaryPwHash = await bcrypt.hash('Admin@12345', 12);
  await prisma.user.upsert({
    where:  { businessId_email: { businessId: primaryBiz.id, email: 'owner@sharmajeeacademy.in' } },
    update: {
      name: 'Owner',
      passwordHash: primaryPwHash,
      role: 'OWNER',
    },
    create: {
      businessId: primaryBiz.id,
      name: 'Owner', email: 'owner@sharmajeeacademy.in',
      passwordHash: primaryPwHash, role: 'OWNER',
    },
  });

  /* Seed AgentConfig for primary business so expanded preset is active from first login */
  await prisma.agentConfig.upsert({
    where:  { businessId: primaryBiz.id },
    update: getAgentConfigPreset('academy'),
    create: { businessId: primaryBiz.id, ...getAgentConfigPreset('academy') },
  });

  const demoAcademy = await prisma.business.upsert({
    where: { slug: 'demo-academy' },
    update: {
      industry: 'academy', city: 'Mumbai', country: 'India',
      timezone: 'Asia/Kolkata', currency: 'INR',
    },
    create: {
      name: 'Demo Academy', slug: 'demo-academy',
      phone: '+91 98765 00000', email: 'demo@smeengine.com',
      address: 'Bandra West, Mumbai',
      industry: 'academy', city: 'Mumbai', country: 'India',
      timezone: 'Asia/Kolkata', currency: 'INR',
    },
  });

  const demoPwHash = await bcrypt.hash('Demo@123', 12);
  await prisma.user.upsert({
    where:  { businessId_email: { businessId: demoAcademy.id, email: 'demo@smeengine.com' } },
    update: {},
    create: {
      businessId: demoAcademy.id,
      name: 'Demo Owner', email: 'demo@smeengine.com',
      passwordHash: demoPwHash, role: 'OWNER',
    },
  });

  /* Seed AgentConfig for demo academy too */
  await prisma.agentConfig.upsert({
    where:  { businessId: demoAcademy.id },
    update: getAgentConfigPreset('academy'),
    create: { businessId: demoAcademy.id, ...getAgentConfigPreset('academy') },
  });

  /* ── 2. Wipe and recreate 10 demo businesses ─────────────────────────── */
  const demoSlugs = DEMO_BUSINESSES.map((b) => b.slug);
  console.log(`\nClearing ${demoSlugs.length} demo businesses...`);
  await prisma.business.deleteMany({ where: { slug: { in: demoSlugs } } });

  const ownerPwHash = await bcrypt.hash('Admin@12345', 12);

  let totalLeads      = 0;
  let totalActivities = 0;

  for (const biz of DEMO_BUSINESSES) {
    process.stdout.write(`  ${biz.name.padEnd(30)} [${biz.stage}] ... `);

    /* ── Business ── */
    const business = await prisma.business.create({
      data: {
        name:     biz.name,
        slug:     biz.slug,
        phone:    biz.phone,
        email:    biz.email,
        address:  biz.address,
        industry: biz.industry,
        city:     biz.city,
        country:  'India',
        timezone: 'Asia/Kolkata',
        currency: 'INR',
        stage:    biz.stage,
      },
    });

    /* ── Owner user ── */
    await prisma.user.create({
      data: {
        businessId:   business.id,
        name:         `${biz.name} Admin`,
        email:        biz.email,
        passwordHash: ownerPwHash,
        role:         'OWNER',
      },
    });

    /* ── Leads + activities ── */
    const leadCount   = rand(22, 38);
    const activityBuf = [];

    for (let i = 0; i < leadCount; i++) {
      const firstName = pick(FIRST_NAMES);
      const lastName  = pick(LAST_NAMES);
      const status    = randomStatus();
      const leadDate  = randDate(1, 29);

      const msgPool = biz.industry === 'academy' ? ACADEMY_MESSAGES : MESSAGES;

      const lead = await prisma.lead.create({
        data: {
          businessId: business.id,
          name:       `${firstName} ${lastName}`,
          phone:      randomPhone(),
          email:      `${firstName.toLowerCase()}.${lastName.toLowerCase()}${rand(10, 99)}@gmail.com`,
          message:    pick(msgPool),
          status,
          createdAt:  leadDate,
        },
      });

      totalLeads++;
      activityBuf.push(...buildActivities(lead.id, status, biz.stage, leadDate));
    }

    /* Batch-insert all activities for this business */
    if (activityBuf.length > 0) {
      await prisma.leadActivity.createMany({ data: activityBuf });
      totalActivities += activityBuf.length;
    }

    console.log(`${leadCount} leads, ${activityBuf.length} events`);
  }

  /* ── Summary ── */
  console.log('\n✓ Seed complete');
  console.log(`  Businesses : ${DEMO_BUSINESSES.length + 2} total (2 existing + ${DEMO_BUSINESSES.length} demo)`);
  console.log(`  Leads      : ${totalLeads}`);
  console.log(`  Activities : ${totalActivities}`);
  console.log('\n  Credentials (all demo businesses): Admin@12345');
  console.log('  Primary business: owner@sharmajeeacademy.in / Admin@12345');
  console.log('  Demo academy    : demo@smeengine.com / Demo@123');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
