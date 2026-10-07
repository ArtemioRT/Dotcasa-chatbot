// URL de "Ver todas": https://dotcasa.com/<tipo>/<operación>/<estado>/<ciudad>/<colonia>?filtros
import { test } from 'node:test';
import assert from 'node:assert/strict';
// helpers.js va primero: fija las variables de entorno antes de que se cargue config.js.
import { runChat, prop, GPS_SAN_NICOLAS } from './helpers.js';
import { buildBuscadorUrl, slugify } from '../src/modules/chatbot/buscadorUrl.js';

test('slugify quita acentos y usa guiones', () => {
  assert.equal(slugify('San Nicolás de los Garza'), 'san-nicolas-de-los-garza');
  assert.equal(slugify('Nuevo León'), 'nuevo-leon');
  assert.equal(slugify('Local Comercial'), 'local-comercial');
});

test('rutas en el orden tipo/operación/estado/ciudad/colonia', () => {
  const casos = [
    [{ tipoInmueble: ['Casa'] }, {}, '/casa'],
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, {}, '/casa/venta'],
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, { estado: ['Nuevo León'] }, '/casa/venta/nuevo-leon'],
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'] }, '/casa/venta/nuevo-leon/monterrey'],
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres'] }, '/casa/venta/nuevo-leon/monterrey/cumbres'],
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, { cp: '64000' }, '/casa/venta/cp/64000'],
    [{ tipoInmueble: ['Casa'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'] }, '/casa/nuevo-leon/monterrey'],
    [{ tipoOperación: ['Venta'] }, {}, '/venta'],
    [{ tipoOperación: ['Venta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres'] }, '/venta/nuevo-leon/monterrey/cumbres'],
    [{}, { estado: ['Nuevo León'] }, '/nuevo-leon'],
    [{}, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres'] }, '/nuevo-leon/monterrey/cumbres'],
    [{}, { cp: '64000' }, '/cp/64000'],
    [{}, {}, '/']
  ];
  for (const [params, zona, ruta] of casos) {
    assert.equal(buildBuscadorUrl(params, zona), `https://dotcasa.com${ruta}`, ruta);
  }
});

test('filtros con los nombres nuevos del buscador', () => {
  const url = new URL(buildBuscadorUrl({
    Precio_min: 1000000, Precio_max: 3000000, M2_cons_min: 120, M2_cons_max: 200,
    M2_terreno_min: 150, M2_terreno_max: 300, Antiguedad: 5, Banos: 2, Habitaciones: 3, Pisos: 2
  }, {}));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    precio_min: '1000000', precio_max: '3000000', construccion_min: '120', construccion_max: '200',
    terreno_min: '150', terreno_max: '300', antiguedad: '5', banos: '2', recamaras: '3'
  });
});

test('sin estado se completa con el del municipio conocido; con varios valores se omite el segmento', () => {
  assert.equal(buildBuscadorUrl({}, { ciudad: ['San Nicolás de los Garza'] }), 'https://dotcasa.com/nuevo-leon/san-nicolas-de-los-garza');
  assert.equal(buildBuscadorUrl({ tipoInmueble: ['Casa', 'Departamento'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey', 'San Pedro Garza García'] }), 'https://dotcasa.com/nuevo-leon');
  // Ciudad desconocida sin estado: no se puede armar la ruta de ciudad.
  assert.equal(buildBuscadorUrl({}, { ciudad: ['Ciudad Mante'] }), 'https://dotcasa.com/');
});

test('/chat devuelve urlBuscador para "Ver todas"', async () => {
  const base = [prop({ ciudad: 'Monterrey', colonia: 'Cumbres Elite', lat: 25.73, lng: -100.40 })];
  const { json } = await runChat({
    body: { message: 'casas en venta en cumbres monterrey de 3 recamaras hasta 5 millones', history: [] },
    toolArgs: { tipoInmueble: ['Casa'], tipoOperación: ['Venta'], Colonia: ['Cumbres'], Ciudad: ['Monterrey'], Estado: ['Nuevo León'], Habitaciones: 3, Precio_max: 5000000 },
    bubble: () => base
  });
  assert.equal(json.urlBuscador, 'https://dotcasa.com/casa/venta/nuevo-leon/monterrey/cumbres?precio_max=5000000&recamaras=3');
  assert.equal(json.ubicacion.buscador.url, json.urlBuscador);
});

test('/chat "cerca de mí": la URL lleva el estado y la ciudad del GPS', async () => {
  const base = [prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Anáhuac', lat: 25.7392, lng: -100.2985 })];
  const { json } = await runChat({
    body: { message: 'Muéstrame propiedades disponibles cerca de mi ubicación', history: [], location: GPS_SAN_NICOLAS },
    toolArgs: { usarUbicacionUsuario: true },
    bubble: () => base
  });
  assert.equal(json.urlBuscador, 'https://dotcasa.com/nuevo-leon/san-nicolas-de-los-garza');
});
