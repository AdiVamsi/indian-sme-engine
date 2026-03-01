const { z } = require("zod");
const servicesService = require("../services/services.service");

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priceInr: z.number().int().optional(),
});

exports.create = async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const service = await servicesService.createService(
    req.user.businessId,
    parsed.data
  );

  res.status(201).json(service);
};

exports.list = async (req, res) => {
  const services = await servicesService.listServices(req.user.businessId);
  res.json(services);
};

exports.update = async (req, res) => {
  const result = await servicesService.updateService(
    req.user.businessId,
    req.params.id,
    req.body
  );

  if (result.count === 0) return res.status(404).json({ error: "Not found" });

  res.json({ updated: true });
};

exports.remove = async (req, res) => {
  const result = await servicesService.deleteService(
    req.user.businessId,
    req.params.id
  );

  if (result.count === 0) return res.status(404).json({ error: "Not found" });

  res.status(204).send();
};