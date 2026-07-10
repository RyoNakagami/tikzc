import type { Item } from './items.js';

export function collectBreakablePenalties(items: Item[]): Item[] {
  return items.filter(
    (item) => item.kind === 'penalty' && item.penalty < 10_000
  );
}

export function collectSpaceBreakpoints(items: Item[]): number[] {
  return collectBreakablePenalties(items).map((item) => item.payload.runIndex);
}
