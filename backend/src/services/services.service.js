const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

exports.createService = (businessId, data) => {
    return prisma.service.create({
        data: {
            businessId,
            title: data.title,
            description: data.description,
            priceInr: data.priceInr,
        },
    });
};

exports.listServices = (businessId) => {
    return prisma.service.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
    });
};

exports.updateService = (businessId, serviceId, data) => {
    return prisma.service.updateMany({
        where: { id: serviceId, businessId },
        data,
    });
};

exports.deleteService = (businessId, serviceId) => {
    return prisma.service.deleteMany({
        where: { id: serviceId, businessId },
    });
};