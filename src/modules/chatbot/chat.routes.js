// ============================================================================
// MÓDULO CHATBOT — ENDPOINT /chat (DotCasa AI)
// ============================================================================
import { Router } from 'express';
import axios from 'axios';
import {
  OPENAI_API_KEY, MIN_VISIBLE_TARGET,
  INITIAL_DISPLAY_COUNT, MAX_PROPERTIES_TO_SHOW
} from '../../shared/config.js';
import { parseBubbleNumber, normalizeSearchText } from '../../shared/utils.js';
import {
  newRequestId, chatLogEnabled, logChatRequest, logChatResponse
} from '../../shared/gcsDebug.js';
import { geocodeLocation, parseLocacionSmart, reverseGeocode } from './geocoding.js';
import {
  searchBubble, filterByProximity, annotateProximity,
  validateCriteriaMatch, getPropNum
} from './bubble.js';
import {
  resolveLocationIntent, buildSearchPlan, filterByAdminLocation,
  inheritLocation, SEARCH_MODE
} from './locationSearch.js';
import { classifyAndScoreProperties, formatProperties } from './scoring.js';
import {
  buildSystemPrompt, CHAT_TOOLS,
  isSearchQuery, inferTipoInmuebleFromMessage,
  sanitizeParams, cleanHistory, extractFallbackLocacion
} from './prompt.js';
import {
  checkUserMessage, checkAssistantReply, isDotcasaInfoQuery, getRespuesta, resumenRespaldo
} from './guardrails.js';

const router = Router();

