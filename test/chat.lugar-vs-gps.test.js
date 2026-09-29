// Caso 3: con "mi ubicación" prendido, "propiedad en san nicolas" a veces
// buscaba alrededor del GPS o repetía la búsqueda anterior. El lugar escrito
// en el mensaje siempre gana.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChat, prop, GPS_SAN_NICOLAS, toolTurn } from './helpers.js';

const BASE = [
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Anáhuac', lat: 25.7392, lng: -100.2985 }),
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Cuauhtémoc', lat: 25.7326, lng: -100.2920 }),
  prop({ ciudad: 'Monterrey', colonia: 'Del Norte', lat: 25.7050, lng: -100.2950 }),
  prop({ ciudad: 'San Pedro Garza García', colonia: 'Del Valle', lat: 25.6570, lng: -100.3580 })
];

// El turno anterior fue "cerca de mi ubicación" (búsqueda por GPS).
const HISTORIAL_GPS = toolTurn({
  user: 'Muéstrame propiedades disponibles cerca de mi ubicación',
  args: { usarUbicacionUsuario: true },
  criterios: {},
  geocoded: 'Ubicación del usuario (GPS)'
});

const soloSanNicolas = (json) => json.properties.every(p => p.Ciudad === 'San Nicolás de los Garza');

test('el modelo repite usarUbicacionUsuario del turno anterior: se busca por la ciudad escrita', async () => {
  const { json, bubbleCalls } = await runChat({
    body: { message: 'propiedad en san nicolas', history: HISTORIAL_GPS, location: GPS_SAN_NICOLAS },
    toolArgs: { usarUbicacionUsuario: true },
    bubble: () => BASE
  });
  assert.equal(json.ubicacion.modo, 'ciudad');
  assert.deepEqual(json.ubicacion.ciudad, ['San Nicolás de los Garza']);
  assert.equal(bubbleCalls[0].get('Ciudad'), '["San Nicolás de los Garza"]');
  assert.equal(bubbleCalls[0].get('km'), null);
  assert.ok(soloSanNicolas(json));
  assert.equal(json.totalCount, 2);
});

test('el modelo mezcla ciudad escrita + GPS + radio: se queda solo la ciudad', async () => {
  const { json } = await runChat({
    body: { message: 'propiedad en san nicolas', history: [], location: { ...GPS_SAN_NICOLAS, colonia: 'Cuauhtémoc' } },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'], Colonia: ['Cuauhtémoc'], usarUbicacionUsuario: true, km: 5 },
    bubble: () => BASE
  });
  assert.equal(json.ubicacion.modo, 'ciudad');
  assert.deepEqual(json.ubicacion.colonia, [], 'la colonia del GPS no la escribió el usuario');
  assert.ok(soloSanNicolas(json));
  assert.equal(json.totalCount, 2);
});

test('el mismo mensaje da el mismo resultado con y sin GPS (la petición 2 es la correcta)', async () => {
  const conGPS = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: HISTORIAL_GPS, location: GPS_SAN_NICOLAS },
    toolArgs: { usarUbicacionUsuario: true, Ciudad: ['San Nicolás de los Garza'] },
    bubble: () => BASE
  });
  const sinGPS = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [], location: { lat: null, lon: null } },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'] },
    bubble: () => BASE
  });
  assert.equal(conGPS.bubbleCalls[0].toString(), sinGPS.bubbleCalls[0].toString());
  assert.deepEqual(conGPS.json.properties.map(p => p.Link).sort(), sinGPS.json.properties.map(p => p.Link).sort());
});

test('el modelo no extrae ubicación pero el mensaje la nombra: no se reusa la búsqueda anterior', async () => {
  const historialMonterrey = toolTurn({ user: 'casas en monterrey', args: { Ciudad: ['Monterrey'] }, criterios: { ciudad: ['Monterrey'] } });
  const { json } = await runChat({
    body: { message: 'y en san nicolas?', history: historialMonterrey, location: GPS_SAN_NICOLAS },
    toolArgs: {},
    bubble: () => BASE
  });
  assert.deepEqual(json.ubicacion.ciudad, ['San Nicolás de los Garza']);
  assert.ok(soloSanNicolas(json));
});

test('"sanico" como colonia se corrige a San Nicolás de los Garza', async () => {
  const { json } = await runChat({
    body: { message: 'propiedad en sanico', history: [] },
    toolArgs: { Colonia: ['Sanico'] },
    bubble: () => BASE
  });
  assert.equal(json.ubicacion.modo, 'ciudad');
  assert.deepEqual(json.ubicacion.ciudad, ['San Nicolás de los Garza']);
  assert.equal(json.totalCount, 2);
});

test('sin zona en el mensaje se conserva la de la búsqueda anterior, no la del GPS', async () => {
  const historialMonterrey = toolTurn({ user: 'casas en monterrey', args: { Ciudad: ['Monterrey'] }, criterios: { ciudad: ['Monterrey'] } });
  const { json } = await runChat({
    body: { message: 'ahora de dos pisos', history: historialMonterrey, location: GPS_SAN_NICOLAS },
    // El modelo copió la ciudad del GPS en vez de la de la conversación.
    toolArgs: { Pisos: 2, Ciudad: ['San Nicolás de los Garza'] },
    bubble: () => BASE
  });
  assert.deepEqual(json.ubicacion.ciudad, ['Monterrey']);
});

test('después de "cerca de mí", un refinamiento sin zona sigue siendo cerca de mí', async () => {
  const { json } = await runChat({
    body: { message: 'solo casas', history: HISTORIAL_GPS, location: GPS_SAN_NICOLAS },
    toolArgs: { tipoInmueble: ['Casa'] },
    bubble: () => BASE
  });
  assert.equal(json.ubicacion.modo, 'radio');
  assert.equal(json.ubicacion.geocoded, 'Ubicación del usuario (GPS)');
});

test('"cerca de mí" en un mensaje que además nombra una zona de distancia se respeta', async () => {
  const { json } = await runChat({
    body: { message: 'casas a 3 km de mi ubicación', history: [], location: GPS_SAN_NICOLAS },
    toolArgs: { usarUbicacionUsuario: true, km: 3 },
    bubble: () => BASE
  });
  assert.equal(json.ubicacion.modo, 'radio');
  assert.equal(json.ubicacion.radiusKm, 3);
});
