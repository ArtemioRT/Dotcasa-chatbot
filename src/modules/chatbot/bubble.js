// ============================================================================
// BUBBLE — búsqueda de propiedades, parseo de respuesta y filtros
// ============================================================================
import axios from 'axios';
import { BUBBLE_SEARCH_URL } from '../../shared/config.js';
import { httpsAgent } from '../../shared/httpAgents.js';
import { normalizeComparableText, parseBubbleNumber } from '../../shared/utils.js';
import { parseLocacion, haversineKm } from './geocoding.js';

export function parseBubbleProperties(raw) {
  if (typeof raw === 'string') {
    let normalized = raw.replace(/"Proximidad":\s*(-?\d+),(\d+)/g, '"Proximidad":$1.$2');
    normalized = normalized.replace(/"Proximidad":\s*[\n\r]*\s*([},])/g, '"Proximidad":null$1');
    normalized = normalized.replace(/"(Pisos|N_Banos|N_Habitaciones|Precio|M2_Terreno|M2_Construccion)":\s*""\s*([},])/g, '"$1":null$2');
    normalized = normalized.replace(/"(Antiguedad|Ciudad|Estado|Colonia)":\s*""\s*([},])/g, '"$1":null$2');
    try {
      const parsed = JSON.parse(`[${normalized}]`);
      return parsed;
    } catch (err) {
      console.error(`Bubble JSON parse error: ${err.message}`);
      try {
        const aggressive = normalized.replace(/"\w+":\s*[\n\r]*\s*([},])/g, '"_removed":null$1');
        const parsed = JSON.parse(`[${aggressive}]`);
        return parsed;
      } catch (err2) {
        return [];
      }
    }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

export async function searchBubble(params) {
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
  if (params.LocacionBubble)         q.append('Locacion',       params.LocacionBubble);
  else if (params.Locacion)          q.append('Locacion',       params.Locacion);
  if (params.km            != null)  q.append('km',             params.km);
  if (params.exactMatch)             q.append('exactMatch',     params.exactMatch);

  const url = `${BUBBLE_SEARCH_URL}?${q.toString()}`;
  const res = await axios.get(url, { httpsAgent, timeout: 15000 });
  const data = res.data;
  const raw = data.response?.Propiedades || data.Propiedades;

  let properties = parseBubbleProperties(raw);
  if (!properties.length && Array.isArray(data)) properties = data;

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
    const locRaw = prop['Locación'] || prop['Locacion'] || prop['locacion'] || null;
    if (!locRaw || locRaw === '' || locRaw === 'null') continue;
    const coords = parseLocacion(locRaw);
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
