// ============================================================================
// MÓDULO CHATBOT — ENDPOINT /chat (DotCasa AI)
// ============================================================================
import { Router } from 'express';
import axios from 'axios';
import {
  OPENAI_API_KEY, MIN_VISIBLE_TARGET,
  INITIAL_DISPLAY_COUNT, MAX_PROPERTIES_TO_SHOW
} from '../../shared/config.js';
import { parseBubbleNumber } from '../../shared/utils.js';
import { geocodeLocation, parseLocacionSmart } from './geocoding.js';
import {
  searchBubble, filterByProximity, annotateProximity,
  validateCriteriaMatch, getPropNum
} from './bubble.js';
import {
  resolveLocationIntent, buildSearchPlan, filterByAdminLocation, SEARCH_MODE
} from './locationSearch.js';
import { classifyAndScoreProperties, formatProperties } from './scoring.js';
import {
  buildSystemPrompt, CHAT_TOOLS,
  isSearchQuery, inferTipoInmuebleFromMessage,
  sanitizeParams, cleanHistory, extractFallbackLocacion
} from './prompt.js';

const router = Router();

router.post('/chat', async (req, res) => {
  const t0 = Date.now();
  console.log('\n' + '='.repeat(70));
  console.log('CHAT — DotCasa AI');
  console.log('='.repeat(70));

  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY no configurada' });
    const { message, history = [], location: userLocation = {} } = req.body;
    if (!message) return res.status(400).json({ error: 'message es requerido' });

    const conversationHistory = [...history, { role: 'user', content: message }];
    const inferredMessageLocacion = extractFallbackLocacion(message);
    const forceSearch = isSearchQuery(message) || Boolean(inferredMessageLocacion);

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
      const updated = [...conversationHistory, { role: 'assistant', content: assistantMsg.content }];
      return res.json({ type: 'text', content: assistantMsg.content, updatedHistory: updated });
    }

    const toolCall = assistantMsg.tool_calls[0];
    let params = JSON.parse(toolCall.function.arguments);
    params = sanitizeParams(params);

    const inferredTipos = inferTipoInmuebleFromMessage(message);
    if (inferredTipos.length > 0) params.tipoInmueble = inferredTipos;
    if (!params.Locacion && inferredMessageLocacion) params.Locacion = inferredMessageLocacion;

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

      let results = await searchBubble(searchParams);
      let exactMatchUsed = true;
      if (searchParams.exactMatch === 'yes' && results.length === 0) {
        results = await searchBubble({ ...searchParams, exactMatch: 'no' });
        exactMatchUsed = false;
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
        exactMatchUsed: exactMatchUsed && allExactMatch,
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
      precio: getPropNum(prop, ['Precio', 'precio']),
      proximidad_km: parseBubbleNumber(prop['Proximidad'] ?? prop['proximidad']),
      clasificacion: prop.__classification__,
      score: prop.__score__
    }));

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
          clasificacion: {
            exacta: exacta.length, cumple: cumple.length, cercana: cercana.length,
            recomendada: recomendada.length, descartada: descartada.length,
            totalMostradas: totalCount
          },
          propiedadesMostradas: propertiesSummary,
          busquedaCriterios: {
            habitaciones: params.Habitaciones || null, banos: params.Banos || null,
            precio_min: params.Precio_min || null, precio_max: params.Precio_max || null,
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
              params.tipoOperación?.includes('venta') ? `Incluir opciones de renta` : '',
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

    return res.json({
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
    });

  } catch (err) {
    console.error('CHAT ERROR:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error interno', message: err.message });
  }
});

export default router;
