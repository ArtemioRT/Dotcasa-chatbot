// ============================================================================
// URL DEL BUSCADOR — "Ver todas" abre https://dotcasa.com/<ruta>?<filtros>
// ============================================================================
// Rutas del buscador (cada segmento es opcional, pero en este orden):
//   /tipo/operación/estado/ciudad/colonia
//   /tipo/operación/cp/<cp>
// Ejemplos: /casa/venta/nuevo-leon/monterrey/cumbres, /venta, /cp/64000
// Filtros en query string: precio_min, precio_max, construccion_min,
// construccion_max, terreno_min, terreno_max, antiguedad, banos, recamaras.
// ============================================================================
import { BUSCADOR_BASE_URL } from '../../shared/config.js';
import { normalizeSearchText } from '../../shared/utils.js';
import { ciudadConocida, toPlaceList } from './locationSearch.js';

// "San Nicolás de los Garza" -> "san-nicolas-de-los-garza"
export function slugify(texto) {
  return normalizeSearchText(texto)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s-]+/g, '-');
}

// Un segmento de ruta admite UN valor. Con varios ("casas o departamentos",
// "Monterrey o San Pedro") se omite el segmento para no esconder resultados.
function unico(valores) {
  const lista = toPlaceList(valores);
  return lista.length === 1 ? lista[0] : null;
}

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
 */
export function buildBuscadorUrl(params = {}, zona = {}) {
  const segmentos = [];

  const tipo = unico(params.tipoInmueble);
  if (tipo) segmentos.push(slugify(tipo));
  const operacion = unico(params.tipoOperación);
  if (operacion) segmentos.push(slugify(operacion));

  const cp = zona.cp ? String(zona.cp).replace(/\D/g, '') : '';
  if (/^\d{5}$/.test(cp)) {
    segmentos.push('cp', cp);
  } else {
    let ciudad = unico(zona.ciudad);
    let estado = unico(zona.estado);
    const colonia = unico(zona.colonia);
    // La ruta necesita el estado antes de la ciudad: si no vino, se toma del
    // catálogo de municipios conocidos.
    const conocida = ciudad ? ciudadConocida(ciudad) : null;
    if (conocida) { ciudad = conocida.ciudad; estado = estado || conocida.estado; }
    if (estado) {
      segmentos.push(slugify(estado));
      if (ciudad) {
        segmentos.push(slugify(ciudad));
        if (colonia) segmentos.push(slugify(colonia));
      }
    }
  }

  const query = new URLSearchParams();
  for (const [nombre, clave] of FILTROS) {
    const valor = Number(params[clave]);
    if (params[clave] != null && Number.isFinite(valor) && valor > 0) query.append(nombre, String(valor));
  }

  const base = BUSCADOR_BASE_URL.replace(/\/+$/, '');
  const ruta = segmentos.filter(Boolean).join('/');
  const qs = query.toString();
  return `${base}/${ruta}${qs ? `?${qs}` : ''}`;
}
