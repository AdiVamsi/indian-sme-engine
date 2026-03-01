const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

exports.createTestimonial = (businessId, data) => {
    return prisma.testimonial.create({
        data: {
            businessId,
            customerName: data.customerName,
            text: data.text,
            rating: data.rating,
        },
    });
};

exports.listTestimonials = (businessId) => {
    return prisma.testimonial.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
    });
};

exports.deleteTestimonial = (businessId, id) => {
    return prisma.testimonial.deleteMany({
        where: { id, businessId },
    });
};