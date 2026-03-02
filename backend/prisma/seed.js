const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.upsert({
    where: { slug: "sharma-jee-academy-delhi" },
    update: {
      industry: "academy",
      city:     "Delhi",
      country:  "India",
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
    create: {
      name:     "Sharma JEE Academy",
      slug:     "sharma-jee-academy-delhi",
      phone:    "+91 98765 43210",
      email:    "admin@sharmajeeacademy.in",
      address:  "Connaught Place, New Delhi",
      industry: "academy",
      city:     "Delhi",
      country:  "India",
      timezone: "Asia/Kolkata",
      currency: "INR",
    },
  });

  const passwordHash = await bcrypt.hash("Admin@12345", 12);

  await prisma.user.upsert({
    where: { businessId_email: { businessId: business.id, email: "owner@sharmajeeacademy.in" } },
    update: {},
    create: {
      businessId: business.id,
      name: "Owner",
      email: "owner@sharmajeeacademy.in",
      passwordHash,
      role: "OWNER",
    },
  });

  /* ── Demo business (for public landing page / demos) ── */
  const demoBusiness = await prisma.business.upsert({
    where: { slug: 'demo-academy' },
    update: {
      industry: 'academy',
      city:     'Mumbai',
      country:  'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
    create: {
      name:     'Demo Academy',
      slug:     'demo-academy',
      phone:    '+91 98765 00000',
      email:    'demo@smeengine.com',
      address:  'Bandra West, Mumbai',
      industry: 'academy',
      city:     'Mumbai',
      country:  'India',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
  });

  const demoPasswordHash = await bcrypt.hash('Demo@123', 12);

  await prisma.user.upsert({
    where: { businessId_email: { businessId: demoBusiness.id, email: 'demo@smeengine.com' } },
    update: {},
    create: {
      businessId: demoBusiness.id,
      name:       'Demo Owner',
      email:      'demo@smeengine.com',
      passwordHash: demoPasswordHash,
      role:       'OWNER',
    },
  });

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
