const jwt = require('jsonwebtoken');

const tokenSecret =
  process.env.JWT_SECRET || 'cambio-por-archivo-seguro-en-produccion';

function verifyToken(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No autenticado' });
  }

  jwt.verify(token, tokenSecret, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .json({ success: false, message: 'Token inválido' });
    }

    req.user = decoded;
    next();
  });
}

function requireRole(role) {
  return (req, res, next) => {
    const userRole = req.user?.role
      ? String(req.user.role).toLowerCase()
      : undefined;
    const requiredRole = String(role).toLowerCase();

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    if (userRole !== requiredRole) {
      return res
        .status(403)
        .json({ success: false, message: 'Acceso denegado' });
    }

    next();
  };
}

module.exports = {
  verifyToken,
  requireRole,
  tokenSecret,
};
