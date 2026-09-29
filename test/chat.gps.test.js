// Caso 2: "cerca de mi ubicación" traía fichas cuyo campo Ciudad es San Pedro
// o Monterrey, todas en el mismo punto de relleno (25.7123067,-100.2934735),
// y decía que estaban "a 1.7 km de ti".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChat, prop, GPS_SAN_NICOLAS, RELLENO } from './helpers.js';

const BASE = [
  // Coordenadas reales cerca del usuario.
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Cuauhtémoc', lat: 25.7153884, lng: -100.2837137 }),
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Bosques de Anáhuac', lat: 25.7296996, lng: -100.2778328 }),
  // Monterrey de verdad a <5 km: sí es "cerca de ti".
  prop({ ciudad: 'Monterrey', colonia: 'Del Norte', lat: 25.7050, lng: -100.2950 }),
  // Punto de relleno compartido por colonias y municipios distintos.
  prop({ ciudad: 'San Pedro Garza García', colonia: 'Valle del Seminario 1 Sector', ...RELLENO, locacion: 'Predio Aldape San Nicolás de los Garza N.L. México' }),
  prop({ ciudad: 'Monterrey', colonia: 'Centrika 1 Sector', ...RELLENO, locacion: 'Predio Aldape San Nicolás de los Garza N.L. México' }),
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Las Puentes Sector 1', ...RELLENO }),
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Residencial Anáhuac Sector 1', ...RELLENO }),
  // Lejos (Cumbres): fuera del radio.
  prop({ ciudad: 'Monterrey', colonia: 'Cumbres', lat: 25.7300, lng: -100.4000 })
];

async function cercaDeMi(toolArgs) {
  return runChat({
    body: { message: 'Muéstrame propiedades disponibles cerca de mi ubicación', history: [], location: GPS_SAN_NICOLAS },
    toolArgs,
    bubble: () => BASE
  });
}

test('cerca de mí: descarta fichas de otro municipio con coordenadas de relleno', async () => {
  const { json } = await cercaDeMi({ usarUbicacionUsuario: true });
  const colonias = json.properties.map(p => p.Colonia);
  assert.ok(!colonias.includes('Valle del Seminario 1 Sector'), 'San Pedro en punto de relleno no debe salir');
  assert.ok(!colonias.includes('Centrika 1 Sector'), 'Monterrey en punto de relleno no debe salir');
  assert.ok(!colonias.includes('Cumbres'), 'fuera del radio');
  assert.ok(colonias.includes('Cuauhtémoc'));
  assert.ok(colonias.includes('Del Norte'), 'Monterrey con coordenadas reales a <5 km sí es cercano');
  assert.equal(json.ubicacion.modo, 'radio');
  assert.equal(json.ubicacion.geocoded, 'Ubicación del usuario (GPS)');
});

test('cerca de mí: las fichas de su municipio con punto de relleno salen, pero sin distancia inventada', async () => {
  const { json } = await cercaDeMi({ usarUbicacionUsuario: true });
  const relleno = json.properties.filter(p => p.Latitud === RELLENO.lat);
  assert.equal(relleno.length, 2);
  for (const p of relleno) {
    assert.equal(p.Ciudad, 'San Nicolás de los Garza');
    assert.equal(p.Proximidad, null);
  }
  // Las de distancia real van primero.
  assert.notEqual(json.properties[0].Proximidad, null);
});

test('cerca de mí: aunque el modelo copie la ciudad del GPS, se busca por radio', async () => {
  const { json, bubbleCalls } = await cercaDeMi({ Ciudad: ['San Nicolás de los Garza'], Estado: ['Nuevo León'] });
  assert.equal(json.ubicacion.modo, 'radio');
  assert.equal(bubbleCalls[0].get('Ciudad'), null);
  assert.ok(json.properties.some(p => p.Colonia === 'Del Norte'));
});

test('búsqueda por ciudad: las fichas con punto de relleno no reportan distancia', async () => {
  const { json } = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [] },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'] },
    bubble: () => BASE
  });
  assert.ok(json.properties.every(p => p.Ciudad === 'San Nicolás de los Garza'));
  const relleno = json.properties.filter(p => p.Latitud === RELLENO.lat);
  assert.ok(relleno.length > 0);
  assert.ok(relleno.every(p => p.Proximidad === null));
});
