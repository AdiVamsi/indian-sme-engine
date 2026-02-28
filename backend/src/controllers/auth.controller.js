'use strict';

const { z } = require('zod');

const { findBusinessBySlug, findUserByBusinessAndEmail } = require('../services/auth.service');
const { compare } = require('../utils/hash');
const { sign } = require('../utils/jwt');

const loginSchema = z.object({
  businessSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

const login = async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.flatten() });
  }

  const { businessSlug, email, password } = result.data;

  try {
    const business = await findBusinessBySlug(businessSlug);
    if (!business) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = await findUserByBusinessAndEmail(business.id, email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = sign({ userId: user.id, businessId: business.id, role: user.role });

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      business: { id: business.id, name: business.name, slug: business.slug },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { login };
