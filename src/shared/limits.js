// ============================================================================
// CONCURRENCIA — pool pLimit (sin sharp; chatbot no procesa imágenes)
// ============================================================================
export function pLimit(concurrency) {
  const queue = [];
  let active = 0;
  const next = () => {
    if (active >= concurrency || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(
      v => { active--; resolve(v); next(); },
      e => { active--; reject(e);  next(); }
    );
  };
  const limit = fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
  limit.concurrency = concurrency;
  return limit;
}
