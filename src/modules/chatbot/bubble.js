// ============================================================================
// BUBBLE — búsqueda de propiedades, parseo de respuesta y filtros
// ============================================================================
import axios from 'axios';
import { BUBBLE_SEARCH_URL, BUBBLE_ADMIN_FORMAT } from '../../shared/config.js';
import { httpsAgent } from '../../shared/httpAgents.js';
import { normalizeComparableText, parseBubbleNumber } from '../../shared/utils.js';
import { dumpPayloadToGCS, dumpEnabled } from '../../shared/gcsDebug.js';
import { parsePropertyCoords, haversineKm } from './geocoding.js';

// Posición que reporta V8 en "... in JSON at position 163556".
function extraerPosicionError(mensaje) {
  const m = /position (\d+)/.exec(mensaje || '');
  return m ? Number(m[1]) : null;
}

// Recorta el texto alrededor del error para verlo directo en los logs, sin
// tener que abrir el volcado completo.
function recorteAlrededor(texto, pos, radio = 180) {
  if (pos == null || !texto) return null;
  const ini = Math.max(0, pos - radio);
  const fin = Math.min(texto.length, pos + radio);
  return {
    antes: texto.slice(ini, pos),
    despues: texto.slice(pos, fin),
    posicion: pos
  };
}

// Separa objetos JSON concatenados respetando strings y escapes, para poder
// parsearlos de uno en uno. Así un registro corrupto no invalida el resto.
function separarObjetos(texto) {
  const objetos = [];
  let profundidad = 0, inicio = -1, enString = false, escapado = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (escapado) { escapado = false; continue; }
    if (enString) {
      if (ch === '\\') escapado = true;
      else if (ch === '"') enString = false;
      continue;
    }
    if (ch === '"') { enString = true; continue; }
    if (ch === '{') { if (profundidad === 0) inicio = i; profundidad++; }
    else if (ch === '}') {
      profundidad--;
      if (profundidad === 0 && inicio !== -1) {
        objetos.push({ texto: texto.slice(inicio, i + 1), offset: inicio });
        inicio = -1;
      }
      if (profundidad < 0) profundidad = 0; // resincroniza ante basura suelta
    }
  }
  return objetos;
}

/**
 * Parsea la respuesta de Bubble con diagnóstico. Si el parseo completo falla,
 * intenta rescatar los objetos válidos uno por uno en vez de devolver nada.
 * Devuelve { properties, error, normalized, rescatadas, descartadas, recorte }.
 */
export function parseBubblePropertiesDetailed(raw) {
  if (Array.isArray(raw)) {
    return { properties: raw, error: null, normalized: null, rescatadas: 0, descartadas: 0, recorte: null };
  }
  if (typeof raw !== 'string') {
    return { properties: [], error: null, normalized: null, rescatadas: 0, descartadas: 0, recorte: null };
  }

  let normalized = raw.replace(/"(Proximidad|Latitud|Longitud)":\s*(-?\d+),(\d+)/g, '"$1":$2.$3');
  normalized = normalized.replace(/"(Proximidad|Latitud|Longitud)":\s*[\n\r]*\s*([},])/g, '"$1":null$2');
  normalized = normalized.replace(/"(Pisos|N_Banos|N_Habitaciones|Precio|M2_Terreno|M2_Construccion|Latitud|Longitud)":\s*""\s*([},])/g, '"$1":null$2');
  normalized = normalized.replace(/"(Antiguedad|Ciudad|Estado|Colonia)":\s*""\s*([},])/g, '"$1":null$2');

  try {
    return {
      properties: JSON.parse(`[${normalized}]`),
      error: null, normalized, rescatadas: 0, descartadas: 0, recorte: null
    };
  } catch (err) {
    // El wrapper "[" desplaza las posiciones en 1 respecto al texto normalizado.
    const posEnWrapper = extraerPosicionError(err.message);
    const pos = posEnWrapper != null ? Math.max(0, posEnWrapper - 1) : null;
    const recorte = recorteAlrededor(normalized, pos);

    console.error(`Bubble JSON parse error: ${err.message}`);
    if (recorte) {
      console.error(`  ...${recorte.antes.slice(-160)}`);
      console.error(`  >>> AQUÍ (pos ${recorte.posicion}) >>> ${recorte.despues.slice(0, 160)}...`);
    }

    // Rescate por objeto: se conserva todo lo que sí parsea.
    const objetos = separarObjetos(normalized);
    const properties = [];
    let descartadas = 0;
    for (const obj of objetos) {
      try {
        properties.push(JSON.parse(obj.texto));
      } catch (errObj) {
        descartadas++;
        if (descartadas <= 3) {
          console.error(`  Registro descartado en offset ${obj.offset}: ${errObj.message}`);
          console.error(`  Fragmento: ${obj.texto.slice(0, 240)}`);
        }
      }
    }
    console.error(`Rescate por objeto: ${properties.length} válidas, ${descartadas} descartadas de ${objetos.length}`);

    return { properties, error: err, normalized, rescatadas: properties.length, descartadas, recorte };
  }
}

