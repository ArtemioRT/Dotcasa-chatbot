// Caso 1: Bubble tarda más de lo permitido. Antes: 500 "timeout of 15000ms
// exceeded". Ahora: se reintenta una vez y, si sigue sin responder, se
// contesta con un mensaje amable (HTTP 200) sin tirar la petición.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runChat, timeoutError, prop } from './helpers.js';

const SAN_NICOLAS = [
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Anáhuac', lat: 25.7392, lng: -100.2985 }),
  prop({ ciudad: 'San Nicolás de los Garza', colonia: 'Cuauhtémoc', lat: 25.7326, lng: -100.2920 })
];

test('Bubble lento en todos los intentos: responde 200 con aviso, no 500', async () => {
  const { status, json, bubbleCalls } = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [] },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'], Estado: ['Nuevo León'] },
    bubble: () => timeoutError()
  });
  assert.equal(status, 200);
  assert.equal(json.type, 'text');
  assert.equal(json.searchError, 'timeout');
  assert.match(json.content, /tardando/);
  // Un intento + un reintento, y no sigue con pasos más pesados del plan.
  assert.equal(bubbleCalls.length, 2);
  // El turno queda en el historial sin una búsqueda falsa que heredar.
  assert.equal(json.updatedHistory.at(-1).role, 'assistant');
  assert.ok(!json.updatedHistory.some(m => m.role === 'tool'));
});

test('Bubble lento solo la primera vez: el reintento trae los resultados', async () => {
  const { status, json, bubbleCalls } = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [] },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'] },
    bubble: (q, n) => (n === 1 ? timeoutError() : SAN_NICOLAS)
  });
  assert.equal(status, 200);
  assert.equal(json.type, 'properties');
  assert.equal(json.totalCount, 2);
  assert.equal(bubbleCalls.length, 2);
});

test('Ciudad + Estado: a Bubble solo viaja Ciudad (la consulta que se colgaba era Ciudad+Estado)', async () => {
  const { json, bubbleCalls } = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [] },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'], Estado: ['Nuevo León'] },
    bubble: () => SAN_NICOLAS
  });
  assert.equal(bubbleCalls[0].get('Ciudad'), '["San Nicolás de los Garza"]');
  assert.equal(bubbleCalls[0].get('Estado'), null);
  assert.equal(json.totalCount, 2);
});

test('OpenAI lento al extraer: responde 200 con aviso', async () => {
  const { status, json, bubbleCalls } = await runChat({
    body: { message: 'propiedad en san nicolas', history: [] },
    openai: { first: timeoutError(20000) }
  });
  assert.equal(status, 200);
  assert.equal(json.searchError, 'timeout');
  assert.equal(bubbleCalls.length, 0);
});

test('OpenAI lento al resumir: se entregan las propiedades con texto de respaldo', async () => {
  const { status, json } = await runChat({
    body: { message: 'propiedad en san nicolas de los garza', history: [] },
    toolArgs: { Ciudad: ['San Nicolás de los Garza'] },
    bubble: () => SAN_NICOLAS,
    openai: { second: timeoutError(20000) }
  });
  assert.equal(status, 200);
  assert.equal(json.type, 'properties');
  assert.equal(json.totalCount, 2);
  assert.match(json.content, /Encontré 2 propiedades/);
});
