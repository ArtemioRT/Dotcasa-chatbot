// ============================================================================
// FUENTES — pre-carga de DM Serif Display en memoria RAM
// ============================================================================
import axios from 'axios';

let dmSerifBase64 = '';

export function getDmSerifBase64() { return dmSerifBase64; }
export function isFontLoaded() { return dmSerifBase64.length > 0; }

export async function preloadFonts() {
  try {
    console.log('⏳ Pre-cargando fuente corporativa desde Google Fonts a la memoria RAM...');
    const fontRes = await axios.get(
      'https://fonts.gstatic.com/s/dmserifdisplay/v15/-F62jX9CAaUx7As8Y9Dx_EDM7xxp08G3.woff2',
      { responseType: 'arraybuffer', timeout: 10000 }
    );
    dmSerifBase64 = Buffer.from(fontRes.data).toString('base64');
    console.log('✓ Fuente corporativa guardada en RAM de forma exitosa.');
  } catch (err) {
    console.warn('⚠️ No se pudo pre-cargar la fuente a la RAM. Se usará el fallback remoto:', err.message);
  }
}
