// ============================================================================
// LOCATION SEARCH — separa ubicación ADMINISTRATIVA (ciudad/estado/colonia)
// de ubicación GEOGRÁFICA (lat/lng + radio), y arma el plan de búsqueda.
// ============================================================================
// Regla central: una ciudad NO es un punto. "Propiedades en Monterrey" se
// resuelve filtrando el campo Ciudad, nunca con un radio arbitrario desde el
// centro geocodificado. El radio solo se usa cuando el usuario habla en
// términos de distancia ("a 5 km de", "cerca de aquí").
// ============================================================================
import { normalizeSearchText } from '../../shared/utils.js';

export const SEARCH_MODE = {
  RADIO:   'radio',    // geográfico: lat/lng + km
  COLONIA: 'colonia',  // administrativo: campo Colonia
  CIUDAD:  'ciudad',   // administrativo: campo Ciudad
  ESTADO:  'estado',   // administrativo: campo Estado
  NONE:    'none'      // sin ubicación
};

// Radio por defecto cuando el usuario pide cercanía sin dar un número.
export const DEFAULT_NEARBY_KM = 5;

// Alias comunes de estados mexicanos, para que "NL" y "Nuevo León" coincidan.
const ESTADO_ALIASES = new Map([
  ['nl', 'nuevo leon'], ['n l', 'nuevo leon'], ['nvo leon', 'nuevo leon'],
  ['edomex', 'estado de mexico'], ['cdmx', 'ciudad de mexico'],
  ['df', 'ciudad de mexico'], ['slp', 'san luis potosi'],
  ['bc', 'baja california'], ['bcs', 'baja california sur'],
  ['qroo', 'quintana roo'], ['tamps', 'tamaulipas'], ['coah', 'coahuila']
]);

export function normalizePlace(text) {
  const base = normalizeSearchText(text).replace(/[.]/g, '').trim();
  return ESTADO_ALIASES.get(base) || base;
}

