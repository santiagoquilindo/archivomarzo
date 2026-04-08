const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { AppError, sendError } = require('../utils/http');

function verifyToken(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    return sendError(
      res,
      new AppError('No autenticado', 401, 'UNAUTHENTICATED'),
    );
  }

  jwt.verify(token, JWT_SECRET, (error, decoded) => {
    if (error) {
      return sendError(
        res,
        new AppError('Token inválido', 401, 'INVALID_TOKEN'),
      );
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
      return sendError(
        res,
        new AppError('No autenticado', 401, 'UNAUTHENTICATED'),
      );
    }

    if (userRole !== requiredRole) {
      return sendError(
        res,
        new AppError('Acceso denegado', 403, 'FORBIDDEN'),
      );
    }

    next();
  };
}

module.exports = {
  verifyToken,
  requireRole,
  tokenSecret: JWT_SECRET,
};
