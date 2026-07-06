// ============================================================================
// DOTCASA-CHATBOT — AI conversacional inmobiliario (GPT-4o-mini + Bubble)
// ============================================================================
// El logger va PRIMERO: parchea console.* a JSON estructurado en Cloud Run
// antes de que cualquier otro módulo escriba logs.
import { logger } from './src/shared/logger.js';
import express from 'express';
import cors from 'cors';
import { PORT } from './src/shared/config.js';
import chatbotRoutes from './src/modules/chatbot/chat.routes.js';

const app = express();

// ---------------------------------------------------------------------------
// Middleware global
// ---------------------------------------------------------------------------
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  req.setTimeout(60_000, () => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timeout (60s)' });
  });
  next();
});

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------
app.use(chatbotRoutes);

app.get('/health', (req, res) => res.json({ service: 'dotcasa-chatbot', status: 'ok' }));
app.get('/ping', (req, res) => res.send('pong'));

// ---------------------------------------------------------------------------
// Manejo de errores centralizado
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', path: req.path });
});

app.use((err, req, res, next) => {
  logger.error('Error no controlado', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Error interno del servidor', message: err.message });
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { error: reason?.message || String(reason), stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { error: err.message, stack: err.stack });
  process.exit(1);
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`dotcasa-chatbot inicializado en puerto ${PORT}`);
});
