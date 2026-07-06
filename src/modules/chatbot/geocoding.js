// ============================================================================
// GEOCODING — Nominatim, caché, parseo de coordenadas y clasificación
// ============================================================================
import axios from 'axios';
import { NOMINATIM_UA } from '../../shared/config.js';
import { normalizeSearchText } from '../../shared/utils.js';

const geoCache = new Map();
const locationTypeCache = new Map();

export const MONTERREY_METRO_HINTS = [
  'cumbres', 'monterrey', 'san pedro', 'guadalupe', 'apodaca',
  'santa catarina', 'san nicolas', 'escobedo'
];

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

export function buildGeocodeQuery(locacion) {
  let query = String(locacion || '').trim().replace(/\s+/g, ' ');
  const normalized = normalizeSearchText(query);
  if (MONTERREY_METRO_HINTS.some(hint => normalized.includes(hint)) && !normalized.includes('nuevo leon')) {
    query = `${query}, Nuevo León`;
  }
  if (!normalizeSearchText(query).includes('mexico')) {
    query = `${query}, México`;
  }
  return query;
}

export async function geocodeLocation(locacion) {
  if (!locacion) return null;
  const directCoords = parseLocacion(locacion);
  if (directCoords) return { ...directCoords, displayName: locacion };
  const query = buildGeocodeQuery(locacion);
  if (geoCache.has(query)) {
    const cached = geoCache.get(query);
    return cached;
  }
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1, addressdetails: 1 },
      headers: { 'User-Agent': NOMINATIM_UA },
      timeout: 8000
    });
    if (!res.data?.length) return null;
    const r = res.data[0];
    const coords = {
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name,
      address: r.address || {}
    };
    geoCache.set(query, coords);
    return coords;
  } catch (err) {
    console.error('Geocoding error:', err.message);
    return null;
  }
}

export async function classifyLocationPartNominatim(part) {
  const key = normalizeSearchText(part);
  if (!key) return 'colonia';
  if (locationTypeCache.has(key)) return locationTypeCache.get(key);
  try {
    const query = `${part}, México`;
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1, addressdetails: 1, 'accept-language': 'es' },
      headers: { 'User-Agent': NOMINATIM_UA },
      timeout: 8000
    });
    if (!res.data?.length) {
      locationTypeCache.set(key, 'colonia');
      return 'colonia';
    }
    const r = res.data[0];
    const cls = r.class || '';
    const type = r.type || '';
    let classification = 'colonia';
    if (r.addresstype === 'state' || type === 'state' || (cls === 'boundary' && type === 'administrative' && r.address?.state && !r.address?.city && !r.address?.town)) {
      classification = 'estado';
    } else if ((cls === 'place' && ['city', 'town', 'village'].includes(type)) || ['city', 'town', 'village', 'municipality'].includes(r.addresstype)) {
      classification = 'ciudad';
    } else if ((cls === 'place' && ['suburb', 'neighbourhood', 'quarter', 'hamlet'].includes(type)) || ['suburb', 'neighbourhood', 'quarter'].includes(r.addresstype)) {
      classification = 'colonia';
    } else if (r.address?.state && !r.address?.city && !r.address?.town && !r.address?.suburb) {
      classification = 'estado';
    }
    locationTypeCache.set(key, classification);
    return classification;
  } catch (err) {
    console.error(`Error clasificando "${part}":`, err.message);
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
  const classifications = await Promise.all(parts.map(p => classifyLocationPartNominatim(p)));
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