// Envoltorio compatible: devuelve solo el array de propiedades.
export function parseBubbleProperties(raw) {
  return parseBubblePropertiesDetailed(raw).properties;
}

// onQuery: callback opcional que recibe el query string enviado, para que la
// bitácora pueda registrar exactamente qué se le pidió a Bubble.
export async function searchBubble(params, { onQuery } = {}) {
  const q = new URLSearchParams();
  if (params.tipoInmueble?.length)   q.append('tipoInmueble',   JSON.stringify(params.tipoInmueble));
  if (params.tipoOperación?.length)  q.append('tipoOperación',  JSON.stringify(params.tipoOperación));
  if (params.Habitaciones   != null) q.append('Habitaciones',   params.Habitaciones);
  if (params.Banos          != null) q.append('Banos',          params.Banos);
  if (params.Pisos          != null) q.append('Pisos',          params.Pisos);
  if (params.Precio_min     != null) q.append('Precio_min',     params.Precio_min);
  if (params.Precio_max     != null) q.append('Precio_max',     params.Precio_max);
  if (params.M2_cons_min    != null) q.append('M2_cons_min',    params.M2_cons_min);
  if (params.M2_terreno_min != null) q.append('M2_terreno_min', params.M2_terreno_min);
  // Ubicación administrativa. El formato depende de cómo esté hecho el
  // constraint en Bubble; ver BUBBLE_ADMIN_FORMAT en config.
  const formatAdmin = (valores) => {
    if (BUBBLE_ADMIN_FORMAT === 'plain') return String(valores[0]);
    if (BUBBLE_ADMIN_FORMAT === 'csv')   return valores.join(',');
    return JSON.stringify(valores);
  };
  if (params.Ciudad?.length)         q.append('Ciudad',         formatAdmin(params.Ciudad));
  if (params.Estado?.length)         q.append('Estado',         formatAdmin(params.Estado));
  if (params.Colonia?.length)        q.append('Colonia',        formatAdmin(params.Colonia));
  // Ubicación geográfica: solo se manda cuando la búsqueda es por distancia.
  if (params.LocacionBubble)         q.append('Locacion',       params.LocacionBubble);
  else if (params.Locacion)          q.append('Locacion',       params.Locacion);
  if (params.km            != null)  q.append('km',             params.km);
  if (params.exactMatch)             q.append('exactMatch',     params.exactMatch);

  // URLSearchParams codifica los espacios como '+' (formato de formulario) y
  // Bubble los toma literales: "Nuevo+León" no coincide con ningún estado.
  // Se convierten a %20, que es lo que espera un query string. Un '+' literal
  // ya viene como %2B, así que este reemplazo solo afecta espacios.
  // Los corchetes se dejan literales ([ ]) en vez de %5B/%5D, para que la URL
  // sea idéntica a la que ya se verificó que Bubble acepta.
  const queryString = q.toString()
    .replace(/\+/g, '%20')
    .replace(/%5B/g, '[')
    .replace(/%5D/g, ']');
  const url = `${BUBBLE_SEARCH_URL}?${queryString}`;
  // Solo el query string: la URL base puede llevar token y no debe ir a logs.
  console.log(`  -> Bubble query: ${queryString}`);
  if (typeof onQuery === 'function') onQuery(queryString);
  const res = await axios.get(url, { httpsAgent, timeout: 15000 });
  const data = res.data;
  const raw = data.response?.Propiedades || data.Propiedades;

  const parsed = parseBubblePropertiesDetailed(raw);
  let properties = parsed.properties;
  if (!properties.length && Array.isArray(data)) properties = data;

  // Volcado a GCS para inspeccionar el payload exacto que rompió el parseo.
  if (dumpEnabled(Boolean(parsed.error))) {
    const gsUri = await dumpPayloadToGCS(parsed.normalized ?? raw, {
      etiqueta: parsed.error ? 'parse-error' : 'ok',
      contexto: {
        error: parsed.error?.message,
        posicion: parsed.recorte?.posicion,
        rescatadas: parsed.rescatadas,
        descartadas: parsed.descartadas,
        totalCaracteres: typeof raw === 'string' ? raw.length : null,
        queryString: q.toString().slice(0, 900),
        url: BUBBLE_SEARCH_URL
      }
    });
    if (parsed.error && gsUri) {
      console.error(`Payload que falló disponible en: ${gsUri} (busca la posición ${parsed.recorte?.posicion ?? '?'})`);
    }
  }

  return properties;
}

export function getLocationTerms(locacion) {
  return String(locacion || '')
    .split(',')
    .map(part => normalizeComparableText(part))
    .filter(Boolean);
}

export function buildPropertyLocationHaystack(prop) {
  return normalizeComparableText([
    prop['Colonia'], prop['colonia'], prop['Ciudad'], prop['ciudad'],
    prop['Estado'], prop['estado'], prop['Locación'], prop['Locacion'],
    prop['locacion'], prop['Link'], prop['link']
  ].filter(Boolean).join(' '));
}