// Ciudad/Estado/Colonia son multi-valor ("Monterrey o San Pedro"). Acepta
// string, array o JSON serializado y siempre devuelve un array limpio.
export function toPlaceList(value) {
  if (value == null) return [];
  let list = value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try { list = JSON.parse(raw); } catch { list = [raw]; }
    } else {
      list = [raw];
    }
  }
  if (!Array.isArray(list)) list = [list];
  return list.map(v => String(v).trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Coincidencia de colonia tolerante a variantes
// ---------------------------------------------------------------------------
// "Cumbres" debe encontrar "Cumbres Elite", "Cumbres 1er Sector", etc.
// Se prefiere prefijo (más preciso) y se cae a inclusión por token.
export function coloniaMatches(propColonia, queryColonia, { strict = true } = {}) {
  const prop  = normalizePlace(propColonia);
  const query = normalizePlace(queryColonia);
  if (!prop || !query) return false;
  if (prop === query) return true;
  if (strict) return prop.startsWith(`${query} `);
  return prop.includes(query);
}

function fieldOf(prop, ...keys) {
  for (const key of keys) {
    const val = prop?.[key];
    if (val != null && String(val).trim() !== '') return String(val);
  }
  return '';
}

export function getPropCiudad(prop)  { return fieldOf(prop, 'Ciudad', 'ciudad'); }
export function getPropEstado(prop)  { return fieldOf(prop, 'Estado', 'estado'); }
export function getPropColonia(prop) { return fieldOf(prop, 'Colonia', 'colonia'); }

// ---------------------------------------------------------------------------
// Filtro administrativo (texto sobre Ciudad / Estado / Colonia)
// ---------------------------------------------------------------------------
// Devuelve { properties, matchType }. matchType: 'exact' | 'relaxed' | 'none'.
// Semántica: OR dentro de cada campo (Monterrey O San Pedro), AND entre
// campos distintos (ciudad Monterrey Y colonia Cumbres).
export function filterByAdminLocation(properties, filtro = {}) {
  const ciudad  = toPlaceList(filtro.ciudad);
  const estado  = toPlaceList(filtro.estado);
  const colonia = toPlaceList(filtro.colonia);

  if (!properties.length) return { properties, matchType: 'none' };
  if (!ciudad.length && !estado.length && !colonia.length) {
    return { properties, matchType: 'not_requested' };
  }

  const matchAdmin = (prop, { strictColonia }) => {
    if (estado.length) {
      const propEstado = normalizePlace(getPropEstado(prop));
      if (propEstado && !estado.some(e => normalizePlace(e) === propEstado)) return false;
    }
    if (ciudad.length) {
      const propCiudad = normalizePlace(getPropCiudad(prop));
      if (propCiudad && !ciudad.some(c => normalizePlace(c) === propCiudad)) return false;
    }
    if (colonia.length) {
      const propColonia = getPropColonia(prop);
      if (!colonia.some(c => coloniaMatches(propColonia, c, { strict: strictColonia }))) return false;
    }
    return true;
  };

  const strict = properties.filter(p => matchAdmin(p, { strictColonia: true }));
  if (strict.length) return { properties: strict, matchType: 'exact' };

  // Segundo intento solo si hay colonia: aflojamos a inclusión por token
  // ("Cumbres" -> "Residencial Cumbres", "Villas de Cumbres").
  if (colonia.length) {
    const relaxed = properties.filter(p => matchAdmin(p, { strictColonia: false }));
    if (relaxed.length) return { properties: relaxed, matchType: 'relaxed' };
  }

  return { properties: [], matchType: 'none' };
}

// ---------------------------------------------------------------------------
// Herencia de ubicación entre turnos
// ---------------------------------------------------------------------------
// "Casa en Monterrey" -> "ahora de dos pisos" debe seguir siendo Monterrey.
// Confiar en que el modelo lo recuerde falla seguido, así que la última
// ubicación usada se recupera del historial y se reutiliza cuando el turno
// nuevo no menciona ninguna.
export function extractLastLocation(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role !== 'tool' || typeof msg.content !== 'string') continue;
    try {
      const criterios = JSON.parse(msg.content)?.busquedaCriterios;
      if (!criterios) continue;
      const ciudad  = toPlaceList(criterios.ciudad);
      const colonia = toPlaceList(criterios.colonia);
      const estado  = toPlaceList(criterios.estado);
      if (ciudad.length || colonia.length || estado.length) {
        return { ciudad, colonia, estado };
      }
    } catch { /* mensaje de tool no parseable, se ignora */ }
  }
  return null;
}

// Aplica la ubicación heredada solo si el turno actual no trae ninguna señal
// de ubicación propia (ni administrativa, ni radio, ni GPS, ni landmark).
export function inheritLocation(params, history) {
  const yaTiene = toPlaceList(params.Ciudad).length
    || toPlaceList(params.Colonia).length
    || toPlaceList(params.Estado).length
    || params.Locacion
    || params.usarUbicacionUsuario
    || params.km != null;
  if (yaTiene) return { params, heredada: null };

  const previa = extractLastLocation(history);
  if (!previa) return { params, heredada: null };

  return {
    params: {
      ...params,
      ...(previa.ciudad.length  ? { Ciudad: previa.ciudad }   : {}),
      ...(previa.colonia.length ? { Colonia: previa.colonia } : {}),
      ...(previa.estado.length  ? { Estado: previa.estado }   : {})
    },
    heredada: previa
  };
}

