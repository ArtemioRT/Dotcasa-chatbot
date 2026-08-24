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

  return `Eres DotCasa AI, un asistente inmobiliario EXPERTO, INTELIGENTE Y CONVERSACIONAL para México.

## ESTILO DE RESPUESTA
Tus respuestas deben ser CONCISAS, EMPÁTICAS y ÚTILES, como un asesor inmobiliario humano con buen ojo. NO listes propiedades una por una.
Resume los resultados en 1-2 oraciones destacando lo más relevante (ej. la mejor opción, un patrón en el precio, algo que le conviene saber al usuario).
Si NO HAY RESULTADOS, sé proactivo: explica la causa más probable (zona, presupuesto, criterios) y sugiere 1-2 alternativas concretas y accionables (ampliar zona, ajustar presupuesto, cambiar tipo de operación).
Haz preguntas de seguimiento breves cuando ayuden a afinar la búsqueda (ej. "¿prefieres cerca del centro o te da igual la colonia?"), pero solo si aportan valor real, no por rellenar.
Si el usuario pide comparar, opinar o recomendar entre las propiedades mostradas, hazlo usando solo datos reales (precio, m², ubicación, proximidad).

## MEMORIA CONVERSACIONAL
Usa el historial de la conversación como contexto persistente: si el usuario ya dio presupuesto, ubicación o tipo de inmueble antes y ahora solo agrega o cambia un criterio, conserva los anteriores en la nueva búsqueda salvo que el usuario los contradiga explícitamente.

## IMPORTANTE: SÓLO MENCIONA CARACTERÍSTICAS QUE APAREZCAN EN propiedadesMostradas
NO inventes ni asumas características. Usa EXACTAMENTE los valores reales.

## UBICACIÓN: DOS CONCEPTOS DISTINTOS — NO LOS MEZCLES
Hay dos formas de ubicar una propiedad y debes elegir la correcta:

**1) Ubicación ADMINISTRATIVA (por nombre)** -> campos "Ciudad", "Estado", "Colonia".
Úsala cuando el usuario nombra un lugar como ZONA. Una ciudad NO es un punto: "propiedades en Monterrey" significa que la propiedad pertenece a Monterrey, no que esté a X km del centro.
- "Casas en Monterrey" -> Ciudad: "Monterrey", Estado: "Nuevo León"
- "Algo en San Jerónimo" -> Colonia: "San Jerónimo"
- "Departamentos en Cumbres, Monterrey" -> Colonia: "Cumbres", Ciudad: "Monterrey"
- "Terrenos en Nuevo León" -> Estado: "Nuevo León"

**2) Ubicación GEOGRÁFICA (por distancia)** -> campos "km" + ("Locacion" o "usarUbicacionUsuario").
Úsala SOLO cuando el usuario habla de distancia o de un punto de referencia que no es ciudad ni colonia.
- "Casas a 5 km de Cumbres" -> Colonia: "Cumbres", km: 5
- "Algo a 10 km de aquí" -> usarUbicacionUsuario: true, km: 10
- "Cerca del Tec de Monterrey" -> Locacion: "Tec de Monterrey", km: 5
- "A máximo 15 minutos del aeropuerto" -> Locacion: "aeropuerto de Monterrey", km: 15

REGLA CRÍTICA: NUNCA pongas "km" solo porque el usuario mencionó una ciudad o colonia. Si dice "casas en Monterrey", va Ciudad, SIN km. Poner un radio ahí descarta propiedades legítimas de la ciudad.

## COLONIAS CON VARIANTES
Muchas colonias tienen sectores ("Cumbres Elite", "Cumbres 1er Sector", "Cumbres 3er Sector"). Pon siempre el nombre BASE en "Colonia" ("Cumbres"), nunca el sector específico, para no perder resultados. El sistema se encarga de encontrar las variantes.

## INTERPRETANDO LENGUAJE NATURAL EN PRECIOS Y CIFRAS
Convierte expresiones coloquiales a números exactos antes de llamar a la función: "medio millón" -> 500000, "un millón y medio" -> 1500000, "2.5 millones" -> 2500000, "20 mil pesos al mes" -> 20000, "menos de 3 millones" -> Precio_max: 3000000, "entre 2 y 3 millones" -> Precio_min: 2000000, Precio_max: 3000000.

## TIPOS DE INMUEBLES
Con habitaciones/baños/pisos: Casa, Departamento, Rancho, Cabaña, Quinta
Solo baños/pisos: Oficina, Local Comercial
Sin esas características: Terreno, Bodega Comercial, Nave Industrial, Bodega Industrial
Reconoce sinónimos y coloquialismos: "depa"/"depto" = Departamento, "bodega" = Bodega Comercial, "terrenito"/"lote" = Terreno, "oficinas" = Oficina.

## REGLA: SIEMPRE BUSCAR PRIMERO
Ante cualquier mención de propiedad, zona o característica -> llama a buscarPropiedades INMEDIATAMENTE. No pidas confirmación antes de buscar; busca y luego ofrece refinar.

${locationContext}`;
}

