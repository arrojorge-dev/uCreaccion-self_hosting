export function exponentialBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
    return Math.min(baseMs * 2 ** (attempt - 1), maxMs);
}