// ---------------------------------------------------------------------------
// Resolver de intención de ubicación
// ---------------------------------------------------------------------------
// Convierte lo que extrajo el LLM en una intención estructurada y decide el
// modo de búsqueda. No genera filtros de Bubble directamente.
export function resolveLocationIntent(params = {}, userLocation = {}) {
  const ciudad  = toPlaceList(params.Ciudad);
  const estado  = toPlaceList(params.Estado);
  const colonia = toPlaceList(params.Colonia);
  const km      = params.km != null ? Number(params.km) : null;
  const usarGPS = Boolean(params.usarUbicacionUsuario);
  const referenciaRaw = params.Locacion ? String(params.Locacion).trim() : null;

  const tieneAdmin = Boolean(ciudad.length || estado.length || colonia.length);
  const pidioDistancia = km != null || usarGPS;

  // Punto de referencia para modo geográfico. Con varios valores se usa el
  // primero: un radio necesita UN centro, no varios.
  let referencia = referenciaRaw;
  if (!referencia && !usarGPS) {
    referencia = [colonia[0], ciudad[0], estado[0]].filter(Boolean).join(', ') || null;
  }

  let mode;
  if (pidioDistancia) {
    // "a 5 km de X" / "cerca de aquí" -> geográfico
    mode = SEARCH_MODE.RADIO;
  } else if (colonia.length) {
    mode = SEARCH_MODE.COLONIA;
  } else if (ciudad.length) {
    mode = SEARCH_MODE.CIUDAD;
  } else if (estado.length) {
    mode = SEARCH_MODE.ESTADO;
  } else if (referenciaRaw) {
    // Landmark suelto ("cerca del Tec"): sin campo administrativo que filtrar,
    // se resuelve geográficamente con un radio por defecto.
    mode = SEARCH_MODE.RADIO;
  } else {
    mode = SEARCH_MODE.NONE;
  }

  return {
    mode,
    ciudad, estado, colonia,
    km: km != null ? km : (mode === SEARCH_MODE.RADIO ? DEFAULT_NEARBY_KM : null),
    kmExplicito: km != null,
    referencia,
    usarUbicacionUsuario: usarGPS,
    tieneAdmin,
    // Coordenadas del GPS del usuario, si aplican al modo radio.
    gpsCoords: usarGPS && userLocation?.lat && userLocation?.lon
      ? { lat: Number(userLocation.lat), lng: Number(userLocation.lon) }
      : null
  };
}

// ---------------------------------------------------------------------------
// Plan de búsqueda: cada intento es una ESTRATEGIA DISTINTA
// ---------------------------------------------------------------------------
// Repetir la misma query con otro radio solo suma latencia. Cada paso cambia
// qué se filtra, no solo cuánto.
export function buildSearchPlan(intent) {
  const { mode, ciudad, estado, colonia, km } = intent;
  const steps = [];

  if (mode === SEARCH_MODE.CIUDAD) {
    // 1) Ciudad exacta -> 2) ampliar al estado -> 3) geográfico desde el centro
    steps.push({ tipo: 'admin', ciudad, estado, etiqueta: 'ciudad exacta' });
    if (estado.length) steps.push({ tipo: 'admin', estado, etiqueta: 'ampliado a estado' });
    steps.push({ tipo: 'geo', km: 25, etiqueta: 'geográfico 25km desde centro de ciudad' });

  } else if (mode === SEARCH_MODE.COLONIA) {
    // 1) Colonia (+variantes) -> 2) geográfico cercano -> 3) ampliar a ciudad
    steps.push({ tipo: 'admin', colonia, ciudad, estado, etiqueta: 'colonia exacta' });
    steps.push({ tipo: 'geo', km: DEFAULT_NEARBY_KM, etiqueta: 'geográfico 5km desde colonia' });
    if (ciudad.length) steps.push({ tipo: 'admin', ciudad, estado, etiqueta: 'ampliado a ciudad' });

  } else if (mode === SEARCH_MODE.ESTADO) {
    steps.push({ tipo: 'admin', estado, etiqueta: 'estado' });

  } else if (mode === SEARCH_MODE.RADIO) {
    // 1) radio pedido -> 2) radio duplicado -> 3) caer a administrativo
    steps.push({ tipo: 'geo', km, etiqueta: `geográfico ${km}km` });
    steps.push({ tipo: 'geo', km: km * 2, etiqueta: `geográfico ampliado ${km * 2}km` });
    if (colonia.length || ciudad.length || estado.length) {
      steps.push({ tipo: 'admin', colonia, ciudad, estado, etiqueta: 'fallback administrativo' });
    }

  } else {
    steps.push({ tipo: 'none', etiqueta: 'sin ubicación' });
  }

  return steps;
}
