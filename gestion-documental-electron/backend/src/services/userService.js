const bcrypt = require('bcrypt');
const { db } = require('../db/db');

function findUserByUsername(username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

module.exports = {
  findUserByUsername,
  verifyPassword,
};
