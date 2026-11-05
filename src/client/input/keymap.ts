/**
 * Keyboard layout. Keys are matched by physical `code` so they work with any layout and while a
 * Chinese IME is active. Camera pan keys (WASD / arrows) are held keys, read separately.
 */
import type { BuildingType } from '../../sim/data/economy';

export type KeyAction =
  | { type: 'togglePause' }
  | { type: 'cancel' }
  | { type: 'hold' }
  | { type: 'stop' }
  | { type: 'retreat' }
  | { type: 'jumpToAlert' }
  | { type: 'toggleTech' }
  | { type: 'togglePolicies' }
  | { type: 'toggleHelp' }
  | { type: 'toggleObjectives' }
  | { type: 'reopenIncident' }
  | { type: 'chooseIncidentChoice'; index: number }
  | { type: 'closeIntroCard' }
  | { type: 'selectIdleSurvivors' }
  | { type: 'speed'; delta: 1 | -1 }
  | { type: 'recallGroup'; index: number }
  | { type: 'assignGroup'; index: number }
  | { type: 'addToGroup'; index: number }
  | { type: 'build'; building: BuildingType };

export interface KeyInput {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export const BUILD_HOTKEYS: Readonly<Record<string, BuildingType>> = {
  KeyQ: 'shack',
  KeyE: 'salvageYard',
  KeyR: 'greenhouse',
  KeyY: 'oilWell',
  KeyU: 'researchStation',
  KeyI: 'dispatchHub',
  KeyB: 'barracks',
  KeyN: 'armory',
  KeyM: 'workshop',
  KeyZ: 'barricade',
  KeyC: 'machineGunTower',
  KeyV: 'watchtower',
};

/** Letter shown on buttons for a building's hotkey. */
export function buildHotkeyLabel(building: BuildingType): string | null {
  const code = Object.keys(BUILD_HOTKEYS).find((c) => BUILD_HOTKEYS[c] === building);
  return code ? code.slice(3) : null;
}

const PLAIN_KEYS: Readonly<Record<string, KeyAction>> = {
  Space: { type: 'togglePause' },
  Escape: { type: 'cancel' },
  KeyH: { type: 'hold' },
  KeyX: { type: 'stop' },
  KeyK: { type: 'retreat' },
  KeyF: { type: 'jumpToAlert' },
  KeyT: { type: 'toggleTech' },
  KeyP: { type: 'togglePolicies' },
  KeyG: { type: 'selectIdleSurvivors' },
  KeyO: { type: 'toggleObjectives' },
  Tab: { type: 'reopenIncident' },
  F1: { type: 'toggleHelp' },
  // "?" is Shift+/ on most layouts; "/" alone opens the help too.
  Slash: { type: 'toggleHelp' },
  Equal: { type: 'speed', delta: 1 },
  NumpadAdd: { type: 'speed', delta: 1 },
  Minus: { type: 'speed', delta: -1 },
  NumpadSubtract: { type: 'speed', delta: -1 },
};

export const GROUP_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

/** A card that is modal while it is open: the keyboard and the camera answer only to it. */
export type ModalCard = 'intro' | 'incident';

/** Keys that pick an incident card's choices while the card is open. */
const INCIDENT_CHOICE_KEYS = ['Digit1', 'Digit2', 'Digit3'];

/** Keys that close the day-1 intro card ("进入据点"). */
const INTRO_CLOSE_KEYS = ['Escape', 'Space', 'Enter'];

export interface KeymapContext {
  /** The modal card that is open, if any: only its own keys do anything. */
  modal?: ModalCard | null;
}

function incidentCardAction(k: KeyInput): KeyAction | null {
  if (k.code === 'Escape') return { type: 'cancel' };
  if (k.code === 'Tab') return { type: 'reopenIncident' };
  const index = INCIDENT_CHOICE_KEYS.indexOf(k.code);
  if (index < 0 || k.ctrlKey || k.metaKey || k.altKey || k.shiftKey) return null;
  return { type: 'chooseIncidentChoice', index };
}

function introCardAction(k: KeyInput): KeyAction | null {
  return INTRO_CLOSE_KEYS.includes(k.code) ? { type: 'closeIntroCard' } : null;
}

/** The keys of each modal card: the intro card only closes (Esc, Space, Enter); the incident card picks 1–3, Esc views the map, Tab. */
const MODAL_CARD_KEYS: Readonly<Record<ModalCard, (k: KeyInput) => KeyAction | null>> = {
  intro: introCardAction,
  incident: incidentCardAction,
};

export function actionForKey(k: KeyInput, ctx: KeymapContext = {}): KeyAction | null {
  if (ctx.modal) return MODAL_CARD_KEYS[ctx.modal](k);
  const group = GROUP_KEYS.indexOf(k.code);
  if (group >= 0) {
    // Ctrl+digit may be taken by the browser (tab switching); Alt+digit is an alternative.
    if (k.ctrlKey || k.metaKey || k.altKey) return { type: 'assignGroup', index: group };
    if (k.shiftKey) return { type: 'addToGroup', index: group };
    return { type: 'recallGroup', index: group };
  }
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  const plain = PLAIN_KEYS[k.code];
  if (plain) return plain;
  const building = BUILD_HOTKEYS[k.code];
  return building ? { type: 'build', building } : null;
}

const PAN_KEYS: Readonly<Record<string, { dx: number; dy: number }>> = {
  KeyW: { dx: 0, dy: -1 },
  ArrowUp: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  ArrowDown: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  ArrowLeft: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

export function isPanKey(code: string): boolean {
  return code in PAN_KEYS;
}

export function panDirectionFromKeys(held: ReadonlySet<string>): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  const seen = new Set<string>();
  for (const code of held) {
    const d = PAN_KEYS[code];
    if (!d) continue;
    const axis = `${d.dx},${d.dy}`;
    if (seen.has(axis)) continue;
    seen.add(axis);
    dx += d.dx;
    dy += d.dy;
  }
  return { dx: Math.sign(dx), dy: Math.sign(dy) };
}
