import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPlaceMention, mentionsOwnLocation, reconcileLocationParams,
  extractLastLocation, inheritLocation
} from '../src/modules/chatbot/locationSearch.js';
import { findSuspiciousCoordKeys, filterByProximity } from '../src/modules/chatbot/bubble.js';
import { toolTurn, prop, RELLENO, GPS_SAN_NICOLAS } from './helpers.js';

test('extractPlaceMention reconoce el lugar escrito', () => {
  const casos = {
    'propiedad en san nicolas': 'san nicolas',
    'casa en venta en san nicolas de los garza': 'san nicolas de los garza',
    'casas en Cumbres con alberca': 'cumbres',
    'casa de 3 recamaras en monterrey de 2 pisos': 'monterrey',
    'terreno en la colonia del valle': 'del valle',
    'quiero casa en Monterrey por menos de 3 millones': 'monterrey',
    'algo por san pedro': 'san pedro'
  };
  for (const [msg, esperado] of Object.entries(casos)) assert.equal(extractPlaceMention(msg), esperado, msg);
  for (const msg of ['departamento en renta', 'ahora de dos pisos', 'Muéstrame propiedades cerca de mi ubicación', 'casa en venta']) {
    assert.equal(extractPlaceMention(msg), null, msg);
  }
});

test('mentionsOwnLocation', () => {
  assert.ok(mentionsOwnLocation('Muéstrame propiedades disponibles cerca de mi ubicación'));
  assert.ok(mentionsOwnLocation('algo por aquí'));
  assert.ok(!mentionsOwnLocation('propiedad en san nicolas'));
});

test('reconcileLocationParams: el lugar escrito apaga el GPS', () => {
  const { params } = reconcileLocationParams(
    { usarUbicacionUsuario: true, km: 5 },
    { message: 'propiedad en san nicolas', userLocation: GPS_SAN_NICOLAS }
  );
  assert.equal(params.usarUbicacionUsuario, undefined);
  assert.equal(params.km, undefined);
  assert.deepEqual(params.Ciudad, ['San Nicolás de los Garza']);
});

test('reconcileLocationParams: conserva km si el usuario pidió distancia', () => {
  const { params } = reconcileLocationParams(
    { Colonia: ['Cumbres'], km: 5 },
    { message: 'casas a 5 km de cumbres', userLocation: GPS_SAN_NICOLAS }
  );
  assert.equal(params.km, 5);
});

test('extractLastLocation solo mira la búsqueda más reciente', () => {
  const history = [
    ...toolTurn({ user: 'casas en monterrey', args: { Ciudad: ['Monterrey'] }, criterios: { ciudad: ['Monterrey'] } }),
    ...toolTurn({ user: 'cerca de mí', args: { usarUbicacionUsuario: true }, criterios: {}, geocoded: 'Ubicación del usuario (GPS)' })
  ];
  const previa = extractLastLocation(history);
  assert.equal(previa.gps, true);
  assert.deepEqual(previa.ciudad, []);
  assert.equal(inheritLocation({}, history, { gpsDisponible: false }).heredada, null);
  assert.equal(inheritLocation({}, history).params.usarUbicacionUsuario, true);
});

test('findSuspiciousCoordKeys: un edificio con varias unidades no es relleno', () => {
  const edificio = [1, 2, 3, 4].map(() => prop({ ciudad: 'Monterrey', colonia: 'Centro', lat: 25.67, lng: -100.31 }));
  assert.equal(findSuspiciousCoordKeys(edificio).size, 0);
  const relleno = [
    prop({ ciudad: 'San Pedro Garza García', colonia: 'A', ...RELLENO }),
    prop({ ciudad: 'Monterrey', colonia: 'B', ...RELLENO }),
    prop({ ciudad: 'San Nicolás de los Garza', colonia: 'C', ...RELLENO })
  ];
  const keys = findSuspiciousCoordKeys(relleno);
  assert.equal(keys.size, 1);
  const cerca = filterByProximity(relleno, { lat: GPS_SAN_NICOLAS.lat, lng: GPS_SAN_NICOLAS.lon }, 5, { suspiciousKeys: keys, refCiudad: 'San Nicolás de los Garza' });
  assert.deepEqual(cerca.map(p => p.Colonia), ['C']);
  assert.equal(cerca[0].Proximidad, null);
});
