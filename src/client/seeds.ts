/**
 * Seed choices on the start screen: random code, daily (local date, same for everyone that day),
 * or a custom string.
 */

export type SeedMode = 'random' | 'daily' | 'custom';
export interface SeedChoice {
  mode: SeedMode;
  custom: string;
}

export const MAX_SEED_LENGTH = 32;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function dailySeed(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Six characters from an unambiguous alphabet. Not used by the simulation's own RNG. */
export function randomSeed(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length))];
  return s;
}

export function normalizeSeedInput(input: string): string | null {
  const s = input.trim().slice(0, MAX_SEED_LENGTH);
  return s.length > 0 ? s : null;
}

/** The seed to start with, or null when a custom seed is required but empty. */
export function seedForChoice(choice: SeedChoice, now: Date, random: () => number = Math.random): string | null {
  if (choice.mode === 'daily') return dailySeed(now);
  if (choice.mode === 'custom') return normalizeSeedInput(choice.custom);
  return randomSeed(random);
}
