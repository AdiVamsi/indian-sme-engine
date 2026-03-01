const { z } = require("zod");
const service = require("../services/testimonials.service");

const createSchema = z.object({
  customerName: z.string().min(1),
  text: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
});

exports.create = async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const testimonial = await service.createTestimonial(
    req.user.businessId,
    parsed.data
  );

  res.status(201).json(testimonial);
};

exports.list = async (req, res) => {
  const list = await service.listTestimonials(req.user.businessId);
  res.json(list);
};

exports.remove = async (req, res) => {
  const result = await service.deleteTestimonial(
    req.user.businessId,
    req.params.id
  );

  if (result.count === 0)
    return res.status(404).json({ error: "Not found" });

  res.status(204).send();
};