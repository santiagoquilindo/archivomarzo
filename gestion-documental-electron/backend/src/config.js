const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.APP_HOST || 'localhost';
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;
const JWT_SECRET =
  process.env.JWT_SECRET || 'cambio-por-archivo-seguro-en-produccion';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || isProduction;

module.exports = {
  IS_PRODUCTION: isProduction,
  PORT,
  HOST,
  BASE_URL,
  JWT_SECRET,
  COOKIE_SECURE,
  FRONTEND_PUBLIC_CONFIG: {
    BASE_URL,
  },
};
