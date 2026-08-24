// ============================================================================
// CONFIG — dotcasa-chatbot
// ============================================================================
import 'dotenv/config';

export const PORT = process.env.PORT || 3000;
export const IS_PROD = process.env.NODE_ENV === 'production';

// Marca de build: se imprime al arrancar para saber de un vistazo qué versión
// está corriendo realmente en Cloud Run. Súbela cuando cambies algo relevante.
export const APP_VERSION = '1.1.0';
export const BUILD_TAG   = 'rescate-parseo+volcado-gcs';

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

// Formato con el que viajan Ciudad/Estado/Colonia a Bubble. Depende de cómo
// esté armado el constraint del workflow:
//   'json'  -> ["Monterrey"]   (si el workflow parsea JSON, como tipoInmueble)
//   'plain' -> Monterrey       (si el constraint es Ciudad = <param>)
//   'csv'   -> Monterrey,San Pedro
export const BUBBLE_ADMIN_FORMAT = process.env.BUBBLE_ADMIN_FORMAT || 'json';

export const MIN_RESULTS_THRESHOLD  = 3;
export const MIN_VISIBLE_TARGET     = 15;
export const INITIAL_DISPLAY_COUNT  = 3;
export const MAX_PROPERTIES_TO_SHOW = 20;
