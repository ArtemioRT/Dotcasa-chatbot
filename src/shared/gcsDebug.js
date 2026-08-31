// ============================================================================
// GCS DEBUG — vuelca payloads crudos de Bubble a Cloud Storage
// ============================================================================
// El payload se sube TAL CUAL, sin cabeceras ni reformateo, para que las
// posiciones que reporta JSON.parse ("position 163556") coincidan exactamente
// con el archivo. El contexto (error, params, timestamp) va como metadata del
// objeto y también a los logs de Cloud Run.
// ============================================================================
import {
  GCS_BUCKET_NAME, DEBUG_DUMP_PREFIX, DEBUG_DUMP_MODE,
  CHAT_LOG_MODE, CHAT_LOG_PREFIX
} from './config.js';
import crypto from 'crypto';

let bucketPromise = null;

// Carga perezosa: si la librería o las credenciales no están, el servicio
// sigue funcionando y solo se pierde el volcado.
// No consulta DEBUG_DUMP_MODE: el volcado de payloads y la bitácora de /chat
// se activan por separado, y cada quien valida su propio interruptor.
async function getBucket() {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      try {
        const { Storage } = await import('@google-cloud/storage');
        return new Storage().bucket(GCS_BUCKET_NAME);
      } catch (err) {
        console.error(`GCS no disponible, se omite el volcado: ${err.message}`);
        return null;
      }
    })();
  }
  return bucketPromise;
}

function buildObjectName(etiqueta) {
  const now = new Date();
  const dia = now.toISOString().slice(0, 10);            // 2026-08-24
  const hora = now.toISOString().slice(11, 23).replace(/[:.]/g, '-'); // 17-25-57-169
  const sufijo = Math.random().toString(36).slice(2, 8);
  return `${DEBUG_DUMP_PREFIX}/${dia}/${hora}_${etiqueta}_${sufijo}.txt`;
}

/**
 * Sube un payload crudo a GCS. Nunca lanza: ante cualquier fallo devuelve null
 * y lo reporta por consola, para no tumbar la petición que lo originó.
 */
export async function dumpPayloadToGCS(payload, { etiqueta = 'payload', contexto = {} } = {}) {
  if (DEBUG_DUMP_MODE === 'off') return null;
  try {
    const bucket = await getBucket();
    if (!bucket) return null;

    const objectName = buildObjectName(etiqueta);
    const contenido = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

    // La metadata de GCS solo acepta strings.
    const metadata = {};
    for (const [k, v] of Object.entries(contexto)) {
      if (v != null) metadata[k] = String(v).slice(0, 1000);
    }

    await bucket.file(objectName).save(contenido, {
      contentType: 'text/plain; charset=utf-8',
      resumable: false,
      metadata: { metadata }
    });

    const gsUri = `gs://${GCS_BUCKET_NAME}/${objectName}`;
    console.log(`Payload volcado a ${gsUri} (${contenido.length} chars)`);
    return gsUri;
  } catch (err) {
    console.error(`Error volcando payload a GCS: ${err.message}`);
    return null;
  }
}

export function dumpEnabled(huboError) {
  if (DEBUG_DUMP_MODE === 'off') return false;
  if (DEBUG_DUMP_MODE === 'always') return true;
  return Boolean(huboError);
}

// ---------------------------------------------------------------------------
// Bitácora de peticiones a /chat
// ---------------------------------------------------------------------------
// Entrada y salida van a carpetas distintas del bucket, unidas por requestId:
//   <prefijo>/requests/<fecha>/<hora>_<requestId>.json
//   <prefijo>/responses/<fecha>/<hora>_<requestId>.json

export const chatLogEnabled = () => CHAT_LOG_MODE !== 'off';

export function newRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

function chatObjectName(carpeta, requestId) {
  const now = new Date();
  const dia  = now.toISOString().slice(0, 10);
  const hora = now.toISOString().slice(11, 23).replace(/[:.]/g, '-');
  return `${CHAT_LOG_PREFIX}/${carpeta}/${dia}/${hora}_${requestId}.json`;
}

// Guarda un JSON en el bucket. Nunca lanza: una falla de auditoría no debe
// tumbar la petición que la originó.
async function saveJson(carpeta, requestId, contenido) {
  if (!chatLogEnabled()) return null;
  try {
    const bucket = await getBucket();
    if (!bucket) return null;
    const objectName = chatObjectName(carpeta, requestId);
    await bucket.file(objectName).save(JSON.stringify(contenido, null, 2), {
      contentType: 'application/json; charset=utf-8',
      resumable: false,
      metadata: { metadata: { requestId } }
    });
    return `gs://${GCS_BUCKET_NAME}/${objectName}`;
  } catch (err) {
    console.error(`Error guardando ${carpeta} en GCS: ${err.message}`);
    return null;
  }
}

export function logChatRequest(requestId, entrada) {
  return saveJson('requests', requestId, {
    requestId,
    timestamp: new Date().toISOString(),
    ...entrada
  });
}

export function logChatResponse(requestId, salida) {
  return saveJson('responses', requestId, {
    requestId,
    timestamp: new Date().toISOString(),
    ...salida
  });
}
