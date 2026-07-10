import type { PgfRandom } from "./rng.js";

export type PgfMathRuntime = {
  rng: PgfRandom;
};

let currentRuntime: PgfMathRuntime | null = null;

export function withPgfMathRuntime<T>(runtime: PgfMathRuntime | null, fn: () => T): T {
  const previous = currentRuntime;
  currentRuntime = runtime;
  try {
    return fn();
  } finally {
    currentRuntime = previous;
  }
}

export function getCurrentPgfMathRuntime(): PgfMathRuntime | null {
  return currentRuntime;
}
