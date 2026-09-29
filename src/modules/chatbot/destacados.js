// ============================================================================
// DESTACADOS — prioriza las propiedades con Destacado = "yes" y las rota
// ============================================================================
// Reglas:
//   1) La clasificación manda: exacta > cumple > cercana > recomendada. Dentro
//      de CADA nivel, las destacadas van primero y después el resto en su orden
//      de relevancia (score). Así una destacada "recomendada" nunca queda por
//      encima de una "exacta". Si un nivel tiene pocas destacadas, el resto de
//      ese nivel completa la lista solo.
//   1b) Las NO destacadas también rotan, pero solo entre las de score similar
//      (bloques de DESTACADOS_BLOQUE_SCORE puntos): la relevancia se respeta y
//      las publicaciones casi iguales se turnan en vez de que salgan siempre
//      las mismas.
//   2) Las destacadas rotan de forma circular cada DESTACADOS_ROTACION_MIN
//      minutos (15 por defecto), para que todas tengan exposición.
//   3) Dentro de una misma ventana de tiempo el orden es estable: "Ver 1 más"
//      y las búsquedas repetidas no se desordenan a media conversación.
// Import de namespace a propósito (igual que server.js): si config.js está
// desactualizado, se usan los valores por defecto en vez de reventar el arranque.
import * as config from '../../shared/config.js';

const ROTACION_MIN = Number(config.DESTACADOS_ROTACION_MIN) || 15;
export const VENTANA_ROTACION_MS = ROTACION_MIN * 60 * 1000;
// Diferencia máxima de score para considerar "similares" a dos propiedades.
export const BLOQUE_SCORE = Number(config.DESTACADOS_BLOQUE_SCORE) || 1;

// Bubble manda el campo como texto "yes"/"no"; se aceptan también true/"sí".
export function esDestacada(prop) {
  const v = String(prop?.Destacado ?? prop?.destacado ?? '').trim().toLowerCase();
  return v === 'yes' || v === 'true' || v === 'si' || v === 'sí' || v === '1';
}

// Rotación circular: los primeros k elementos pasan al final.
export function rotar(arr, offset) {
  if (arr.length <= 1) return arr;
  const k = ((offset % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// Clave estable para que la rotación reparta la exposición de forma pareja,
// sin depender del score (que cambia de una búsqueda a otra).
function claveEstable(prop) {
  return String(prop?.Link ?? prop?.link ?? prop?._id ?? prop?.id ?? '');
}

// Agrupa una lista ordenada por score en bloques de score similar. Cada bloque
// arranca en el score de su primer elemento y abarca hasta BLOQUE_SCORE puntos
// por debajo, así un bloque nunca se "estira" en cadena.
function bloquesPorScore(lista) {
  const bloques = [];
  let actual = null;
  for (const p of lista) {
    const score = Number(p.__score__) || 0;
    if (actual && actual.tope - score < BLOQUE_SCORE) actual.items.push(p);
    else { actual = { tope: score, items: [p] }; bloques.push(actual); }
  }
  return bloques.map(b => b.items);
}

// Orden de los niveles; lo que no esté aquí (o venga sin clasificar) va al final.
const ORDEN_CLASIFICACION = ['exacta', 'cumple', 'cercana', 'recomendada'];

/**
 * @param {Array} propiedades  lista ya clasificada y ordenada por score
 * @param {{ahora?: number}} [opts]
 * @returns {Array} por nivel: destacadas (rotadas) + resto (por score, rotando
 *   dentro de cada bloque de score similar)
 */
export function ordenarConDestacados(propiedades, { ahora = Date.now() } = {}) {
  if (!Array.isArray(propiedades) || propiedades.length === 0) return propiedades || [];

  const offset = Math.floor(ahora / VENTANA_ROTACION_MS);
  const niveles = new Map(ORDEN_CLASIFICACION.map(n => [n, []]));
  const otros = [];
  for (const p of propiedades) {
    const nivel = niveles.get(p.__classification__);
    (nivel || otros).push(p); // push conserva el orden por score dentro del nivel
  }

  const resultado = [];
  for (const grupo of [...niveles.values(), otros]) {
    const destacadas = grupo.filter(esDestacada)
      .sort((a, b) => claveEstable(a).localeCompare(claveEstable(b)));
    const resto = grupo.filter(p => !esDestacada(p));
    const restoRotado = bloquesPorScore(resto).flatMap(bloque =>
      rotar([...bloque].sort((a, b) => claveEstable(a).localeCompare(claveEstable(b))), offset)
    );
    resultado.push(...rotar(destacadas, offset), ...restoRotado);
  }
  return resultado;
}