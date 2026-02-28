const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {
  const business = await prisma.business.upsert({
    where: { slug: "sharma-jee-academy-delhi" },
    update: {},
    create: {
      name: "Sharma JEE Academy",
      slug: "sharma-jee-academy-delhi",
      phone: "+91 98765 43210",
      email: "admin@sharmajeeacademy.in",
      address: "Delhi, India",
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

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