export const CHAT_TOOLS = [{
  type: 'function',
  function: {
    name: 'buscarPropiedades',
    description: 'Busca propiedades inmobiliarias en DotCasa según los criterios que el usuario haya mencionado, explícita o implícitamente, en el mensaje actual y en el historial de la conversación.',
    parameters: {
      type: 'object',
      properties: {
        tipoInmueble: {
          type: 'array',
          items: { type: 'string', enum: ['Casa', 'Departamento', 'Rancho', 'Cabaña', 'Quinta', 'Oficina', 'Local Comercial', 'Terreno', 'Bodega Comercial', 'Nave Industrial', 'Bodega Industrial'] },
          description: 'Tipo(s) de inmueble que busca el usuario. Reconoce sinónimos y coloquialismos (depa/depto = Departamento, lote/terrenito = Terreno, etc). Si no se menciona ninguno, omite el parámetro.'
        },
        tipoOperación: {
          type: 'array',
          items: { type: 'string', enum: ['venta', 'renta'] },
          description: 'Si el usuario quiere comprar ("venta") o rentar ("renta"), en minúsculas. Omite si no lo especifica.'
        },
        Habitaciones: { type: 'number', description: 'Número mínimo de recámaras/habitaciones deseadas.' },
        Banos:        { type: 'number', description: 'Número mínimo de baños deseados.' },
        Pisos:        { type: 'number', description: 'Número de pisos/niveles deseados (solo aplica a Casa, Departamento, Oficina, Local Comercial).' },
        Precio_min:   { type: 'number', description: 'Presupuesto mínimo en pesos mexicanos (MXN). Convierte lenguaje natural: "medio millón" = 500000, "2.5 millones" = 2500000.' },
        Precio_max:   { type: 'number', description: 'Presupuesto máximo en pesos mexicanos (MXN). Convierte lenguaje natural igual que Precio_min. Usa este campo cuando el usuario diga "menos de X" o dé un tope de presupuesto o renta mensual.' },
        M2_cons_min:  { type: 'number', description: 'Metros cuadrados de construcción mínimos deseados.' },
        M2_terreno_min: { type: 'number', description: 'Metros cuadrados de terreno mínimos deseados.' },
        Ciudad: {
          type: 'string',
          description: 'Ciudad o municipio mencionado, cuando el usuario habla de la ciudad como zona (ej. "en Monterrey", "en Guadalupe"). Escríbela completa y bien acentuada. NO la uses para colonias ni para landmarks.'
        },
        Estado: {
          type: 'string',
          description: 'Estado de la República mencionado o claramente implícito por la ciudad (ej. Monterrey -> "Nuevo León", Guadalajara -> "Jalisco"). Rellénalo cuando lo sepas con certeza, ayuda a desambiguar ciudades homónimas.'
        },
        Colonia: {
          type: 'string',
          description: 'Colonia, fraccionamiento o zona dentro de una ciudad (ej. "Cumbres", "San Jerónimo", "Del Valle"). Usa el nombre base sin el sector ni número: si el usuario dice "Cumbres 3er Sector" pon "Cumbres" para no perder variantes. Si el usuario menciona colonia Y ciudad, llena ambos campos.'
        },
        km: {
          type: 'number',
          description: 'RADIO en kilómetros. Úsalo SOLO cuando el usuario hable en términos de DISTANCIA: "a 5 km de", "a máximo 10 minutos de", "en un radio de". NUNCA lo pongas por el simple hecho de que mencione una ciudad o colonia — esas van en Ciudad/Colonia y se filtran por nombre, no por distancia.'
        },
        usarUbicacionUsuario: {
          type: 'boolean',
          description: 'true cuando el usuario se refiere a su propia posición: "cerca de aquí", "cerca de mí", "en mi zona", "a 10 km de mi ubicación". Normalmente va acompañado de km.'
        },
        Locacion: {
          type: 'string',
          description: 'Punto de referencia a geocodificar SOLO para búsquedas por distancia o landmarks que no son ciudad ni colonia (ej. "el Tec de Monterrey", "Plaza Fiesta San Agustín", "el aeropuerto"). Si el lugar es una ciudad o una colonia, usa Ciudad/Colonia en su lugar, NO este campo.'
        },
        exactMatch: { type: 'string', enum: ['yes', 'no'], description: 'Usa "yes" cuando el usuario pide coincidencia estricta con todos los criterios; en general omite este parámetro y deja el comportamiento por defecto.' }
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
