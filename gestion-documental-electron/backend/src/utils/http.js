class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function sendSuccess(res, payload = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...payload,
  });
}

function sendError(res, error, fallbackMessage = 'Error interno del servidor') {
  const statusCode = error?.statusCode || 500;
  const message = error?.message || fallbackMessage;
  const response = {
    success: false,
    message,
  };

  if (error?.code) {
    response.code = error.code;
  }

  if (error?.details) {
    response.details = error.details;
  }

  return res.status(statusCode).json(response);
}

function parseId(value, fieldName = 'id') {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(
      `El campo ${fieldName} debe ser un entero positivo`,
      400,
      'INVALID_ID',
    );
  }
  return parsed;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  AppError,
  sendSuccess,
  sendError,
  parseId,
  normalizeText,
};
