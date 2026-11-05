/**
 * The palette shared by the map renderer, the minimap and HUD portraits (values from
 * docs/art-direction.md). Warm bright sand is the paper; the player's side is marked with teal,
 * mutants with sick magenta flesh, acid yellow-green and yellow eyes; orange is the interaction
 * accent and red the danger color; the four resources keep fixed colors everywhere. The HUD's CSS
 * custom properties use the same values for the same meanings.
 */
export const COLORS = {
  void: '#0b0a08',
  /** Uniform dark outline of units, buildings and props. */
  outline: '#1a1510',
  // ground
  sandLight: '#d9bd84',
  sand: '#b99a62',
  sandDark: '#8a6f45',
  wetSand: '#7a6646',
  fertile: '#74532f',
  fertileDark: '#4c331c',
  sprout: '#8cc24a',
  sproutDark: '#5d8a2c',
  wreckGround: '#8d7454',
  rust: '#a4532b',
  rustLight: '#d0703a',
  rustDark: '#6a3219',
  steel: '#6c7476',
  steelLight: '#a3aaab',
  steelDark: '#454b4d',
  oil: '#121016',
  oilSheen: '#6a5a9a',
  oilSheen2: '#3fa7a0',
  water: '#3f7d73',
  waterDeep: '#2a5852',
  waterLight: '#79b3a2',
  foam: '#e8e2c6',
  rock: '#86735d',
  rockLight: '#b29d82',
  rockDark: '#4f4234',
  wall: '#aaa292',
  wallDark: '#6f685c',
  ruinFloor: '#b9a985',
  ruinStone: '#d8caa6',
  ruinGlow: '#ffd98a',
  // player side
  teal: '#3ec1b0',
  tealDark: '#1f7f75',
  tealLight: '#8fe6d8',
  khaki: '#c8b07a',
  khakiDark: '#8e7a4e',
  olive: '#6e7c3c',
  oliveDark: '#47532a',
  canvas: '#d9c9a0',
  skin: '#d6a77a',
  pack: '#6b4f2e',
  wood: '#9a7046',
  woodDark: '#62452a',
  tin: '#9aa0a0',
  tinDark: '#5f6566',
  concrete: '#b3ada0',
  concreteDark: '#7c766a',
  sandbag: '#c9b382',
  hazard: '#e2b13c',
  // mutants
  flesh: '#9c3a5a',
  fleshDark: '#5a1c36',
  fleshLight: '#c86a88',
  acid: '#b8f04a',
  acidDark: '#6f9a22',
  eye: '#ffd84a',
  chitin: '#5a3a4a',
  chitinLight: '#8a6070',
  bone: '#e6dcc4',
  nest: '#6a2140',
  nestLight: '#a8466a',
  nestGlow: '#ff5a8a',
  // interaction
  accent: '#f08a3c',
  danger: '#ea4a36',
  // resources
  scrap: '#d0703a',
  food: '#8cc24a',
  fuel: '#6a5a9a',
  research: '#5fb2e6',
  // feedback
  hpGood: '#7fd36a',
  hpMid: '#f0c040',
  hpBad: '#ea4a36',
  valid: '#7fd36a',
  unavailable: '#f0c040',
  blocked: '#ea4a36',
  blueprint: '#7fd8f0',
  flash: '#fff0b8',
  fire: '#ff8a2a',
} as const;

export function hpColor(fraction: number): string {
  return fraction > 0.6 ? COLORS.hpGood : fraction > 0.3 ? COLORS.hpMid : COLORS.hpBad;
}

/** Outline width in device pixels at a given device px per tile: 1.5 px at the default zoom, never under 1 px. */
export function outlinePx(devicePxPerTile: number): number {
  return Math.max(1, Math.min(2.4, (1.5 * devicePxPerTile) / 44));
}
