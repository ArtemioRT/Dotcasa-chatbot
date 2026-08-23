// ============================================================================
// SCORING ENGINE v2.0 — puntuación, clasificación y formateo de propiedades
// ============================================================================
import { parseBubbleNumber, normalizePublicUrl } from '../../shared/utils.js';
import { parsePropertyCoords } from './geocoding.js';

export function scoreProperty(prop, params, refCoords) {
  let score = 0;
  const details = {};
  const propTipo = prop['Tipo_de_inmueble'] || prop['tipo_de_inmueble'] || '';
  const propOperacion = prop['Tipo'] || prop['tipo'] || '';
  const propHabitaciones = parseBubbleNumber(prop['N_Habitaciones'] || prop['Habitaciones'] || prop['habitaciones']);
  const propBanos = parseBubbleNumber(prop['N_Banos'] || prop['Banos'] || prop['banos']);
  const propPrecio = parseBubbleNumber(prop['Precio'] || prop['precio']);
  const propPisos = parseBubbleNumber(prop['Pisos'] || prop['N_pisos'] || prop['pisos']);
  const proximity = parseBubbleNumber(prop['Proximidad'] || prop['proximidad']);

  const userTipoInmueble = params.tipoInmueble || [];
  const userTipoOperacion = params.tipoOperación || [];
  const userHabitaciones = params.Habitaciones;
  const userBanos = params.Banos;
  const userPisos = params.Pisos;
  const userPresupuesto = params.Precio_max;
  const userRadioKm = params.km || 10;

  let operacionMatch = false;
  if (userTipoOperacion.length === 0 || userTipoOperacion.includes(propOperacion)) {
    score += 20; details.operacionScore = 20; operacionMatch = true;
  } else { score -= 15; details.operacionScore = -15; }

  let tipoInmuebleMatch = false;
  if (userTipoInmueble.length === 0 || userTipoInmueble.includes(propTipo)) {
    score += 20; details.tipoInmuebleScore = 20; tipoInmuebleMatch = true;
  } else { score -= 10; details.tipoInmuebleScore = -10; }

  let habitacionesMatch = false;
  if (userHabitaciones != null && propHabitaciones != null) {
    if (propHabitaciones >= userHabitaciones) {
      score += 15; details.habitacionesScore = 15; habitacionesMatch = true;
      const exceso = propHabitaciones - userHabitaciones;
      if (exceso > 2) { score -= 5; details.habitacionesPenalizacion = -5; }
    } else { score -= 10; details.habitacionesScore = -10; }
  } else { details.habitacionesScore = 0; habitacionesMatch = true; }

  let banosMatch = false;
  if (userBanos != null && propBanos != null) {
    if (propBanos >= userBanos) { score += 10; details.banosScore = 10; banosMatch = true; }
    else { score -= 5; details.banosScore = -5; }
  } else { details.banosScore = 0; banosMatch = true; }

  if (userPisos != null && propPisos != null) {
    const diff = Math.abs(propPisos - userPisos);
    if (diff === 0) { score += 10; details.pisosScore = 10; }
    else { const pisoScore = Math.max(0, 10 - diff * 2); score += pisoScore; details.pisosScore = pisoScore; }
  } else { details.pisosScore = 0; }

  let precioMatch = false;
  if (userPresupuesto != null && propPrecio != null) {
    if (propPrecio <= userPresupuesto) {
      const diffPrecio = userPresupuesto - propPrecio;
      const maxDiff = userPresupuesto * 0.5;
      const priceScore = Math.min(20, (diffPrecio / maxDiff) * 20);
      score += priceScore; details.precioScore = Math.round(priceScore); precioMatch = true;
    } else {
      const overbudget = propPrecio / userPresupuesto;
      const penalizacion = Math.min(15, (overbudget - 1) * 20);
      score -= penalizacion; details.precioScore = -Math.round(penalizacion);
      details.precioPenalizacionGradual = true;
    }
  } else { details.precioScore = 0; precioMatch = true; }

  if (proximity != null) {
    const proximityWeight = userRadioKm <= 5 ? 25 : 20;
    const distanceScore = proximityWeight * Math.exp(-proximity / userRadioKm);
    score += distanceScore;
    details.proximidadScore = Math.round(distanceScore * 10) / 10;
    details.proximidadWeight = proximityWeight;
    if (proximity > userRadioKm * 2) { score -= 10; details.proximidadPenalizacion = -10; }
  } else { details.proximidadScore = 0; }

  const cumpleTodo = operacionMatch && tipoInmuebleMatch && habitacionesMatch && banosMatch && precioMatch;
  if (cumpleTodo) {
    score += 10; details.bonusCompleto = 10;
    if (proximity != null && proximity <= userRadioKm) { score += 5; details.bonusCercania = 5; }
  } else { details.bonusCompleto = 0; }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    score: finalScore, details,
    matches: { operacion: operacionMatch, tipoInmueble: tipoInmuebleMatch,
               habitaciones: habitacionesMatch, banos: banosMatch, precio: precioMatch, cumpleTodo }
  };
}

