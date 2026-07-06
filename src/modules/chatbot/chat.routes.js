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
  searchBubble, filterByProximity, filterPropertiesByLocationText,
  validateCriteriaMatch, getPropNum
} from './bubble.js';
import { classifyAndScoreProperties, formatProperties } from './scoring.js';
import {
  RADIUS_SCALE, buildSystemPrompt, CHAT_TOOLS,
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

    const userSpecifiedRadius = params.km !== undefined && params.km !== null;
    let properties = [], usedRadius = null, isExactMatch = true, refCoords = null;
    let geocodedDisplay = null, bubbleLocacion = params.Locacion || null;
    let locationMatchType = params.Locacion ? 'none' : 'not_requested';
    let locacionParsed = { colonia: [], ciudad: [], estado: [] };

    if (params.Locacion) {
      const [geoResult, parsedResult] = await Promise.all([
        geocodeLocation(params.Locacion),
        parseLocacionSmart(params.Locacion)
      ]);
      refCoords = geoResult;
      geocodedDisplay = refCoords?.displayName || params.Locacion;
      locacionParsed = parsedResult;
    }

    const hasColonia = locacionParsed.colonia.length > 0;
    const hasCiudad  = locacionParsed.ciudad.length > 0;
    const hasEstado  = locacionParsed.estado.length > 0;
    const onlyEstado = hasEstado && !hasCiudad && !hasColonia;

    let radiusScale;
    let skipProximityFilter = false;

    if (userSpecifiedRadius) {
      radiusScale = [params.km];
    } else if (onlyEstado) {
      radiusScale = [200];
      skipProximityFilter = true;
    } else if (hasCiudad && !hasColonia) {
      radiusScale = [5, 10, 20, 40, 80];
    } else if (hasColonia) {
      radiusScale = [2, 5, 10, 20, 40];
    } else {
      radiusScale = RADIUS_SCALE;
    }

    usedRadius = radiusScale[0];

    const runBubbleSearchAttempt = async (radiusKm) => {
      const searchParams = { ...params, LocacionBubble: bubbleLocacion };
      if (radiusKm != null) searchParams.km = radiusKm;
      let results = await searchBubble(searchParams);
      let exactMatchUsed = true;
      if (searchParams.exactMatch === 'yes' && results.length === 0) {
        results = await searchBubble({ ...searchParams, exactMatch: 'no' });
        exactMatchUsed = false;
      }
      results = results.filter(prop => validateCriteriaMatch(prop, params, false));
      const allExactMatch = results.length > 0 && results.every(prop => validateCriteriaMatch(prop, params, true));
      const locationFiltered = filterPropertiesByLocationText(results, params.Locacion);
      results = locationFiltered.properties;
      if (radiusKm != null && refCoords && !skipProximityFilter) {
        results = filterByProximity(results, refCoords, radiusKm);
      }
      return { results, exactMatchUsed: exactMatchUsed && allExactMatch, locationMatchType: locationFiltered.matchType };
    };

    if (skipProximityFilter) {
      const estadoRadius = radiusScale[0];
      const attempt = await runBubbleSearchAttempt(estadoRadius);
      properties = attempt.results;
      if (!attempt.exactMatchUsed) isExactMatch = false;
      locationMatchType = attempt.locationMatchType;
      usedRadius = estadoRadius;
    } else if (refCoords) {
      let bestAttempt = null, bestClassified = null, bestRadius = radiusScale[0];
      for (const radius of radiusScale) {
        usedRadius = radius;
        const attempt = await runBubbleSearchAttempt(radius);
        const tempClassified = classifyAndScoreProperties(attempt.results, params, refCoords);
        const visibleCount = tempClassified.allClassified.length;
        if (!bestClassified || visibleCount > bestClassified.allClassified.length) {
          bestAttempt = attempt; bestClassified = tempClassified; bestRadius = radius;
          properties = attempt.results;
          if (!attempt.exactMatchUsed) isExactMatch = false;
          locationMatchType = attempt.locationMatchType;
        }
        if (visibleCount >= MIN_VISIBLE_TARGET) break;
      }
      usedRadius = bestRadius;
      if (bestAttempt) {
        properties = bestAttempt.results;
        if (!bestAttempt.exactMatchUsed) isExactMatch = false;
        locationMatchType = bestAttempt.locationMatchType;
      }
    } else {
      const attempt = await runBubbleSearchAttempt(userSpecifiedRadius ? usedRadius : null);
      if (!attempt.exactMatchUsed) isExactMatch = false;
      locationMatchType = attempt.locationMatchType;
      properties = attempt.results;
    }

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

    const isCriteriaExactMatch = isExactMatch;
    const isLocationExactMatch = locationMatchType === 'exact';
    const overallExactMatch = isCriteriaExactMatch && (!params.Locacion || isLocationExactMatch);
    const legacyExactMatch = params.Locacion ? isLocationExactMatch : isCriteriaExactMatch;

    const histWithTool = [
      ...conversationHistory, assistantMsg,
      {
        role: 'tool', tool_call_id: toolCall.id,
        content: JSON.stringify({
          success: true, count: totalCount,
          displayedCount: displayProperties.length,
          isExactMatch: legacyExactMatch, isCriteriaExactMatch,
          isOverallExactMatch: overallExactMatch, isLocationExactMatch,
          locationMatchType, ubicacionBuscada: params.Locacion || null,
          ubicacionGeocoded: geocodedDisplay, radiusKm: usedRadius,
          radiusAutoScaled: !userSpecifiedRadius && totalCount > 0,
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
            tipo: params.tipoInmueble || []
          },
          sugerenciasAlternativas: totalCount === 0 ? {
            contexto: 'NO HAY RESULTADOS - SE PROACTIVO',
            posiblesCausas: [
              params.Habitaciones ? `Pocos resultados de ${params.Habitaciones} recamaras en esta zona` : '',
              params.Precio_max ? `Criterios restrictivos` : '',
              params.Locacion ? `Zona con pocos datos` : 'Sin ubicacion'
            ].filter(Boolean),
            alternativas: [
              params.Habitaciones ? `Flexibilizar recamaras` : '',
              params.Precio_max ? `Expandir presupuesto` : '',
              params.tipoOperación?.includes('venta') ? `Incluir opciones de renta` : '',
              params.Locacion ? `Buscar en municipios cercanos` : '',
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
        query: params.Locacion || null, geocoded: geocodedDisplay,
        lat: refCoords?.lat || null, lng: refCoords?.lng || null,
        radiusKm: usedRadius, radiusAutoScaled: !userSpecifiedRadius && totalCount > 0,
        colonia: locacionParsed.colonia, ciudad: locacionParsed.ciudad, estado: locacionParsed.estado
      },
      updatedHistory
    });

  } catch (err) {
    console.error('CHAT ERROR:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error interno', message: err.message });
  }
});

export default router;
