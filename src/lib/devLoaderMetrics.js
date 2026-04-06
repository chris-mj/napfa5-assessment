/**
 * Lightweight development-only metrics for async loaders.
 * In production this returns a no-op finalizer.
 *
 * @param {string} operation
 * @param {Record<string, unknown>} [meta]
 * @returns {(result?: { rows?: number, failed?: boolean, canceled?: boolean, error?: unknown }) => void}
 */
export function startLoaderMetric(operation, meta = {}) {
  if (!import.meta.env.DEV) {
    return () => {};
  }

  const startedAt = performance.now();

  return ({ rows = null, failed = false, canceled = false, error = null } = {}) => {
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const payload = {
      operation,
      duration_ms: durationMs,
      rows,
      failed,
      canceled,
      ...meta,
    };
    if (error) payload.error = error instanceof Error ? error.message : String(error);
    console.debug("[loader-metric]", payload);
  };
}
