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
  // Solo cuenta la búsqueda MÁS RECIENTE. Antes, si la última búsqueda fue
  // por GPS (sin ciudad ni colonia), se seguía buscando hacia atrás y se
  // revivía la zona de una búsqueda vieja que el usuario ya había dejado.
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role !== 'tool' || typeof msg.content !== 'string') continue;
    let resultado;
    try { resultado = JSON.parse(msg.content); } catch { continue; }
    const criterios = resultado?.busquedaCriterios;
    if (!criterios) continue;
    const ciudad  = toPlaceList(criterios.ciudad);
    const colonia = toPlaceList(criterios.colonia);
    const estado  = toPlaceList(criterios.estado);
    const gps = resultado.ubicacionGeocoded === GPS_DISPLAY_NAME;
    if (ciudad.length || colonia.length || estado.length || gps) {
      return { ciudad, colonia, estado, gps };
    }
    return null;
  }
  return null;
}

// Aplica la ubicación heredada solo si el turno actual no trae ninguna señal
// de ubicación propia (ni administrativa, ni radio, ni GPS, ni landmark).
// gpsDisponible: si la búsqueda anterior fue por GPS y ya no llegan
// coordenadas, no hay nada que heredar.
export function inheritLocation(params, history, { gpsDisponible = true } = {}) {
  const yaTiene = toPlaceList(params.Ciudad).length
    || toPlaceList(params.Colonia).length
    || toPlaceList(params.Estado).length
    || params.Locacion
    || params.usarUbicacionUsuario
    || params.km != null;
  if (yaTiene) return { params, heredada: null };

  const previa = extractLastLocation(history);
  if (!previa) return { params, heredada: null };

  // La búsqueda anterior fue "cerca de mí": se sigue buscando cerca de él.
  if (previa.gps && !previa.ciudad.length && !previa.colonia.length && !previa.estado.length) {
    if (!gpsDisponible) return { params, heredada: null };
    return { params: { ...params, usarUbicacionUsuario: true }, heredada: previa };
  }

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
// Qué dice el MENSAJE sobre la ubicación (sin depender del modelo)
// ---------------------------------------------------------------------------
// El modelo recibe la ubicación GPS en el prompt y el historial completo, y a
// veces mezcla: pone la colonia del GPS junto a la ciudad que el usuario
// escribió, marca usarUbicacionUsuario aunque el usuario nombró otra zona, o
// repite los argumentos de la búsqueda anterior. Estas funciones leen el texto
// del usuario para que lo que él escribió siempre gane.

// Texto con el que el front marca las búsquedas por GPS.
export const GPS_DISPLAY_NAME = 'Ubicación del usuario (GPS)';

const OWN_LOCATION_RE = new RegExp('\\b(' + [
  'cerca de mi', 'cerca de aqui', 'cerca de aca', 'por aqui', 'por aca',
  'mi ubicacion', 'mi zona', 'mi posicion', 'mi area', 'donde estoy',
  'a mi alrededor', 'alrededor mio', 'de aqui', 'near me', 'my location', 'around me', 'nearby'
].join('|') + ')\\b');

export function mentionsOwnLocation(message) {
  return OWN_LOCATION_RE.test(normalizeSearchText(message));
}

const DISTANCE_RE = /\b(\d+(?:[.,]\d+)?\s*(km|kms|kilometros?|minutos?|mins?|cuadras?)|radio)\b/;

export function mentionsDistance(message) {
  return DISTANCE_RE.test(normalizeSearchText(message));
}

// Municipios que se reconocen aunque no vayan después de "en", con su nombre
// tal como está en el campo Ciudad de la base. Así "san nicolas" busca en
// "San Nicolás de los Garza" y no en una ciudad llamada literal "san nicolas".
export const KNOWN_CITIES = new Map([
  ['san nicolas de los garza', { ciudad: 'San Nicolás de los Garza', estado: 'Nuevo León' }],
  ['san nicolas',              { ciudad: 'San Nicolás de los Garza', estado: 'Nuevo León' }],
  ['sanico',                   { ciudad: 'San Nicolás de los Garza', estado: 'Nuevo León' }],
  ['san pedro garza garcia',   { ciudad: 'San Pedro Garza García', estado: 'Nuevo León' }],
  ['san pedro',                { ciudad: 'San Pedro Garza García', estado: 'Nuevo León' }],
  ['monterrey',                { ciudad: 'Monterrey', estado: 'Nuevo León' }],
  ['guadalupe',                { ciudad: 'Guadalupe', estado: 'Nuevo León' }],
  ['apodaca',                  { ciudad: 'Apodaca', estado: 'Nuevo León' }],
  ['santa catarina',           { ciudad: 'Santa Catarina', estado: 'Nuevo León' }],
  ['general escobedo',         { ciudad: 'General Escobedo', estado: 'Nuevo León' }],
  ['escobedo',                 { ciudad: 'General Escobedo', estado: 'Nuevo León' }]
]);
const KNOWN_PLACES = [...KNOWN_CITIES.keys(), 'cumbres', 'nuevo leon', 'cdmx', 'ciudad de mexico'];

// Palabras que siguen a "en" pero no son un lugar: "casa en venta".
const NOT_A_PLACE = new Set([
  'venta', 'renta', 'preventa', 'remate', 'oferta', 'mi ubicacion', 'mi zona', 'mi area',
  'esta zona', 'la zona', 'mi colonia', 'mi ciudad', 'efectivo', 'credito', 'obra negra',
  'buen estado', 'buenas condiciones', 'general', 'dolares', 'pesos', 'total', 'linea',
  'condominio', 'privada', 'fraccionamiento', 'esquina', 'planta baja', 'renta o venta',
  'venta o renta', 'aqui', 'aca', 'donde estoy', 'mi', 'la', 'el', 'un', 'una'
]);

// Corta el lugar donde empiezan los criterios: "en Cumbres con alberca de 3
// recámaras" -> "Cumbres".
const PLACE_END_RE = /\s+(?:con|que|para|por|menos|mas|hasta|entre|desde|cerca|donde|y\s+(?:con|que|de)|de\s+(?:\d|una?\b|dos|tres|cuatro|cinco|seis|mas|menos)|a\s+\d)\b.*$/;
const PLACE_WORD_RE = /^[a-z0-9 .'-]+$/;

// Devuelve el lugar que el usuario nombró en el mensaje (texto normalizado,
// sin acentos) o null. "propiedad en san nicolas" -> "san nicolas".
export function extractPlaceMention(message) {
  const n = normalizeSearchText(message).replace(/[¿?¡!,;:()"]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;

  // Toma todos los "en X" / "colonia X" y se queda con el último que sea un
  // lugar: en "casa en venta en san nicolas" el primero es la operación.
  const re = /\b(?:en|colonia|col\.?|fraccionamiento|fracc\.?|municipio de|ciudad de)\s+(?:la |el |los |las )?(.+?)$/;
  const candidatos = [];
  let resto = n;
  let m;
  while ((m = re.exec(resto))) {
    candidatos.push(m[1]);
    resto = m[1];
  }
  for (let i = candidatos.length - 1; i >= 0; i--) {
    let lugar = candidatos[i].replace(PLACE_END_RE, '');
    // Si el candidato contiene otro "en ...", se queda con lo de antes.
    lugar = lugar.replace(/\s+(?:en|colonia|col)\s+.*$/, '').trim();
    if (!lugar || NOT_A_PLACE.has(lugar) || !PLACE_WORD_RE.test(lugar)) continue;
    if (lugar.split(' ').length > 6) continue;
    if (/^(venta|renta)\b/.test(lugar)) continue;
    return lugar;
  }

  const conocido = KNOWN_PLACES.find(p => new RegExp(`\\b${p}\\b`).test(n));
  return conocido || null;
}

function mencionaValor(mensajeNorm, lugarNorm, valor) {
  const v = normalizePlace(valor);
  if (!v) return false;
  if (mensajeNorm.includes(v)) return true;
  // "san nicolas" en el mensaje vs "San Nicolás de los Garza" del modelo.
  return Boolean(lugarNorm) && (v.includes(lugarNorm) || lugarNorm.includes(v));
}

function mismoLugar(a, b) {
  const x = normalizePlace(a), y = normalizePlace(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Ajusta los params del modelo según lo que el usuario escribió:
 *  1. Un lugar escrito en el mensaje gana sobre el GPS: se apaga
 *     usarUbicacionUsuario (y el km, salvo que pida una distancia).
 *  2. Valores de Ciudad/Colonia/Estado idénticos al GPS que el usuario no
 *     escribió se quitan: vienen del prompt, no del mensaje.
 *  3. "Cerca de mí" sin otro lugar es búsqueda por GPS, aunque el modelo haya
 *     copiado la ciudad del GPS o la zona de la búsqueda anterior.
 *  4. Si el modelo no extrajo ubicación pero el mensaje nombra una, se usa.
 * Devuelve { params, lugarMensaje, ajustes } con los cambios para la bitácora.
 */
export function reconcileLocationParams(params = {}, { message = '', userLocation = {} } = {}) {
  const out = { ...params };
  const ajustes = [];
  const mensajeNorm = normalizeSearchText(message);
  const pideCercaDeMi = mentionsOwnLocation(message);
  const pideDistancia = mentionsDistance(message);
  const lugarMensaje = extractPlaceMention(message);
  const tieneGPS = userLocation?.lat != null && userLocation?.lon != null;

  // 2) Quita lo que el modelo copió del GPS sin que el usuario lo dijera.
  if (tieneGPS || userLocation?.ciudad || userLocation?.colonia) {
    const gpsPorCampo = { Colonia: userLocation?.colonia, Ciudad: userLocation?.ciudad, Estado: userLocation?.estado };
    for (const campo of ['Colonia', 'Ciudad']) {
      const valores = toPlaceList(out[campo]);
      if (!valores.length || !gpsPorCampo[campo]) continue;
      const quedan = valores.filter(v => !mismoLugar(v, gpsPorCampo[campo]) || mencionaValor(mensajeNorm, lugarMensaje, v));
      if (quedan.length !== valores.length) {
        ajustes.push(`${campo} del GPS descartada (${valores.join('|')})`);
        if (quedan.length) out[campo] = quedan; else delete out[campo];
      }
    }
    // El estado solo se conserva si quedó una ciudad/colonia o si lo escribió.
    const estados = toPlaceList(out.Estado);
    if (estados.length && !toPlaceList(out.Ciudad).length && !toPlaceList(out.Colonia).length
        && estados.every(e => mismoLugar(e, gpsPorCampo.Estado) && !mencionaValor(mensajeNorm, lugarMensaje, e))) {
      delete out.Estado;
      ajustes.push('Estado del GPS descartado');
    }
  }

  // Municipios conocidos que el modelo puso como colonia o mal escritos
  // ("Sanico" como colonia) pasan a Ciudad con su nombre oficial.
  const ciudadOficial = (v) => KNOWN_CITIES.get(normalizePlace(v))?.ciudad || null;
  const ciudades = toPlaceList(out.Ciudad).map(v => ciudadOficial(v) || v);
  const colonias = [];
  for (const v of toPlaceList(out.Colonia)) {
    const oficial = ciudadOficial(v);
    if (oficial) { ciudades.push(oficial); ajustes.push(`Colonia "${v}" es el municipio ${oficial}`); }
    else colonias.push(v);
  }
  const ciudadesUnicas = ciudades.filter((c, i) => ciudades.findIndex(x => normalizePlace(x) === normalizePlace(c)) === i);
  if (ciudadesUnicas.length) out.Ciudad = ciudadesUnicas; else delete out.Ciudad;
  if (colonias.length) out.Colonia = colonias; else delete out.Colonia;

  const tieneAdmin = () => Boolean(toPlaceList(out.Ciudad).length || toPlaceList(out.Colonia).length || toPlaceList(out.Estado).length || out.Locacion);

  if (lugarMensaje && !pideCercaDeMi) {
    // 1) El lugar escrito gana sobre el GPS.
    if (out.usarUbicacionUsuario) {
      delete out.usarUbicacionUsuario;
      ajustes.push('usarUbicacionUsuario apagado: el mensaje nombra un lugar');
    }
    if (out.km != null && !pideDistancia) {
      delete out.km;
      ajustes.push('km descartado: el mensaje no pide distancia');
    }
    // Locacion igual al mensaje completo ("y en san nicolas?") es el respaldo
    // de extractFallbackLocacion, no un landmark: se reemplaza por el lugar.
    if (out.Locacion && normalizeSearchText(out.Locacion).replace(/[¿?¡!.,]/g, '').trim() === mensajeNorm.replace(/[¿?¡!.,]/g, '').trim()) {
      delete out.Locacion;
    }
    // 4) El modelo no extrajo el lugar: se usa el del mensaje, con el nombre
    //    oficial si es un municipio conocido o el del GPS.
    if (!tieneAdmin()) {
      const conocida = KNOWN_CITIES.get(lugarMensaje);
      if (conocida) {
        out.Ciudad = [conocida.ciudad];
        ajustes.push(`Ciudad tomada del mensaje (${conocida.ciudad})`);
      } else if (userLocation?.ciudad && mismoLugar(lugarMensaje, userLocation.ciudad)) {
        out.Ciudad = [userLocation.ciudad];
        ajustes.push(`Ciudad tomada del mensaje (${userLocation.ciudad})`);
      } else {
        out.Locacion = lugarMensaje;
        ajustes.push(`Locacion tomada del mensaje (${lugarMensaje})`);
      }
    }
  } else if (pideCercaDeMi && !lugarMensaje && tieneGPS) {
    // 3) "Cerca de mí" puro: radio desde el GPS, nada de zonas copiadas.
    if (!out.usarUbicacionUsuario) ajustes.push('usarUbicacionUsuario encendido: el mensaje pide "cerca de mí"');
    out.usarUbicacionUsuario = true;
    for (const campo of ['Ciudad', 'Colonia', 'Estado', 'Locacion']) {
      if (out[campo] != null && (Array.isArray(out[campo]) ? out[campo].length : true)) {
        ajustes.push(`${campo} descartado: "cerca de mí" usa el GPS`);
      }
      delete out[campo];
    }
  }

  return { params: out, lugarMensaje, ajustes };
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
