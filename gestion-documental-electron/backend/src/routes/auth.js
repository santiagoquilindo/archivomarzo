const express = require('express');
const jwt = require('jsonwebtoken');
const { findUserByUsername, verifyPassword } = require('../services/userService');
const { tokenSecret } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Usuario y contraseña son requeridos' });
  }

  try {
    console.log('Login request body:', { username, password });
    const user = await findUserByUsername(username);
    console.log('User fetched:', user);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
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

    res.json({ message: 'Login exitoso', user: payload });
  } catch (error) {
    console.error('Error login:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logout exitoso' });
});

module.exports = router;
