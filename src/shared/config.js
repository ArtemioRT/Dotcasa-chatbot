// ============================================================================
// CONFIG — dotcasa-chatbot
// ============================================================================
import 'dotenv/config';

export const PORT = process.env.PORT || 3000;
export const IS_PROD = process.env.NODE_ENV === 'production';

// Marca de build: se imprime al arrancar para saber de un vistazo qué versión
// está corriendo realmente en Cloud Run. Súbela cuando cambies algo relevante.
export const APP_VERSION = '1.3.2';
export const BUILD_TAG   = 'guardrails-multilingue+m2-rango+destacados';

export const BUBBLE_SEARCH_URL     = process.env.BUBBLE_SEARCH_URL;
export const OPENAI_API_KEY        = process.env.OPENAI_API_KEY;
export const MAPBOX_ACCESS_TOKEN   = process.env.MAPBOX_ACCESS_TOKEN;

// ---------------------------------------------------------------------------
// GCS — volcado de payloads de Bubble para diagnóstico
// ---------------------------------------------------------------------------
export const GCS_BUCKET_NAME   = process.env.GCS_BUCKET_NAME   || 'dotcasa-fotos-prod';
export const DEBUG_DUMP_PREFIX = process.env.DEBUG_DUMP_PREFIX || 'debug-bubble-json';
// Por defecto solo se vuelca cuando el parseo falla. Ponlo en 'always' para
// guardar todas las respuestas, o 'off' para desactivarlo por completo.
export const DEBUG_DUMP_MODE   = process.env.DEBUG_DUMP_MODE   || 'on-error';

// Bitácora de cada petición a /chat: guarda entrada y salida en GCS para poder
// auditar qué parámetros llegan y qué se responde.
//   'on'  -> guarda todas las peticiones (default)
//   'off' -> desactivado
export const CHAT_LOG_MODE   = process.env.CHAT_LOG_MODE   || 'on';
export const CHAT_LOG_PREFIX = process.env.CHAT_LOG_PREFIX || 'chat-logs';

// Formato con el que viajan Ciudad/Estado/Colonia a Bubble. Depende de cómo
// esté armado el constraint del workflow:
//   'json'  -> ["Monterrey"]   (si el workflow parsea JSON, como tipoInmueble)
//   'plain' -> Monterrey       (si el constraint es Ciudad = <param>)
//   'csv'   -> Monterrey,San Pedro
export const BUBBLE_ADMIN_FORMAT = process.env.BUBBLE_ADMIN_FORMAT || 'json';

// Si el workflow de Bubble ya tiene los parámetros M2_cons_max y
// M2_terreno_max, pon BUBBLE_M2_MAX=true para mandarlos. Mientras tanto, el
// máximo se aplica solo en el filtro local del backend.
export const BUBBLE_M2_MAX = process.env.BUBBLE_M2_MAX === 'true';

export const MIN_RESULTS_THRESHOLD  = 3;
export const MIN_VISIBLE_TARGET     = 15;
export const INITIAL_DISPLAY_COUNT  = 3;
export const MAX_PROPERTIES_TO_SHOW = 20;

// Cada cuántos minutos rotan las propiedades destacadas (Destacado = "yes").
export const DESTACADOS_ROTACION_MIN = 15;
// Las propiedades NO destacadas rotan solo entre las de score similar: este es
// el rango de puntos que se considera "similar" (más grande = más rotación).
// Con 1 solo se turnan las que empatan de verdad (mismo punto de referencia,
// mismas características); con 5 casi todo el resultado caía en un solo bloque
// y la propiedad más cercana quedaba en el lugar 9.
export const DESTACADOS_BLOQUE_SCORE = 1;