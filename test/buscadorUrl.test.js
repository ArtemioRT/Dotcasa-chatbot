// URL de "Ver todas": https://dotcasa.com.mx/<tipo>/<operación>/<estado>/<ciudad>/<colonia>?filtros
import { test } from 'node:test';
import assert from 'node:assert/strict';
// helpers.js va primero: fija las variables de entorno antes de que se cargue config.js.
import { runChat, prop, GPS_SAN_NICOLAS } from './helpers.js';
import { buildBuscadorUrl, slugify } from '../src/modules/chatbot/buscadorUrl.js';

test('slugify quita acentos y usa guiones', () => {
  assert.equal(slugify('San Nicolás de los Garza'), 'san-nicolas-de-los-garza');
  assert.equal(slugify('Nuevo León'), 'nuevo-leon');
  assert.equal(slugify('Local Comercial'), 'local-comercial');
  // Igual que el Worker: la puntuación se conserva, solo cambian espacios.
  assert.equal(slugify('Col. Del Valle'), 'col.-del-valle');
  assert.equal(slugify('  Cumbres 2do Sector '), 'cumbres-2do-sector');
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
    [{}, {}, '/propiedades']
  ];
  for (const [params, zona, ruta] of casos) {
    assert.equal(buildBuscadorUrl(params, zona), `https://dotcasa.com.mx${ruta}`, ruta);
  }
});

test('filtros con los nombres nuevos del buscador', () => {
  const url = new URL(buildBuscadorUrl({
    Precio_min: 1000000, Precio_max: 3000000, M2_cons_min: 120, M2_cons_max: 200,
    M2_terreno_min: 150, M2_terreno_max: 300, Antiguedad: 5, Banos: 2, Habitaciones: 3, Pisos: 2
  }, {}));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    precio_min: '1000000', precio_max: '3000000', construccion_min: '120', construccion_max: '200',
    terreno_min: '150', terreno_max: '300', antiguedad: '0-5', banos: '2', recamaras: '3'
  });
});

test('sin estado se completa con el del municipio conocido', () => {
  assert.equal(buildBuscadorUrl({}, { ciudad: ['San Nicolás de los Garza'] }), 'https://dotcasa.com.mx/nuevo-leon/san-nicolas-de-los-garza');
  // Ciudad desconocida sin estado: no hay ruta de ciudad, pero no se pierde (va en la query).
  assert.equal(buildBuscadorUrl({}, { ciudad: ['Ciudad Mante'] }), 'https://dotcasa.com.mx/propiedades?ciudad=Ciudad%20Mante');
});

test('valores múltiples: la ruta lleva lo que es uno solo y el resto va en la query como lista', () => {
  const B = 'https://dotcasa.com.mx';
  const casos = [
    // varios tipos
    [{ tipoInmueble: ['Casa', 'Departamento'], tipoOperación: ['Venta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'] },
      '/venta/nuevo-leon/monterrey?tipo=casa,departamento'],
    // varias operaciones
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta', 'Renta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'] },
      '/casa/nuevo-leon/monterrey?operacion=venta,renta'],
    // varias colonias de una ciudad
    [{ tipoOperación: ['Venta'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres', 'Contry'] },
      '/venta/nuevo-leon/monterrey?colonia=Cumbres,Contry'],
    // varias ciudades del mismo estado (el estado se deduce de los municipios conocidos)
    [{ tipoInmueble: ['Casa'], tipoOperación: ['Venta'] }, { ciudad: ['Monterrey', 'San Pedro Garza García'] },
      '/casa/venta/nuevo-leon?ciudad=Monterrey,San%20Pedro%20Garza%20Garc%C3%ADa'],
    // varios estados
    [{}, { estado: ['Nuevo León', 'Jalisco'], ciudad: ['Monterrey', 'Guadalajara'] },
      '/propiedades?estado=Nuevo%20Le%C3%B3n,Jalisco&ciudad=Monterrey,Guadalajara'],
    // todo múltiple + filtros
    [{ tipoInmueble: ['Casa', 'Terreno'], tipoOperación: ['Venta', 'Preventa'], Habitaciones: 3 }, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres', 'Contry'] },
      '/nuevo-leon/monterrey?tipo=casa,terreno&operacion=venta,preventa&colonia=Cumbres,Contry&recamaras=3'],
    // repetidos (por acento o mayúsculas) cuentan una vez
    [{ tipoInmueble: ['Casa', 'casa'] }, { ciudad: ['Monterrey', 'monterrey'] }, '/casa/nuevo-leon/monterrey'],
    // /tipo/estado/ciudad/colonia no existe: la colonia va en la query
    [{ tipoInmueble: ['Casa'] }, { estado: ['Nuevo León'], ciudad: ['Monterrey'], colonia: ['Cumbres'] },
      '/casa/nuevo-leon/monterrey?colonia=Cumbres'],
    // /tipo/cp/N no existe: el CP va en la query
    [{ tipoInmueble: ['Casa'] }, { cp: '64000' }, '/casa?cp=64000']
  ];
  for (const [params, zona, esperado] of casos) {
    assert.equal(buildBuscadorUrl(params, zona), B + esperado, esperado);
  }
});

test('la query se lee de vuelta igual que en el buscador (URLSearchParams)', () => {
  const url = new URL(buildBuscadorUrl(
    { tipoInmueble: ['Casa', 'Departamento'] },
    { estado: ['Nuevo León'], ciudad: ['San Nicolás de los Garza', 'Monterrey'] }
  ));
  assert.equal(url.pathname, '/nuevo-leon');
  assert.deepEqual(url.searchParams.get('tipo').split(','), ['casa', 'departamento']);
  assert.deepEqual(url.searchParams.get('ciudad').split(','), ['San Nicolás de los Garza', 'Monterrey']);
});

test('/chat devuelve urlBuscador para "Ver todas"', async () => {
  const base = [prop({ ciudad: 'Monterrey', colonia: 'Cumbres Elite', lat: 25.73, lng: -100.40 })];
  const { json } = await runChat({
    body: { message: 'casas en venta en cumbres monterrey de 3 recamaras hasta 5 millones', history: [] },
    toolArgs: { tipoInmueble: ['Casa'], tipoOperación: ['Venta'], Colonia: ['Cumbres'], Ciudad: ['Monterrey'], Estado: ['Nuevo León'], Habitaciones: 3, Precio_max: 5000000 },
    bubble: () => base
  });
  assert.equal(json.urlBuscador, 'https://dotcasa.com.mx/casa/venta/nuevo-leon/monterrey/cumbres?precio_max=5000000&recamaras=3');
  assert.equal(json.ubicacion.buscador.url, json.urlBuscador);
});

test('/chat "cerca de mí": la URL lleva el estado y la ciudad del GPS', async () => {
  const base = [prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Anáhuac', lat: 25.7392, lng: -100.2985 })];
  const { json } = await runChat({
    body: { message: 'Muéstrame propiedades disponibles cerca de mi ubicación', history: [], location: GPS_SAN_NICOLAS },
    toolArgs: { usarUbicacionUsuario: true },
    bubble: () => base
  });
  assert.equal(json.urlBuscador, 'https://dotcasa.com.mx/nuevo-leon/san-nicolas-de-los-garza');
});
