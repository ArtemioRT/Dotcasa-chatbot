// Arranca el router de /chat con Bubble y OpenAI simulados (se reemplazan
// axios.get / axios.post), para probar la petición completa sin red.
process.env.OPENAI_API_KEY = 'test-key';
process.env.BUBBLE_SEARCH_URL = 'https://bubble.test/api/1.1/wf/search';
process.env.MAPBOX_ACCESS_TOKEN = '';
process.env.CHAT_LOG_MODE = 'off';
process.env.DEBUG_DUMP_MODE = 'off';
process.env.BUBBLE_TIMEOUT_MS = '200';
process.env.BUBBLE_SEARCH_BUDGET_MS = '2000';
process.env.OPENAI_TIMEOUT_MS = '200';

import axios from 'axios';
import express from 'express';

const { default: chatRoutes } = await import('../src/modules/chatbot/chat.routes.js');

export function timeoutError(ms = 15000) {
  return Object.assign(new Error(`timeout of ${ms}ms exceeded`), { code: 'ECONNABORTED' });
}

// bubble: (query: URLSearchParams, n: número de llamada) => array | Error
// toolArgs: argumentos que "extrae" el modelo en la primera llamada.
export async function runChat({ body, toolArgs = {}, bubble = () => [], openai = {} }) {
  const bubbleCalls = [];
  const openaiCalls = [];
  const originalGet = axios.get;
  const originalPost = axios.post;

  axios.get = async (url) => {
    if (!url.startsWith(process.env.BUBBLE_SEARCH_URL)) throw new Error(`GET inesperado: ${url}`);
    const query = new URL(url).searchParams;
    bubbleCalls.push(query);
    const out = await bubble(query, bubbleCalls.length);
    if (out instanceof Error) throw out;
    return { data: { response: { Propiedades: out } } };
  };
  axios.post = async (url, payload) => {
    openaiCalls.push(payload);
    const n = openaiCalls.length;
    if (n === 1 && openai.first instanceof Error) throw openai.first;
    if (n === 2 && openai.second instanceof Error) throw openai.second;
    if (n === 1) {
      return { data: { choices: [{ message: {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'call_test', type: 'function', function: { name: 'buscarPropiedades', arguments: JSON.stringify(toolArgs) } }]
      } }] } };
    }
    return { data: { choices: [{ message: { role: 'assistant', content: 'Resumen de prueba.' } }] } };
  };

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(chatRoutes);
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const silenciar = ['log', 'warn', 'error'].map(k => [k, console[k]]);
  for (const [k] of silenciar) console[k] = () => {};
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: res.status, json: await res.json(), bubbleCalls, openaiCalls };
  } finally {
    for (const [k, fn] of silenciar) console[k] = fn;
    axios.get = originalGet;
    axios.post = originalPost;
    await new Promise(resolve => server.close(resolve));
  }
}

// Fichas mínimas con la forma que devuelve Bubble.
export function prop({ ciudad, colonia, lat, lng, tipo = 'Casa', precio = 3000000, estado = 'Nuevo León', locacion }) {
  return {
    Tipo_de_inmueble: tipo, Tipo: 'Venta', Ciudad: ciudad, Estado: estado, Colonia: colonia,
    Precio: String(precio), Latitud: lat, Longitud: lng,
    Locación: locacion || `${colonia} ${ciudad} N.L. México`,
    Link: `https://dotcasa.com.mx/detalle_propiedad/${encodeURIComponent(colonia)}-${lat}`
  };
}

// Ubicación GPS del usuario en San Nicolás (la de la petición 1 del reporte).
export const GPS_SAN_NICOLAS = {
  estado: 'Nuevo León', ciudad: 'San Nicolás de los Garza', colonia: null,
  lat: 25.71659223819941, lon: -100.2772054269506
};

// Punto de relleno que comparten decenas de fichas en la base real.
export const RELLENO = { lat: 25.7123067, lng: -100.2934735 };

// Mensaje de tool de una búsqueda anterior, como lo guarda updatedHistory.
export function toolTurn({ user, args, criterios, geocoded = null }) {
  return [
    { role: 'user', content: user },
    { role: 'assistant', content: null, tool_calls: [{ id: `c_${user.length}`, type: 'function', function: { name: 'buscarPropiedades', arguments: JSON.stringify(args) } }] },
    { role: 'tool', tool_call_id: `c_${user.length}`, content: JSON.stringify({
      success: true, count: 5, ubicacionGeocoded: geocoded,
      busquedaCriterios: { ciudad: [], colonia: [], estado: [], ...criterios }
    }) },
    { role: 'assistant', content: 'Resumen anterior.' }
  ];
}
