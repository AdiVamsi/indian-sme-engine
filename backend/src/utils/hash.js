'use strict';

const bcrypt = require('bcrypt');

const compare = (plain, hashed) => bcrypt.compare(plain, hashed);

module.exports = { compare };
