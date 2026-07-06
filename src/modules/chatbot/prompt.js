// ============================================================================
// PROMPT & HELPERS — system prompt, tools, keywords y sanitización de params
// ============================================================================
import { normalizeSearchText } from '../../shared/utils.js';
import { parseLocacion } from './geocoding.js';

export const RADIUS_SCALE = [2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100];

export const PROPERTY_INTENT_KEYWORDS = [
  'propiedad', 'casa', 'departamento', 'terreno', 'local', 'oficina', 'inmueble',
  'venta', 'renta', 'comprar', 'rentar', 'habitacion', 'habitaciones',
  'recamara', 'recamaras', 'cuarto', 'cuartos', 'bano', 'banos',
  'precio', 'presupuesto', 'metros', 'm2', 'piso', 'pisos',
  'busco', 'buscar', 'quiero', 'necesito'
];

export const DIRECT_LOCATION_HINTS = [
  'cumbres', 'monterrey', 'san pedro', 'guadalupe', 'apodaca',
  'santa catarina', 'san nicolas', 'escobedo', 'centro', 'colonia',
  'calle', 'avenida', 'blvd', 'boulevard', 'plaza', 'fraccionamiento', 'fracc'
];

export const SEARCH_KEYWORDS = [
  'propiedad', 'casa', 'departamento', 'terreno', 'local', 'oficina', 'inmueble',
  'venta', 'renta', 'comprar', 'rentar', 'habitacion', 'recamara', 'cuarto',
  'baño', 'bano', 'monterrey', 'cumbres', 'san pedro', 'guadalupe', 'apodaca', 'santa catarina',
  'san nicolas', 'escobedo', 'busco', 'buscar', 'nuevo leon', 'quinta', 'rancho',
  'cabana', 'avenida', 'av.', 'calle', 'blvd', 'boulevard', 'colonia', 'zona', 'cerca',
  'tamaulipas', 'coahuila', 'jalisco', 'chihuahua', 'veracruz', 'puebla', 'cdmx',
  'ciudad mante', 'mante', 'victoria', 'matamoros', 'reynosa', 'saltillo', 'torreon',
  'san luis potosi', 'guanajuato', 'queretaro', 'sonora', 'sinaloa', 'durango',
  'yucatan', 'oaxaca', 'chiapas', 'guerrero', 'michoacan', 'hidalgo', 'morelos',
  'tampico', 'nuevo laredo'
];

export function extractFallbackLocacion(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > 80) return null;
  if (parseLocacion(trimmed)) return trimmed;
  const normalized = normalizeSearchText(trimmed);
  const tokenCount = normalized.split(' ').filter(Boolean).length;
  const hasLocationHint = trimmed.includes(',') || DIRECT_LOCATION_HINTS.some(hint => normalized.includes(hint));
  const hasPropertyIntent = PROPERTY_INTENT_KEYWORDS.some(keyword => normalized.includes(keyword));
  if (!hasLocationHint || hasPropertyIntent || tokenCount > 6) return null;
  return trimmed;
}

export function buildSystemPrompt(userLocation) {
  const locationContext = userLocation?.ciudad
    ? (() => {
        const parts = [];
        if (userLocation.colonia) parts.push(`Colonia: ${userLocation.colonia}`);
        if (userLocation.ciudad)  parts.push(`Ciudad: ${userLocation.ciudad}`);
        if (userLocation.estado)  parts.push(`Estado: ${userLocation.estado}`);
        if (userLocation.lat && userLocation.lon) parts.push(`Coordenadas: ${userLocation.lat}, ${userLocation.lon}`);
        return `\n\n## UBICACIÓN ACTUAL DEL USUARIO (GPS)\n${parts.join('\n')}\nSi no especifica ubicación en su búsqueda, usa estas coordenadas como punto de referencia.`;
      })()
    : '';

  return `Eres DotCasa AI, un asistente inmobiliario INTELIGENTE Y CONVERSACIONAL para México.

## ESTILO DE RESPUESTA
Tus respuestas deben ser CONCISAS, EMPÁTICAS y ÚTILES. NO listes propiedades una por una.
Resume los resultados en 1-2 oraciones. Si NO HAY RESULTADOS, sé proactivo: explica por qué y sugiere alternativas.

## IMPORTANTE: SÓLO MENCIONA CARACTERÍSTICAS QUE APAREZCAN EN propiedadesMostradas
NO inventes ni asumas características. Usa EXACTAMENTE los valores reales.

## PARÁMETRO "Locacion"
Captura SIEMPRE en "Locacion" la dirección o lugar geográfico más específico que mencione el usuario.

## PARÁMETRO "km"
Si el usuario menciona un radio específico, usa ese valor. Si NO, NO incluyas "km".

## TIPOS DE INMUEBLES
Con habitaciones/baños/pisos: Casa, Departamento, Rancho, Cabaña, Quinta
Solo baños/pisos: Oficina, Local Comercial
Sin esas características: Terreno, Bodega Comercial, Nave Industrial, Bodega Industrial

## REGLA: SIEMPRE BUSCAR PRIMERO
Ante cualquier mención de propiedad, zona o característica -> llama a buscarPropiedades INMEDIATAMENTE.

${locationContext}`;
}

