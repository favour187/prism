import rateLimit from 'express-rate-limit';
import config from '../config.js';

const json429 = (res, _req, next, options) => {
  res.status(options.statusCode).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests — slow down a little and retry.' },
  });
};

export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.apiMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.chatMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.uploadMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});
