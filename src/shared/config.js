// ============================================================================
// CONFIG — dotcasa-chatbot (sin GCS)
// ============================================================================
import 'dotenv/config';

export const PORT = process.env.PORT || 3000;
export const IS_PROD = process.env.NODE_ENV === 'production';

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

export const MIN_RESULTS_THRESHOLD  = 3;
export const MIN_VISIBLE_TARGET     = 15;
export const INITIAL_DISPLAY_COUNT  = 3;
export const MAX_PROPERTIES_TO_SHOW = 20;
