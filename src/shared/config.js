// ============================================================================
// CONFIG — dotcasa-chatbot (sin GCS)
// ============================================================================
import 'dotenv/config';

export const PORT = process.env.PORT || 3000;
export const IS_PROD = process.env.NODE_ENV === 'production';

export const BUBBLE_SEARCH_URL = process.env.BUBBLE_SEARCH_URL;
export const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
export const NOMINATIM_UA      = 'DotCasa-Chatbot/2.0';

export const MIN_RESULTS_THRESHOLD  = 3;
export const MIN_VISIBLE_TARGET     = 15;
export const INITIAL_DISPLAY_COUNT  = 3;
export const MAX_PROPERTIES_TO_SHOW = 20;
