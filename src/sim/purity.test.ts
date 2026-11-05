/**
 * Guards the simulation's determinism rules by scanning its sources (tests excluded):
 * no host globals or clocks, no Math.random, no math functions whose precision differs between
 * engines, and imports only from inside src/sim. tsconfig.sim.json additionally compiles src/sim
 * without DOM and Node types.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIM_DIR = dirname(fileURLToPath(import.meta.url));

function simSources(dir = SIM_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...simSources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out.sort();
}

/** Removes comments; with blankStrings also replaces string contents by spaces. */
function stripComments(src: string, blankStrings: boolean): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += src[i++];
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += blankStrings ? ' ' : src[i];
          i++;
        }
        out += blankStrings ? ' ' : src[i];
        i++;
      }
      out += src[i++] ?? '';
    } else {
      out += src[i++];
    }
  }
  return out;
}

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /\bMath\.random\b/, why: 'randomness must come from rng.ts streams' },
  { pattern: /\b(Date|performance)\b/, why: 'no wall clock in the simulation' },
  { pattern: /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\b/, why: 'no asynchronous scheduling' },
  { pattern: /\b(window|document|navigator|localStorage|sessionStorage|globalThis|process|crypto|fetch|XMLHttpRequest|WebSocket)\b/, why: 'no host environment access' },
  {
    pattern: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot)\b/,
    why: 'precision differs between JS engines; use + - * / and Math.sqrt',
  },
  { pattern: /\*\*/, why: 'the ** operator has Math.pow precision; multiply instead' },
  { pattern: /\bimport\s*\(/, why: 'no dynamic imports' },
];

function violations(file: string, source: string): string[] {
  const code = stripComments(source, false);
  const bare = stripComments(source, true);
  const found: string[] = [];
  for (const { pattern, why } of FORBIDDEN) {
    const m = bare.match(pattern);
    if (m) found.push(`${file}: '${m[0]}' (${why})`);
  }
  for (const m of code.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1] as string;
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      found.push(`${file}: imports '${spec}' (the simulation may only import its own modules)`);
      continue;
    }
    const target = resolve(dirname(join(SIM_DIR, file)), spec);
    if (relative(SIM_DIR, target).startsWith('..')) found.push(`${file}: imports '${spec}' from outside src/sim`);
  }
  return found;
}

describe('simulation purity', () => {
  it('scans a meaningful number of source files', () => {
    expect(simSources().length).toBeGreaterThan(30);
  });

  it('uses no forbidden globals, imprecise math or outside imports', () => {
    const problems = simSources().flatMap((path) => violations(relative(SIM_DIR, path), readFileSync(path, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('detects violations (scanner self-check)', () => {
    const bad = [
      "import { h } from 'preact';",
      "import { draw } from '../client/render';",
      'const r = Math.random();',
      'const t = Date.now();',
      'const a = Math.atan2(1, 2);',
      'const b = x ** 2;',
      'document.body;',
    ].join('\n');
    expect(violations('fake.ts', bad)).toHaveLength(7);
    expect(violations('fake.ts', "/** Math.random is banned */\nconst s = 'Date';\nimport { x } from './rng';")).toEqual([]);
  });
});
