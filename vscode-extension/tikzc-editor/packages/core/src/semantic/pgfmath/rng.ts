const PGF_RND_M = 2147483647;
const PGF_RND_A = 69621;
const PGF_RND_Q = 30845;
const PGF_RND_R = 23902;

export type PgfRandom = {
  getSeed(): number;
  setSeed(value: number): void;
  nextRaw(): number;
  rnd(): number;
  rand(): number;
  randomInteger(from: number, to: number): number;
};

export function createPgfRandom(initialSeed = 1): PgfRandom {
  let seed = normalizeSeed(initialSeed);

  return {
    getSeed() {
      return seed;
    },
    setSeed(value: number) {
      seed = normalizeSeed(value);
    },
    nextRaw() {
      seed = nextSeed(seed);
      return seed;
    },
    rnd() {
      const value = this.nextRaw();
      const remainder = value % 100001;
      return remainder / 100000;
    },
    rand() {
      const value = this.nextRaw();
      const remainder = value % 200001;
      const centered = remainder - 100000;
      return centered / 100000;
    },
    randomInteger(from: number, to: number) {
      let lower = Math.trunc(from);
      let upper = Math.trunc(to);
      if (lower > upper) {
        const tmp = lower;
        lower = upper;
        upper = tmp;
      }
      const span = Math.max(1, upper - lower + 1);
      const value = this.nextRaw() % span;
      return lower + value;
    }
  };
}

function normalizeSeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const truncated = Math.trunc(value);
  if (truncated <= 0) {
    return 1;
  }
  const normalized = truncated % PGF_RND_M;
  return normalized === 0 ? 1 : normalized;
}

function nextSeed(current: number): number {
  const hi = Math.trunc(current / PGF_RND_Q);
  const lo = current - hi * PGF_RND_Q;
  let next = PGF_RND_A * lo - PGF_RND_R * hi;
  if (next <= 0) {
    next += PGF_RND_M;
  }
  return next;
}
