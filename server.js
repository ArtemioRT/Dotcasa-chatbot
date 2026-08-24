// ============================================================================
// DOTCASA-CHATBOT — AI conversacional inmobiliario (GPT-4o-mini + Bubble)
// ============================================================================
// El logger va PRIMERO: parchea console.* a JSON estructurado en Cloud Run
// antes de que cualquier otro módulo escriba logs.
import { logger } from './src/shared/logger.js';
import express from 'express';
import cors from 'cors';
// Import de namespace a propósito: con imports nombrados, un config.js
// desactualizado revienta el arranque con SyntaxError antes de ejecutar nada.
// Así los campos que falten quedan en undefined y el servicio sigue vivo.
import * as config from './src/shared/config.js';

const PORT = config.PORT || 3000;
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
  // Banner de diagnóstico: confirma qué build corre y qué está configurado,
  // para no confundir una imagen vieja con un problema de código.
  // Si aparece "DESACTUALIZADO", el config.js desplegado no es el de este build.
  logger.info(`BUILD v${config.APP_VERSION ?? 'DESACTUALIZADO'} [${config.BUILD_TAG ?? 'config.js viejo'}]`);
  logger.info(
    `Config | Bubble:${config.BUBBLE_SEARCH_URL ? 'ok' : 'FALTA'}` +
    ` OpenAI:${config.OPENAI_API_KEY ? 'ok' : 'FALTA'}` +
    ` Mapbox:${config.MAPBOX_ACCESS_TOKEN ? 'ok' : 'FALTA'}` +
    ` | volcado:${config.DEBUG_DUMP_MODE ?? 'no configurado'}` +
    ` -> gs://${config.GCS_BUCKET_NAME ?? '?'}/${config.DEBUG_DUMP_PREFIX ?? '?'}/`
  );
});
