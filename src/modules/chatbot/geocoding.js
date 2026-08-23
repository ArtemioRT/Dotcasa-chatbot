// ============================================================================
// GEOCODING — Mapbox, caché, parseo de coordenadas y clasificación
// ============================================================================
import axios from 'axios';
import { MAPBOX_ACCESS_TOKEN } from '../../shared/config.js';
import { normalizeSearchText, parseBubbleNumber } from '../../shared/utils.js';

const geoCache = new Map();
const locationTypeCache = new Map();

const MAPBOX_GEOCODE_URL = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

export const MONTERREY_METRO_HINTS = [
  'cumbres', 'monterrey', 'san pedro', 'guadalupe', 'apodaca',
  'santa catarina', 'san nicolas', 'escobedo'
];

// Centro aproximado del área metropolitana de Monterrey, usado como sesgo de
// proximidad en Mapbox para desambiguar colonias/lugares con nombres comunes.
const MONTERREY_PROXIMITY = [-100.3161, 25.6866]; // [lng, lat]

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Legacy: algunos registros viejos de Bubble aún pueden traer "lat,lng" en
// vez de una dirección formateada. Se conserva como fallback de parseo.
export function parseLocacion(locacion) {
  if (!locacion || typeof locacion !== 'string') return null;
  const parts = locacion.split(',').map(s => s.trim());
  if (parts.length === 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
    return null;
  }
  if (parts.length === 4) {
    const lat = parseFloat(parts[0] + '.' + parts[1]);
    const lng = parseFloat(parts[2] + '.' + parts[3]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
    return null;
  }
  return null;
}

// Extrae Latitud/Longitud numéricas directas de una propiedad de Bubble.
export function parsePropertyCoords(prop) {
  const lat = parseBubbleNumber(prop?.['Latitud'] ?? prop?.['latitud']);
  const lng = parseBubbleNumber(prop?.['Longitud'] ?? prop?.['longitud']);
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  // Fallback a registros legacy donde Locación aún trae "lat,lng"
  return parseLocacion(prop?.['Locación'] || prop?.['Locacion'] || prop?.['locacion']);
}

export function buildGeocodeQuery(locacion) {
  let query = String(locacion || '').trim().replace(/\s+/g, ' ');
  const normalized = normalizeSearchText(query);
  if (MONTERREY_METRO_HINTS.some(hint => normalized.includes(hint)) && !normalized.includes('nuevo leon')) {
    query = `${query}, Nuevo León`;
  }
  return query;
}

function shouldBiasToMonterrey(query) {
  const normalized = normalizeSearchText(query);
  return MONTERREY_METRO_HINTS.some(hint => normalized.includes(hint));
}

export async function geocodeLocation(locacion) {
  if (!locacion) return null;
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error('Geocoding error: MAPBOX_ACCESS_TOKEN no configurado');
    return null;
  }
  const directCoords = parseLocacion(locacion);
  if (directCoords) return { ...directCoords, displayName: locacion };
  const query = buildGeocodeQuery(locacion);
  if (geoCache.has(query)) return geoCache.get(query);
  try {
    const res = await axios.get(`${MAPBOX_GEOCODE_URL}/${encodeURIComponent(query)}.json`, {
      params: {
        access_token: MAPBOX_ACCESS_TOKEN,
        country: 'mx',
        language: 'es',
        limit: 1,
        ...(shouldBiasToMonterrey(query) ? { proximity: MONTERREY_PROXIMITY.join(',') } : {})
      },
      timeout: 8000
    });
    const feature = res.data?.features?.[0];
    if (!feature) return null;
    const [lng, lat] = feature.center;
    const coords = {
      lat, lng,
      displayName: feature.place_name,
      context: feature.context || []
    };
    geoCache.set(query, coords);
    return coords;
  } catch (err) {
    console.error('Geocoding error:', err.response?.data?.message || err.message);
    return null;
  }
}

function classifyMapboxFeature(feature) {
  const types = feature?.place_type || [];
  if (types.includes('region')) return 'estado';
  if (types.includes('place') || types.includes('locality')) return 'ciudad';
  if (types.includes('neighborhood') || types.includes('district') || types.includes('address') || types.includes('poi')) return 'colonia';
  return 'colonia';
}

export async function classifyLocationPartMapbox(part) {
  const key = normalizeSearchText(part);
  if (!key) return 'colonia';
  if (locationTypeCache.has(key)) return locationTypeCache.get(key);
  if (!MAPBOX_ACCESS_TOKEN) return 'colonia';
  try {
    const res = await axios.get(`${MAPBOX_GEOCODE_URL}/${encodeURIComponent(part)}.json`, {
      params: {
        access_token: MAPBOX_ACCESS_TOKEN,
        country: 'mx',
        language: 'es',
        limit: 1,
        types: 'region,place,locality,district,neighborhood,address',
        ...(shouldBiasToMonterrey(part) ? { proximity: MONTERREY_PROXIMITY.join(',') } : {})
      },
      timeout: 8000
    });
    const feature = res.data?.features?.[0];
    const classification = feature ? classifyMapboxFeature(feature) : 'colonia';
    locationTypeCache.set(key, classification);
    return classification;
  } catch (err) {
    console.error(`Error clasificando "${part}":`, err.response?.data?.message || err.message);
    locationTypeCache.set(key, 'colonia');
    return 'colonia';
  }
}

export async function parseLocacionSmart(locacion) {
  const result = { colonia: [], ciudad: [], estado: [] };
  if (!locacion || typeof locacion !== 'string') return result;
  const parts = locacion.split(',').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return result;
  if (parseLocacion(parts.join(','))) return result;
  const classifications = await Promise.all(parts.map(p => classifyLocationPartMapbox(p)));
  parts.forEach((part, idx) => {
    const tipo = classifications[idx];
    if (result[tipo]) result[tipo].push(part);
  });
  if (!result.estado.length && !result.ciudad.length && result.colonia.length) {
    result.ciudad = result.colonia;
    result.colonia = [];
  }
  return result;
}