router.post('/chat', async (req, res) => {
  const t0 = Date.now();
  const requestId = newRequestId();
  // Consultas enviadas a Bubble en esta petición, para la bitácora.
  const consultasBubble = [];
  console.log('\n' + '='.repeat(70));
  console.log(`CHAT — DotCasa AI | req ${requestId}`);
  console.log('='.repeat(70));

  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY no configurada' });
    const { message, history = [], location: rawLocation = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'message es requerido' });

    // Bitácora de entrada. Sin await: tiene toda la petición para completarse
    // y no debe sumarle latencia a la respuesta.
    if (chatLogEnabled()) {
      logChatRequest(requestId, {
        entrada: { message, history, location: rawLocation },
        historyLength: history.length
      }).catch(err => console.error(`Bitácora entrada falló: ${err.message}`));
    }

    // El navegador solo manda lat/lon. Se traducen a colonia/ciudad/estado para
    // que "cerca de mí" pueda resolverse como una zona y no solo como un punto.
    let userLocation = rawLocation;
    if (rawLocation?.lat != null && rawLocation?.lon != null && !rawLocation.ciudad) {
      const rev = await reverseGeocode(rawLocation.lat, rawLocation.lon);
      if (rev) {
        userLocation = { ...rawLocation, colonia: rev.colonia, ciudad: rev.ciudad, estado: rev.estado };
        console.log(`GPS resuelto | ${rev.colonia || '-'} / ${rev.ciudad || '-'} / ${rev.estado || '-'}`);
      }
    }

    // Registra la salida y responde. Se espera al guardado (unos ms sobre una
    // petición de varios segundos) para no perder registros si la instancia se
    // apaga justo después de responder.
    const responder = async (payload, extra = {}) => {
      if (chatLogEnabled()) {
        await logChatResponse(requestId, {
          duracionMs: Date.now() - t0,
          consultasBubble,
          ...extra,
          salida: payload
        }).catch(err => console.error(`Bitácora salida falló: ${err.message}`));
      }
      return res.json(payload);
    };

    // -----------------------------------------------------------------------
    // 0) GUARDRAILS — solo propiedades y DotCasa. Lo demás se contesta aquí
    //    sin llamar a OpenAI. El turno bloqueado NO entra al historial, para
    //    que un intento de desvío no contamine los siguientes turnos.
    // -----------------------------------------------------------------------
    const esBusqueda = isSearchQuery(message);
    const guard = checkUserMessage(message, { tieneIntencionInmobiliaria: esBusqueda });
    if (!guard.permitido) {
      console.log(`Mensaje bloqueado | categoria=${guard.categoria}`);
      return responder(
        { type: 'text', content: guard.respuesta, updatedHistory: history, blocked: true, blockedReason: guard.categoria, lang: guard.lang },
        { sinBusqueda: true, motivo: `guardrail: ${guard.categoria}`, idiomaDetectado: guard.lang }
      );
    }

    // Idioma aproximado del mensaje, solo para los textos de respaldo. El
    // modelo responde por su cuenta en el idioma del usuario.
    const lang = guard.lang;
    const conversationHistory = [...history, { role: 'user', content: message }];
    const esInfoDotcasa = isDotcasaInfoQuery(message);
    // Las preguntas sobre DotCasa ("¿cuánto cuesta publicar propiedades?")
    // traen palabras de búsqueda, pero no deben forzar buscarPropiedades.
    const inferredMessageLocacion = esInfoDotcasa ? null : extractFallbackLocacion(message);
    const forceSearch = !esInfoDotcasa && (esBusqueda || Boolean(inferredMessageLocacion));

    const firstRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: buildSystemPrompt(userLocation) }, ...cleanHistory(conversationHistory)],
        tools: CHAT_TOOLS,
        tool_choice: forceSearch ? { type: 'function', function: { name: 'buscarPropiedades' } } : 'auto',
        temperature: 0.1
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const assistantMsg = firstRes.data.choices[0].message;
    if (!assistantMsg.tool_calls?.length) {
      const revision = checkAssistantReply(assistantMsg.content);
      if (!revision.seguro) {
        console.warn(`Respuesta del modelo reemplazada | problemas=${revision.problemas.join(',')}`);
        return responder(
          { type: 'text', content: getRespuesta('fueraDeTema', lang), updatedHistory: history, blocked: true, blockedReason: 'respuesta_modelo' },
          { sinBusqueda: true, motivo: `guardrail salida: ${revision.problemas.join(',')}`, respuestaOriginal: assistantMsg.content }
        );
      }
      const updated = [...conversationHistory, { role: 'assistant', content: assistantMsg.content }];
      return responder(
        { type: 'text', content: assistantMsg.content, updatedHistory: updated },
        { sinBusqueda: true, motivo: esInfoDotcasa ? 'pregunta sobre DotCasa' : 'el modelo no llamó a buscarPropiedades' }
      );
    }

    const toolCall = assistantMsg.tool_calls[0];
    let params = JSON.parse(toolCall.function.arguments);

    // La inferencia por palabras clave es solo un respaldo: si el modelo ya
    // extrajo un tipo (del mensaje o del historial), no se pisa. Antes
    // reemplazaba siempre, y "cerca de mi casa" metía un filtro de Casa.
    // Va antes de sanitizeParams para que también se canonicalice y filtre.
    if (!params.tipoInmueble?.length) {
      const inferredTipos = inferTipoInmuebleFromMessage(message);
      if (inferredTipos.length > 0) params.tipoInmueble = inferredTipos;
    }
    params = sanitizeParams(params);
    if (!params.Locacion && inferredMessageLocacion) params.Locacion = inferredMessageLocacion;

    // De dónde salió la ubicación de esta búsqueda. Se le informa al modelo
    // para que sea transparente ("te muestro en X, tu ubicación") y ofrezca
    // cambiar de zona, en vez de asumir en silencio.
    let origenUbicacion = 'ninguna';
    const teniaUbicacionPropia = Boolean(
      params.Ciudad?.length || params.Colonia?.length || params.Estado?.length
      || params.Locacion || params.usarUbicacionUsuario || params.km != null
    );
    if (teniaUbicacionPropia) origenUbicacion = 'mensaje';

    // Si este turno no menciona ubicación, se hereda la del turno anterior
    // ("casa en Monterrey" -> "ahora de dos pisos" sigue siendo Monterrey).
    const herencia = inheritLocation(params, history);
    params = herencia.params;
    if (herencia.heredada) {
      origenUbicacion = 'conversacion';
      console.log(`Ubicación heredada del turno anterior | ciudad=[${herencia.heredada.ciudad.join('|') || '-'}] colonia=[${herencia.heredada.colonia.join('|') || '-'}]`);
    }

    // Sin ubicación propia ni heredada, se cae al GPS del usuario si lo dio.
    if (!herencia.heredada && !teniaUbicacionPropia && userLocation?.ciudad) {
      params.Ciudad = [userLocation.ciudad];
      if (userLocation.estado) params.Estado = [userLocation.estado];
      origenUbicacion = 'gps';
      console.log(`Ubicación tomada del GPS | ciudad=${userLocation.ciudad}`);
    }

    // -----------------------------------------------------------------------
    // 1) RESOLVER UBICACIÓN — convierte lo extraído por el LLM en una intención
    //    estructurada y decide el modo (administrativo vs geográfico).
    // -----------------------------------------------------------------------
    // Si el LLM solo llenó "Locacion" con algo tipo "Cumbres, Monterrey",
    // lo descomponemos en colonia/ciudad/estado con Mapbox antes de resolver.
    if (params.Locacion && !params.Ciudad?.length && !params.Colonia?.length && !params.Estado?.length) {
      const parsed = await parseLocacionSmart(params.Locacion);
      if (parsed.colonia.length) params.Colonia = parsed.colonia;
      if (parsed.ciudad.length)  params.Ciudad  = parsed.ciudad;
      if (parsed.estado.length)  params.Estado  = parsed.estado;
      // Si resultó ser puramente administrativo, Locacion deja de ser un punto.
      const resolvioAdmin = params.Ciudad?.length || params.Colonia?.length || params.Estado?.length;
      if (resolvioAdmin && params.km == null) params.Locacion = null;
    }

    const intent = resolveLocationIntent(params, userLocation);
    const plan = buildSearchPlan(intent);
    console.log(`Ubicación resuelta | modo=${intent.mode} ciudad=[${intent.ciudad.join('|') || '-'}] colonia=[${intent.colonia.join('|') || '-'}] estado=[${intent.estado.join('|') || '-'}] km=${intent.km ?? '-'}`);
    console.log(`Plan de búsqueda: ${plan.map(s => s.etiqueta).join(' -> ')}`);

    const userSpecifiedRadius = intent.kmExplicito;
    let properties = [], usedRadius = null, isExactMatch = true, refCoords = null;
    let geocodedDisplay = null;
    let locationMatchType = intent.mode === SEARCH_MODE.NONE ? 'not_requested' : 'none';

    // -----------------------------------------------------------------------
    // 2) GEOCODIFICAR — solo si hace falta un punto de referencia.
    // -----------------------------------------------------------------------
    const necesitaCoords = plan.some(s => s.tipo === 'geo');
    if (necesitaCoords) {
      if (intent.gpsCoords) {
        refCoords = intent.gpsCoords;
        geocodedDisplay = 'Ubicación del usuario (GPS)';
      } else if (intent.referencia) {
        refCoords = await geocodeLocation(intent.referencia);
        geocodedDisplay = refCoords?.displayName || intent.referencia;
      }
    }

    // -----------------------------------------------------------------------
    // 3) EJECUTAR EL PLAN — cada paso es una estrategia DISTINTA, no el mismo
    //    query con otro radio. Se corta en cuanto un paso da resultados.
    // -----------------------------------------------------------------------
    const runStep = async (step) => {
      const searchParams = { ...params };
      // Cada paso define su propia ubicación; limpiamos lo que no aplique.
      delete searchParams.Ciudad; delete searchParams.Estado; delete searchParams.Colonia;
      delete searchParams.Locacion; delete searchParams.km;

      if (step.tipo === 'admin') {
        if (step.ciudad)  searchParams.Ciudad  = step.ciudad;
        if (step.estado)  searchParams.Estado  = step.estado;
        if (step.colonia) searchParams.Colonia = step.colonia;
      } else if (step.tipo === 'geo') {
        if (!refCoords) return null; // sin punto de referencia no hay geo
        searchParams.LocacionBubble = intent.referencia || null;
        searchParams.km = step.km;
      }

      const registrarQuery = (qs) => consultasBubble.push({ etiqueta: step.etiqueta, query: qs });

      // exactMatch=no es el modo por defecto. Si Bubble no devuelve nada, se
      // reintenta la MISMA consulta con exactMatch=yes, que flexibiliza el
      // criterio del lado de Bubble.
      let results = await searchBubble({ ...searchParams, exactMatch: 'no' }, { onQuery: registrarQuery });
      let usoReintentoExactMatch = false;
      if (results.length === 0) {
        results = await searchBubble({ ...searchParams, exactMatch: 'yes' }, { onQuery: registrarQuery });
        usoReintentoExactMatch = true;
        console.log(`  [${step.etiqueta}] 0 resultados con exactMatch=no, reintento con exactMatch=yes -> ${results.length}`);
      }
      const countBubble = results.length;

      results = results.filter(prop => validateCriteriaMatch(prop, params, false));
      const countCriteria = results.length;
      const allExactMatch = results.length > 0 && results.every(prop => validateCriteriaMatch(prop, params, true));

      let matchType = 'not_requested';
      if (step.tipo === 'admin') {
        // Filtro por NOMBRE sobre Ciudad/Estado/Colonia. Sin radio: una ciudad
        // no es un punto, así que la distancia solo se anota para ordenar.
        const adminFiltered = filterByAdminLocation(results, {
          ciudad: step.ciudad, estado: step.estado, colonia: step.colonia
        });
        results = adminFiltered.properties;
        matchType = adminFiltered.matchType;
        if (refCoords) results = annotateProximity(results, refCoords);
      } else if (step.tipo === 'geo') {
        results = filterByProximity(results, refCoords, step.km);
        matchType = results.length ? 'geo' : 'none';
      }

      console.log(`  [${step.etiqueta}] Bubble: ${countBubble} -> criterios: ${countCriteria} -> ubicación: ${results.length}`);
      return {
        results,
        // Si hubo que reintentar, los resultados ya no son coincidencia estricta.
        exactMatchUsed: allExactMatch && !usoReintentoExactMatch,
        usoReintentoExactMatch,
        locationMatchType: matchType,
        radiusKm: step.tipo === 'geo' ? step.km : null
      };
    };

    let usedStep = null;
    for (const step of plan) {
      if (step.tipo === 'none') {
        const attempt = await runStep({ ...step, tipo: 'admin' });
        if (attempt) {
          properties = attempt.results;
          if (!attempt.exactMatchUsed) isExactMatch = false;
          locationMatchType = attempt.locationMatchType;
          usedStep = step;
        }
        break;
      }
      const attempt = await runStep(step);
      if (!attempt) continue;
      const visibles = classifyAndScoreProperties(attempt.results, params, refCoords).allClassified.length;
      // Nos quedamos con el primer paso que produzca resultados visibles.
      if (visibles > 0 || (!usedStep && attempt.results.length > 0)) {
        properties = attempt.results;
        if (!attempt.exactMatchUsed) isExactMatch = false;
        locationMatchType = attempt.locationMatchType;
        usedRadius = attempt.radiusKm;
        usedStep = step;
        break;
      }
      if (!usedStep) { usedStep = step; usedRadius = attempt.radiusKm; }
    }
    if (usedStep) console.log(`Estrategia usada: ${usedStep.etiqueta} | ${properties.length} propiedades`);

    const { exacta, cumple, cercana, recomendada, descartada, top3, allClassified } = classifyAndScoreProperties(properties, params, refCoords);
    const totalCount = allClassified.length;
    const displayProperties = allClassified.slice(0, Math.min(MAX_PROPERTIES_TO_SHOW, totalCount));

    const propertiesSummary = top3.map((prop, idx) => ({
      posicion: idx + 1,
      tipo: prop['Tipo_de_inmueble'] || prop['tipo_de_inmueble'] || '',
      habitaciones: getPropNum(prop, ['N_Habitaciones', 'Habitaciones', 'habitaciones']),
      banos: getPropNum(prop, ['N_Banos', 'Banos', 'banos']),
      // null = el dato no existe en la ficha. NO afirmes nada sobre él.
      pisos: getPropNum(prop, ['Pisos', 'N_pisos', 'pisos']),
      precio: getPropNum(prop, ['Precio', 'precio']),
      colonia: prop['Colonia'] || prop['colonia'] || null,
      proximidad_km: parseBubbleNumber(prop['Proximidad'] ?? prop['proximidad']),
      clasificacion: prop.__classification__,
      score: prop.__score__
    }));

    // Agregados de TODO el conjunto, no solo del top 3, para que el modelo
    // pueda resumir ("van de X a Y") en vez de enumerar tres fichas.
    const precios = allClassified
      .map(p => getPropNum(p, ['Precio', 'precio']))
      .filter(v => v != null && v > 0)
      .sort((a, b) => a - b);
    // Se agrupa por nombre normalizado para no partir la misma colonia en dos
    // ("Benito Juárez" y "Benito Juarez"), conservando la grafía más común.
    const colonias = new Map();
    for (const p of allClassified) {
      const c = p['Colonia'] || p['colonia'];
      if (!c) continue;
      const clave = normalizeSearchText(c);
      const previo = colonias.get(clave);
      colonias.set(clave, { nombre: previo?.nombre || c, n: (previo?.n || 0) + 1 });
    }
    // Cuántas cumplen de verdad el criterio de pisos: las que traen el dato
    // vacío pasaron el filtro por omisión, no por cumplirlo.
    const conPisosConfirmados = params.Pisos != null
      ? allClassified.filter(p => getPropNum(p, ['Pisos', 'N_pisos', 'pisos']) === params.Pisos).length
      : null;
    const sinDatoPisos = params.Pisos != null
      ? allClassified.filter(p => getPropNum(p, ['Pisos', 'N_pisos', 'pisos']) == null).length
      : null;

    const resumenResultados = {
      precioMin: precios[0] ?? null,
      precioMax: precios[precios.length - 1] ?? null,
      precioMediana: precios.length ? precios[Math.floor(precios.length / 2)] : null,
      coloniasPrincipales: [...colonias.values()]
        .sort((a, b) => b.n - a.n).slice(0, 4)
        .map(({ nombre, n }) => `${nombre} (${n})`),
      pisosSolicitados: params.Pisos ?? null,
      conPisosConfirmados,
      sinDatoDePisos: sinDatoPisos
    };

    // Qué representan los valores de proximidad_km. Sin esto el modelo asume
    // que son distancias al usuario, y afirma "a 0.85 km de ti" sobre
    // propiedades que están a cientos de kilómetros.
    const proximidadReferencia = refCoords
      ? (geocodedDisplay === 'Ubicación del usuario (GPS)'
          ? 'DISTANCIA REAL AL USUARIO: puedes decir "de ti" o "de tu ubicación".'
          : `Distancia al centro de "${geocodedDisplay}", NO al usuario. NUNCA digas "de ti" ni "de tu ubicación" con estos valores; si acaso, di "del centro de la zona".`)
      : 'No se calcularon distancias. NO menciones cercanía ni kilómetros.';

    const pidioUbicacion = intent.mode !== SEARCH_MODE.NONE;
    // Descripción legible de la ubicación efectivamente buscada.
    const ubicacionBuscada = pidioUbicacion
      ? ([...intent.colonia, ...intent.ciudad, ...intent.estado].join(', ') || intent.referencia)
      : null;

    const isCriteriaExactMatch = isExactMatch;
    const isLocationExactMatch = locationMatchType === 'exact' || locationMatchType === 'geo';
    const overallExactMatch = isCriteriaExactMatch && (!pidioUbicacion || isLocationExactMatch);
    const legacyExactMatch = pidioUbicacion ? isLocationExactMatch : isCriteriaExactMatch;

    const histWithTool = [
      ...conversationHistory, assistantMsg,
      {
        role: 'tool', tool_call_id: toolCall.id,
        content: JSON.stringify({
          success: true, count: totalCount,
          displayedCount: displayProperties.length,
          isExactMatch: legacyExactMatch, isCriteriaExactMatch,
          isOverallExactMatch: overallExactMatch, isLocationExactMatch,
          locationMatchType, ubicacionBuscada,
          ubicacionGeocoded: geocodedDisplay, radiusKm: usedRadius,
          radiusAutoScaled: !userSpecifiedRadius && totalCount > 0,
          // Cómo se buscó: por nombre (ciudad/colonia/estado) o por distancia.
          modoBusqueda: intent.mode,
          estrategiaUsada: usedStep?.etiqueta || null,
          // De dónde salió la ubicación: 'mensaje' (la pidió en este turno),
          // 'conversacion' (heredada del turno anterior), 'gps' (su ubicación
          // actual) o 'ninguna'. Si es 'gps' o 'conversacion', DILO en la
          // respuesta y ofrece cambiar de zona.
          origenUbicacion,
          ubicacionGPSDisponible: userLocation?.ciudad
            ? [userLocation.colonia, userLocation.ciudad, userLocation.estado].filter(Boolean).join(', ')
            : null,
          clasificacion: {
            exacta: exacta.length, cumple: cumple.length, cercana: cercana.length,
            recomendada: recomendada.length, descartada: descartada.length,
            totalMostradas: totalCount
          },
          propiedadesMostradas: propertiesSummary,
          proximidadReferencia,
          resumenResultados,
          busquedaCriterios: {
            habitaciones: params.Habitaciones || null, banos: params.Banos || null,
            pisos: params.Pisos || null,
            precio_min: params.Precio_min || null, precio_max: params.Precio_max || null,
            m2_construccion_min: params.M2_cons_min || null, m2_construccion_max: params.M2_cons_max || null,
            m2_terreno_min: params.M2_terreno_min || null, m2_terreno_max: params.M2_terreno_max || null,
            tipoOperacion: params.tipoOperación?.join(', ') || null,
            ciudad: intent.ciudad, colonia: intent.colonia, estado: intent.estado,
            tipo: params.tipoInmueble || []
          },
          sugerenciasAlternativas: totalCount === 0 ? {
            contexto: 'NO HAY RESULTADOS - SE PROACTIVO',
            posiblesCausas: [
              params.Habitaciones ? `Pocos resultados de ${params.Habitaciones} recamaras en esta zona` : '',
              params.Precio_max ? `Criterios restrictivos` : '',
              pidioUbicacion ? `Zona con pocos datos` : 'Sin ubicacion'
            ].filter(Boolean),
            alternativas: [
              params.Habitaciones ? `Flexibilizar recamaras` : '',
              params.Precio_max ? `Expandir presupuesto` : '',
              params.tipoOperación?.some(op => /venta/i.test(op)) ? `Incluir opciones de renta` : '',
              intent.colonia.length ? `Ampliar de la colonia a toda la ciudad` : '',
              intent.ciudad.length ? `Buscar en municipios cercanos` : '',
              `Cambiar tipo de inmueble`
            ].filter(Boolean)
          } : null
        })
      }
    ];

    const secondRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: buildSystemPrompt(userLocation) }, ...cleanHistory(histWithTool)]
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const finalMsg = secondRes.data.choices[0].message;
    const revisionFinal = checkAssistantReply(finalMsg.content);
    if (!revisionFinal.seguro) {
      console.warn(`Resumen del modelo reemplazado | problemas=${revisionFinal.problemas.join(',')}`);
      finalMsg.content = resumenRespaldo(lang, totalCount);
    }
    let updatedHistory = [...histWithTool, { role: 'assistant', content: finalMsg.content }];
    if (updatedHistory.length > 12) {
      let idx = updatedHistory.length - 12;
      while (idx > 0 && updatedHistory[idx].role === 'tool') idx--;
      while (idx < updatedHistory.length && updatedHistory[idx].role !== 'user') idx++;
      updatedHistory = updatedHistory.slice(idx);
    }

    console.log(`CHAT OK ${((Date.now() - t0) / 1000).toFixed(2)}s | ${totalCount} propiedades`);
    const formattedProperties = formatProperties(displayProperties);
    const hasMoreAvailable = (totalCount > INITIAL_DISPLAY_COUNT) || (descartada.length > 0);

    return responder({
      type: totalCount > 0 ? 'properties' : 'text',
      content: finalMsg.content || '',
      properties: formattedProperties,
      totalCount, displayedCount: displayProperties.length,
      hasMore: hasMoreAvailable,
      moreInfo: {
        initialDisplay: INITIAL_DISPLAY_COUNT,
        visiblesEnMemoria: displayProperties.length,
        descartadasEnBubble: descartada.length,
        totalEnBubble: totalCount + descartada.length
      },
      isExactMatch: legacyExactMatch, isCriteriaExactMatch,
      isOverallExactMatch: overallExactMatch, isLocationExactMatch,
      locationMatchType, searchParams: params,
      classification: {
        exacta: exacta.length, cumple: cumple.length, cercana: cercana.length,
        recomendada: recomendada.length, descartada: descartada.length,
        totalClassified: totalCount
      },
      scoring: { version: '2.3', engine: 'Multi-factor balanceado' },
      ubicacion: {
        query: intent.referencia || null, geocoded: geocodedDisplay,
        lat: refCoords?.lat || null, lng: refCoords?.lng || null,
        radiusKm: usedRadius, radiusAutoScaled: !userSpecifiedRadius && totalCount > 0,
        modo: intent.mode, estrategia: usedStep?.etiqueta || null,
        colonia: intent.colonia, ciudad: intent.ciudad, estado: intent.estado
      },
      updatedHistory
    }, {
      // Contexto de auditoría: qué extrajo el modelo y cómo se resolvió.
      paramsExtraidos: params,
      intencionUbicacion: {
        modo: intent.mode, ciudad: intent.ciudad, colonia: intent.colonia,
        estado: intent.estado, km: intent.km, origen: origenUbicacion
      },
      estrategiaUsada: usedStep?.etiqueta || null
    });

  } catch (err) {
    console.error(`CHAT ERROR [req ${requestId}]:`, err.response?.data || err.message);
    if (chatLogEnabled()) {
      await logChatResponse(requestId, {
        duracionMs: Date.now() - t0,
        consultasBubble,
        error: { message: err.message, stack: err.stack, detalle: err.response?.data ?? null },
        salida: null
      }).catch(e => console.error(`Bitácora error falló: ${e.message}`));
    }
    res.status(500).json({ error: 'Error interno', message: err.message });
  }
});

export default router;