export const CHAT_TOOLS = [{
  type: 'function',
  function: {
    name: 'buscarPropiedades',
    description: 'Busca propiedades en DotCasa.',
    parameters: {
      type: 'object',
      properties: {
        tipoInmueble:    { type: 'array', items: { type: 'string' } },
        tipoOperación:   { type: 'array', items: { type: 'string' } },
        Habitaciones:    { type: 'number' },
        Banos:           { type: 'number' },
        Pisos:           { type: 'number' },
        Precio_min:      { type: 'number' },
        Precio_max:      { type: 'number' },
        M2_cons_min:     { type: 'number' },
        M2_terreno_min:  { type: 'number' },
        Locacion:        { type: 'string' },
        km:              { type: 'number' },
        exactMatch:      { type: 'string', enum: ['yes', 'no'] }
      }
    }
  }
}];

export function isSearchQuery(msg) {
  const n = normalizeSearchText(msg);
  return SEARCH_KEYWORDS.some(kw => n.includes(normalizeSearchText(kw)));
}

export function inferTipoInmuebleFromMessage(message) {
  const n = normalizeSearchText(message);
  const tipos = [];
  const mapping = [
    ['local comercial', 'Local Comercial'], ['locales comerciales', 'Local Comercial'],
    ['nave industrial', 'Nave Industrial'], ['bodega industrial', 'Bodega Industrial'],
    ['bodega comercial', 'Bodega Comercial'],
    ['departamentos', 'Departamento'], ['departamento', 'Departamento'],
    ['deptos', 'Departamento'], ['depto', 'Departamento'],
    ['terrenos', 'Terreno'], ['terreno', 'Terreno'],
    ['quintas', 'Quinta'], ['quinta', 'Quinta'],
    ['ranchos', 'Rancho'], ['rancho', 'Rancho'],
    ['cabanas', 'Cabaña'], ['cabana', 'Cabaña'],
    ['oficinas', 'Oficina'], ['oficina', 'Oficina'],
    ['bodegas', 'Bodega Comercial'], ['bodega', 'Bodega Comercial'],
    ['casas', 'Casa'], ['casa', 'Casa']
  ];
  for (const [keyword, tipo] of mapping) {
    const re = new RegExp(`\\b${keyword}\\b`);
    if (re.test(n) && !tipos.includes(tipo)) tipos.push(tipo);
  }
  return tipos;
}

export function sanitizeParams(params) {
  if (params.km != null) {
    if (params.km > 100) params.km = 100;
    if (params.km < 1)   params.km = 2;
  }
  if (!params.tipoInmueble || params.tipoInmueble.length === 0) {
    if (params.Habitaciones || params.Banos) {
      params.tipoInmueble = ['Casa', 'Departamento', 'Rancho', 'Cabaña', 'Quinta'];
    } else {
      params.tipoInmueble = ['Casa', 'Departamento'];
    }
  }
  if (!params.tipoOperación || params.tipoOperación.length === 0) {
    delete params.tipoOperación;
  }
  if ((params.Habitaciones || params.Banos || params.Pisos) && params.tipoInmueble?.length) {
    const sinHab = ['Terreno', 'Oficina', 'Local Comercial', 'Bodega Comercial', 'Nave Industrial', 'Bodega Industrial'];
    const sinBP  = ['Terreno', 'Bodega Comercial', 'Nave Industrial', 'Bodega Industrial'];
    if (params.Habitaciones)          params.tipoInmueble = params.tipoInmueble.filter(t => !sinHab.includes(t));
    if (params.Banos || params.Pisos) params.tipoInmueble = params.tipoInmueble.filter(t => !sinBP.includes(t));
    if (!params.tipoInmueble.length) {
      params.tipoInmueble = params.Habitaciones
        ? ['Casa', 'Departamento', 'Rancho', 'Cabaña', 'Quinta']
        : ['Casa', 'Departamento', 'Rancho', 'Cabaña', 'Quinta', 'Oficina', 'Local Comercial'];
    }
  }
  return params;
}

export function cleanHistory(history) {
  const cleaned = [];
  for (const msg of history) {
    if (msg.role === 'tool') {
      const prev = cleaned[cleaned.length - 1];
      if (prev?.role === 'assistant' && prev?.tool_calls) cleaned.push(msg);
    } else { cleaned.push(msg); }
  }
  return cleaned;
}
