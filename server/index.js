import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import config from './config.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import chatRouter from './routes/chat.js';
import writeRouter from './routes/write.js';
import conversationsRouter from './routes/conversations.js';
import uploadsRouter from './routes/uploads.js';
import voiceRouter from './routes/voice.js';
import systemRouter from './routes/system.js';
import { getProvider } from './providers/index.js';
import store from './memory/store.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
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

app.use(express.json({ limit: `${config.maxInlineImageMb * 4 + 2}mb` }));
app.use('/api', apiLimiter);

app.use('/api/chat', chatRouter);
app.use('/api/write', writeRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/transcribe', voiceRouter);
app.use('/api', systemRouter);
app.use('/api', notFoundApi);

if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
}

app.use(errorHandler);

const provider = getProvider();
const server = app.listen(config.port, config.host, () => {
  console.log(`[prism] server listening on http://${config.host}:${config.port}`);
  console.log(
    `[prism] provider=${provider.id} ready=${provider.isReady()} chatModel=${config.featherless.chatModel}`,
  );
  if (!provider.isReady()) {
    console.warn(`[prism] WARNING: ${provider.notReadyReason()} Chat calls will return 503 until configured.`);
  }
});

function shutdown(signal) {
  console.log(`[prism] ${signal} received — shutting down gracefully.`);
  server.close(() => {
    try {
      store.close?.();
    } catch {
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