export function filterPropertiesByLocationText(properties, locacion) {
  const terms = getLocationTerms(locacion);
  if (!terms.length || !properties.length) {
    return { properties, matchType: terms.length ? 'none' : 'not_requested' };
  }
  const strictMatches = properties.filter(prop => {
    const haystack = buildPropertyLocationHaystack(prop);
    return terms.every(term => haystack.includes(term));
  });
  if (strictMatches.length) {
    console.log(`Texto ubicación: ${strictMatches.length}/${properties.length} COINCIDENCIA EXACTA con "${locacion}"`);
    return { properties: strictMatches, matchType: 'exact' };
  }
  if (terms.length === 1) {
    const singleTermMatches = properties.filter(prop => buildPropertyLocationHaystack(prop).includes(terms[0]));
    if (singleTermMatches.length) {
      return { properties: singleTermMatches, matchType: 'exact' };
    }
  }
  if (terms.length > 1) {
    const primaryTerm = terms[0];
    const primaryMatches = properties.filter(prop => buildPropertyLocationHaystack(prop).includes(primaryTerm));
    if (primaryMatches.length) {
      return { properties: primaryMatches, matchType: 'primary' };
    }
  }
  return { properties, matchType: 'none' };
}

// Anota Proximidad (km desde refCoords) sin descartar ninguna propiedad.
// Se usa en búsquedas por ciudad/estado, donde la pertenencia la define el
// match textual sobre Ciudad/Estado y el radio solo serviría para ordenar.
export function annotateProximity(properties, refCoords) {
  if (!refCoords) return properties;
  const annotated = properties.map(prop => {
    const existingProximity = parseBubbleNumber(prop['Proximidad'] ?? prop['proximidad']);
    if (existingProximity !== null && !isNaN(existingProximity)) {
      return { ...prop, Proximidad: parseFloat(existingProximity.toFixed(2)) };
    }
    const coords = parsePropertyCoords(prop);
    if (coords && coords.lat && coords.lng && !isNaN(coords.lat) && !isNaN(coords.lng)) {
      const d = haversineKm(refCoords.lat, refCoords.lng, coords.lat, coords.lng);
      if (!isNaN(d)) return { ...prop, Proximidad: parseFloat(d.toFixed(2)) };
    }
    return { ...prop, Proximidad: null };
  });
  annotated.sort((a, b) => (a.Proximidad ?? Infinity) - (b.Proximidad ?? Infinity));
  return annotated;
}

export function filterByProximity(properties, refCoords, radiusKm) {
  if (!refCoords) return properties.map(p => ({ ...p, Proximidad: null }));
  const filtered = [];
  for (const prop of properties) {
    const existingProximity = parseBubbleNumber(prop['Proximidad'] ?? prop['proximidad']);
    if (existingProximity !== null && !isNaN(existingProximity)) {
      if (existingProximity <= radiusKm) {
        filtered.push({ ...prop, Proximidad: parseFloat(existingProximity.toFixed(2)) });
      }
      continue;
    }
    const coords = parsePropertyCoords(prop);
    if (coords && coords.lat && coords.lng && !isNaN(coords.lat) && !isNaN(coords.lng)) {
      const d = haversineKm(refCoords.lat, refCoords.lng, coords.lat, coords.lng);
      if (!isNaN(d) && d <= radiusKm) {
        filtered.push({ ...prop, Proximidad: parseFloat(d.toFixed(2)) });
      }
    }
  }
  filtered.sort((a, b) => (a.Proximidad ?? Infinity) - (b.Proximidad ?? Infinity));
  return filtered;
}

export function getPropNum(prop, keys) {
  for (const key of keys) {
    const val = parseBubbleNumber(prop[key]);
    if (val !== null) return val;
  }
  return null;
}

export function validateCriteriaMatch(property, criteria, checkExact = false) {
  if (criteria.Habitaciones != null) {
    const habCount = getPropNum(property, ['N_Habitaciones', 'n_habitaciones', 'Habitaciones', 'habitaciones']);
    if (habCount !== null) {
      if (checkExact && habCount !== criteria.Habitaciones) return false;
      if (!checkExact && habCount < criteria.Habitaciones) return false;
    }
  }
  if (criteria.Banos != null) {
    const banoCount = getPropNum(property, ['N_Banos', 'n_banos', 'Banos', 'banos']);
    if (banoCount !== null) {
      if (checkExact && banoCount !== criteria.Banos) return false;
      if (!checkExact && banoCount < criteria.Banos) return false;
    }
  }
  if (criteria.Pisos != null) {
    const pisoCount = getPropNum(property, ['Pisos', 'pisos', 'N_pisos', 'n_pisos']);
    if (pisoCount !== null) {
      if (checkExact && pisoCount !== criteria.Pisos) return false;
      if (!checkExact && pisoCount < criteria.Pisos) return false;
    }
  }
  return true;
}
