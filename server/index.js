import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import config from './config.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import chatRouter from './routes/chat.js';
import conversationsRouter from './routes/conversations.js';
import uploadsRouter from './routes/uploads.js';
import systemRouter from './routes/system.js';
import { getProvider } from './providers/index.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- security headers --------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // small inline style attrs in the SPA
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// ---- CORS: same-origin by default; extra origins only when configured --------
if (config.corsOrigins.length) {
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Origin not allowed by CORS_ORIGINS'));
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );
}

// Screenshots arrive as data URLs inside JSON bodies → generous but bounded limit.
app.use(express.json({ limit: `${config.maxInlineImageMb * 4 + 2}mb` }));
app.use('/api', apiLimiter);

// ---- API routes ----------------------------------------------------------------
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api', systemRouter);
app.use('/api', notFoundApi);

// ---- static client (production build) -------------------------------------------
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

// ---- errors ----------------------------------------------------------------------
app.use(errorHandler);

const provider = getProvider();
app.listen(config.port, config.host, () => {
  console.log(`[prism] server listening on http://${config.host}:${config.port}`);
  console.log(
    `[prism] provider=${provider.id} ready=${provider.isReady()} chatModel=${config.featherless.chatModel}`,
  );
  if (!provider.isReady()) {
    console.warn(`[prism] WARNING: ${provider.notReadyReason()} Chat calls will return 503 until configured.`);
  }
});