export function classifyAndScoreProperties(properties, params, refCoords) {
  if (!properties.length) {
    return { exacta: [], cumple: [], cercana: [], recomendada: [], descartada: [], top3: [], allClassified: [] };
  }
  const classified = properties.map(prop => {
    const { score, details, matches } = scoreProperty(prop, params, refCoords);
    const propTipo = prop['Tipo_de_inmueble'] || prop['tipo_de_inmueble'] || '';
    const propOperacion = prop['Tipo'] || prop['tipo'] || '';
    const propHabitaciones = parseBubbleNumber(prop['N_Habitaciones'] || prop['Habitaciones'] || prop['habitaciones']);
    const propBanos = parseBubbleNumber(prop['N_Banos'] || prop['Banos'] || prop['banos']);
    const propPrecio = parseBubbleNumber(prop['Precio'] || prop['precio']);
    const propPisos = parseBubbleNumber(prop['Pisos'] || prop['N_pisos'] || prop['pisos']);
    const proximity = parseBubbleNumber(prop['Proximidad'] || prop['proximidad']);

    const userTipoInmueble = params.tipoInmueble || [];
    const userTipoOperacion = params.tipoOperación || [];
    const userHabitaciones = params.Habitaciones;
    const userBanos = params.Banos;
    const userPisos = params.Pisos;
    const userPresupuesto = params.Precio_max;

    let classification = 'descartada';
    const operacionExacta = userTipoOperacion.length === 0 || userTipoOperacion.includes(propOperacion);
    const tipoExacto = userTipoInmueble.length === 0 || userTipoInmueble.includes(propTipo);
    const habitacionesExactas = userHabitaciones == null || propHabitaciones === userHabitaciones;
    const banosSuficientes = userBanos == null || propBanos >= userBanos;
    const pisosSuficientes = userPisos == null || propPisos >= userPisos;
    const precioAdecuado = userPresupuesto == null || propPrecio <= userPresupuesto;

    if (operacionExacta && tipoExacto && habitacionesExactas && banosSuficientes && pisosSuficientes && precioAdecuado) classification = 'exacta';
    else if (matches.cumpleTodo) classification = 'cumple';
    else if (proximity != null && proximity <= 5 && score >= 60 && operacionExacta && tipoExacto) classification = 'cercana';
    else if (score >= 55 && (matches.habitaciones || matches.precio)) classification = 'recomendada';

    if (!operacionExacta || !tipoExacto) classification = 'descartada';

    return { ...prop, __score__: score, __scoreDetails__: details, __classification__: classification, __matches__: matches };
  });

  classified.sort((a, b) => b.__score__ - a.__score__);
  const filtered = classified.filter(p => p.__classification__ !== 'descartada');
  const exacta      = filtered.filter(p => p.__classification__ === 'exacta');
  const cumple      = filtered.filter(p => p.__classification__ === 'cumple');
  const cercana     = filtered.filter(p => p.__classification__ === 'cercana');
  const recomendada = filtered.filter(p => p.__classification__ === 'recomendada');
  const descartada  = classified.filter(p => p.__classification__ === 'descartada');
  const top3        = filtered.slice(0, 3);

  return { exacta, cumple, cercana, recomendada, descartada, top3, allClassified: filtered };
}

export function extractPhotoUrl(prop) {
  const directPhoto = normalizePublicUrl(prop['Foto_principal'] || prop['foto_principal'] || prop['Foto principal'] || prop['foto principal']);
  if (directPhoto) return directPhoto;
  const fotoLugar = prop['Fotografia_lugar'] || prop['fotografia_lugar'] || '';
  if (!fotoLugar) return '';
  try {
    const parsed = typeof fotoLugar === 'string' ? JSON.parse(fotoLugar) : fotoLugar;
    if (Array.isArray(parsed) && parsed.length > 0) return normalizePublicUrl(parsed[0]);
  } catch {
    const urls = String(fotoLugar).split(',').map(u => normalizePublicUrl(u)).filter(Boolean);
    if (urls.length > 0) return urls[0];
  }
  return '';
}

export function formatProperties(properties) {
  return properties.map(prop => {
    const fotoPrincipal = extractPhotoUrl(prop);
    const coords = parsePropertyCoords(prop);
    return {
      Tipo_de_inmueble: prop['Tipo_de_inmueble'] || prop['tipo_de_inmueble'] || '',
      M2_Terreno: prop['M2_Terreno'] || prop['M^2_Terreno'] || prop['m2_terreno'] || '',
      M2_Construccion: prop['M2_Construccion'] || prop['M^2_Construccion'] || prop['m2_construccion'] || '',
      N_Habitaciones: prop['N_Habitaciones'] || prop['n_habitaciones'] || '',
      N_Banos: prop['N_Banos'] || prop['n_banos'] || '',
      Tipo: prop['Tipo'] || prop['tipo'] || '',
      Ciudad: prop['Ciudad'] || prop['ciudad'] || '',
      Estado: prop['Estado'] || prop['estado'] || '',
      Colonia: prop['Colonia'] || prop['colonia'] || '',
      Precio: prop['Precio'] || prop['precio'] || '',
      Link: prop['Link'] || prop['link'] || '',
      Locación: prop['Locación'] || prop['Locacion'] || prop['locacion'] || '',
      Antiguedad: prop['Antiguedad'] || prop['antiguedad'] || '',
      Foto_principal: fotoPrincipal,
      Pisos: prop['Pisos'] || prop['N_pisos'] || prop['pisos'] || '',
      Proximidad: parseBubbleNumber(prop['Proximidad'] ?? prop['proximidad']) ?? null,
      Latitud: coords?.lat ?? null,
      Longitud: coords?.lng ?? null,
      Score: prop['__score__'] ?? null
    };
  });
}
