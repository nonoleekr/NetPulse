export function reconnectDelay(attempt: number, maximumMs: number, random = Math.random) {
  const base = Math.min(maximumMs, 500 * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.75 + random() * 0.5));
}
