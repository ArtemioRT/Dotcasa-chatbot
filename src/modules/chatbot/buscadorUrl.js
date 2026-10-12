// ============================================================================
// URL DEL BUSCADOR — "Ver todas" abre https://dotcasa.com.mx/<ruta>?<filtros>
// ============================================================================
// Rutas del buscador (cada segmento es opcional, pero en este orden):
//   /tipo/operación/estado/ciudad/colonia
//   /tipo/operación/cp/<cp>
// Ejemplos: /casa/venta/nuevo-leon/monterrey/cumbres, /venta, /cp/64000
// Filtros en query string: precio_min, precio_max, construccion_min,
// construccion_max, terreno_min, terreno_max, antiguedad, banos, recamaras.
// Valores múltiples (varios tipos, operaciones o ubicaciones) en la query con
// el mismo nombre, separados por coma: ?tipo=casa,departamento&ciudad=A,B
// Es el mismo formato que arman el index y el buscador de Bubble (DCRutas):
// antiguedad va como rango "min-max" y sin ruta se abre /propiedades.
// ============================================================================
import { BUSCADOR_BASE_URL } from '../../shared/config.js';
import { ciudadConocida, toPlaceList } from './locationSearch.js';

// "San Nicolás de los Garza" -> "san-nicolas-de-los-garza"
// Igual que Utils.normalizar del Worker dotcasa-domain (y DCRutas en Bubble):
// minúsculas, sin acentos, espacios/guiones bajos -> "-". La puntuación se
// conserva ("Col. Del Valle" -> "col.-del-valle") porque así quedan los slugs
// de la tabla ruta; si se quitara, el Worker no encontraría la ruta (404).
// Solo se quitan los caracteres que romperían la URL (/ ? #).
export function slugify(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\/?#]+/g, ' ')
    .trim()
    .replace(/[_\s]+/g, '-');
}

// Lista sin repetidos (comparando por slug), en el orden en que llegó.
function lista(valores) {
  const vistos = new Set();
  return toPlaceList(valores).filter(v => {
    const k = slugify(v);
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

// Igual que cod() de DCRutas: se codifica todo menos la coma que separa la lista.
const cod = v => encodeURIComponent(v).replace(/%2C/gi, ',');

const FILTROS = [
  ['precio_min',       'Precio_min'],
  ['precio_max',       'Precio_max'],
  ['construccion_min', 'M2_cons_min'],
  ['construccion_max', 'M2_cons_max'],
  ['terreno_min',      'M2_terreno_min'],
  ['terreno_max',      'M2_terreno_max'],
  ['antiguedad',       'Antiguedad'],
  ['banos',            'Banos'],
  ['recamaras',        'Habitaciones']
];

/**
 * params: los de buscarPropiedades (tipoInmueble, tipoOperación, filtros).
 * zona: { estado, ciudad, colonia } ya resueltos (arrays), y cp opcional.
 *
 * Igual que DCRutas.url() del index y el buscador: la ruta lleva solo lo que
 * es UNO solo; lo que tiene varios valores va en la query con el mismo nombre
 * de siempre, como lista separada por coma (tipo y operación en slug, las
 * ubicaciones con sus acentos porque el buscador las compara tal cual):
 *   "casas o departamentos en venta en Cumbres o Contry, Monterrey" ->
 *   /venta/nuevo-leon/monterrey?tipo=casa,departamento&colonia=Cumbres,Contry
 */
export function buildBuscadorUrl(params = {}, zona = {}) {
  const tipos = lista(params.tipoInmueble).map(slugify);
  const ops = lista(params.tipoOperación).map(slugify);
  let estados = lista(zona.estado);
  let ciudades = lista(zona.ciudad);
  const colonias = lista(zona.colonia);

  // Municipios conocidos: nombre oficial y, si no vino, su estado (la ruta
  // necesita el estado antes de la ciudad). Con varias ciudades del mismo
  // estado, ese estado también va en la ruta.
  const conocidas = ciudades.map(c => ciudadConocida(c));
  ciudades = ciudades.map((c, i) => conocidas[i]?.ciudad || c);
  if (!estados.length && ciudades.length) {
    const deCiudades = lista(conocidas.map(c => c?.estado));
    if (conocidas.every(Boolean) && deCiudades.length === 1) estados = deCiudades;
  }

  const ruta = [];
  const query = { tipo: [], operacion: [], estado: [], ciudad: [], colonia: [], cp: '' };

  const tipo = tipos.length === 1 ? tipos[0] : '';
  const operacion = ops.length === 1 ? ops[0] : '';
  if (tipo) ruta.push(tipo); else query.tipo = tipos;
  if (operacion) ruta.push(operacion); else query.operacion = ops;

  const cp = zona.cp ? String(zona.cp).replace(/\D/g, '') : '';
  if (/^\d{5}$/.test(cp)) {
    // /tipo/operacion/cp/N y /cp/N existen; /tipo/cp/N no: ahí el CP va en la query.
    if (Boolean(tipo) === Boolean(operacion)) ruta.push('cp', cp);
    else query.cp = cp;
    query.estado = estados; query.ciudad = ciudades; query.colonia = colonias;
  } else if (estados.length === 1) {
    ruta.push(slugify(estados[0]));
    if (ciudades.length === 1) {
      ruta.push(slugify(ciudades[0]));
      // /tipo/estado/ciudad/colonia (sin operación) no existe en el Worker.
      if (colonias.length === 1 && !(tipo && !operacion)) ruta.push(slugify(colonias[0]));
      else query.colonia = colonias;
    } else {
      query.ciudad = ciudades; query.colonia = colonias;
    }
  } else {
    query.estado = estados; query.ciudad = ciudades; query.colonia = colonias;
  }

  const qs = [];
  for (const k of ['tipo', 'operacion', 'estado', 'ciudad', 'colonia']) {
    if (query[k].length) qs.push(`${k}=${query[k].map(cod).join(',')}`);
  }
  if (query.cp) qs.push(`cp=${query.cp}`);
  for (const [nombre, clave] of FILTROS) {
    const valor = Number(params[clave]);
    if (params[clave] == null || !Number.isFinite(valor) || valor <= 0) continue;
    // El buscador lee la antigüedad como rango "min-max" (0-5, 6-10...).
    qs.push(`${nombre}=${nombre === 'antiguedad' ? `0-${valor}` : valor}`);
  }

  const base = BUSCADOR_BASE_URL.replace(/\/+$/, '');
  // Sin ruta, el listado general es /propiedades (la raíz es el inicio).
  return `${base}/${ruta.join('/') || 'propiedades'}${qs.length ? `?${qs.join('&')}` : ''}`;
}
