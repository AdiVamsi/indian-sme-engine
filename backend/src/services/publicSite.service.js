'use strict';

const { prisma } = require('../lib/prisma');
const { getIndustryConfig } = require('../constants/industry.config');

function buildMetaDescription({ business, services = [], industryConfig = {} }) {
  const location = [business.city, business.country].filter(Boolean).join(', ');
  const serviceNames = services
    .slice(0, 3)
    .map((service) => service.title)
    .filter(Boolean);

  const parts = [];
  parts.push(location ? `${business.name} in ${location}` : business.name);

  if (serviceNames.length) {
    parts.push(`Explore ${serviceNames.join(', ')}`);
  } else if (industryConfig.label) {
    parts.push(`Discover ${industryConfig.label.toLowerCase()} offerings`);
  } else {
    parts.push('Send an enquiry to learn more about current offerings');
  }

  if (business.phone || business.email) {
    parts.push('Contact us directly or enquire online');
  }

  return `${parts.join('. ')}.`;
}

async function getPublicSiteDataBySlug(slug) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      email: true,
      address: true,
      industry: true,
      city: true,
      country: true,
      logoUrl: true,
    },
  });

  if (!business) return null;

  const [services, testimonials] = await Promise.all([
    prisma.service.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        priceInr: true,
      },
    }),
    prisma.testimonial.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        customerName: true,
        text: true,
        rating: true,
      },
    }),
  ]);

  const industryConfig = getIndustryConfig(business.industry);

  return {
    business,
    services,
    testimonials,
    industryConfig: {
      label: industryConfig.label,
      formCopy: industryConfig.formCopy || null,
    },
    publicFormPath: `/form/${business.slug}`,
    meta: {
      title: business.name,
      description: buildMetaDescription({ business, services, industryConfig }),
    },
  };
}

module.exports = { getPublicSiteDataBySlug };
