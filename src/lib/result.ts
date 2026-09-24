/**
 * The return type of every Server Action. Errors are human-readable strings
 * that can be shown to a receptionist as-is — never a stack trace or a
 * Postgres error code.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
