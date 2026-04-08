const express = require('express');
const jwt = require('jsonwebtoken');
const {
  findUserByUsername,
  verifyPassword,
} = require('../services/userService');
const { tokenSecret } = require('../middleware/authMiddleware');
const {
  AppError,
  normalizeText,
  sendError,
  sendSuccess,
} = require('../utils/http');

const router = express.Router();

router.post('/login', async (req, res) => {
  const username = normalizeText(req.body?.username);
  const password = normalizeText(req.body?.password);

  if (!username || !password) {
    return sendError(
      res,
      new AppError(
        'Usuario y contraseña son requeridos',
        400,
        'MISSING_CREDENTIALS',
      ),
    );
  }

  try {
    const user = await findUserByUsername(username);

    if (!user || user.status !== 'active') {
      return sendError(
        res,
        new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS'),
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return sendError(
        res,
        new AppError('Credenciales inválidas', 401, 'INVALID_CREDENTIALS'),
      );
    }

    const payload = {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(payload, tokenSecret, { expiresIn: '8h' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    });

    return sendSuccess(res, { message: 'Login exitoso', user: payload });
  } catch (error) {
    console.error('Error login:', error.message);
    return sendError(res, error, 'Error del servidor');
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  return sendSuccess(res, { message: 'Logout exitoso' });
});

module.exports = router;
