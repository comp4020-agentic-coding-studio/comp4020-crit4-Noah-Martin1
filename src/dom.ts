/**
 * Assert a lookup found something, and hand back a non-nullable type.
 *
 * A bare `if (!x) throw` narrows the straight-line code but not the closures
 * below it, so every callback ends up re-checking a value that cannot be null.
 * Doing the check once, here, keeps the call sites clean.
 */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}
