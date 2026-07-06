// ============================================================================
// LOGGER — Logs estructurados en JSON para Google Cloud Logging
//
// En Cloud Run (detectado por la variable K_SERVICE que GCloud inyecta solo)
// TODOS los console.log / warn / error se convierten automáticamente a JSON
// con "severity", así puedes filtrar en Cloud Logging con:
//
//   severity=ERROR
//   severity=ERROR AND jsonPayload.message=~"Job"
//
// En local (npm run dev) no pasa nada: sigues viendo tus logs normales
// con emojis y separadores, tal cual.
// ============================================================================

const SEVERITY_MAP = {
  log:   'INFO',
  info:  'INFO',
  warn:  'WARNING',
  error: 'ERROR',
  debug: 'DEBUG',
};

// Referencia al console.log ORIGINAL, antes de parchear — evita que el
// logger se envuelva a sí mismo (JSON dentro de JSON)
const rawLog = console.log.bind(console);

function serializeArg(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'object' && arg !== null) {
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  return String(arg);
}

function toStructured(severity, args) {
  return JSON.stringify({
    severity,
    message: args.map(serializeArg).join(' '),
    timestamp: new Date().toISOString(),
  });
}

// --- Auto-setup: parchea console.* solo cuando corre en Cloud Run ---
const IS_CLOUD_RUN = Boolean(process.env.K_SERVICE);

if (IS_CLOUD_RUN) {
  for (const [method, severity] of Object.entries(SEVERITY_MAP)) {
    console[method] = (...args) => rawLog(toStructured(severity, args));
  }
}

// --- Logger explícito para código nuevo (permite campos extra filtrables) ---
function emit(severity, message, extra = {}) {
  if (IS_CLOUD_RUN) {
    rawLog(JSON.stringify({ severity, message, ...extra, timestamp: new Date().toISOString() }));
  } else {
    const tag = severity === 'ERROR' ? '❌' : severity === 'WARNING' ? '⚠️ ' : 'ℹ️ ';
    const extras = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    rawLog(`${tag} ${message}${extras}`);
  }
}

export const logger = {
  info:  (message, extra) => emit('INFO', message, extra),
  warn:  (message, extra) => emit('WARNING', message, extra),
  error: (message, extra) => emit('ERROR', message, extra),
};
