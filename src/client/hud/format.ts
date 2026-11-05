/** Number and text formatting shared by HUD panels. */
import { RESOURCE_NAMES, RESOURCES, type ResourceAmounts } from '../../sim/data/economy';

const MINUS = '−';

/** Signed integer rate: "+12", "−3", "0". */
export function formatSigned(n: number): string {
  const r = Math.round(n);
  if (r > 0) return `+${r}`;
  if (r < 0) return `${MINUS}${-r}`;
  return '0';
}

/** m:ss */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "燃料 30、科研 30" for the non-zero amounts in resource order. */
export function formatAmounts(amounts: ResourceAmounts): string {
  return RESOURCES.filter((r) => (amounts[r] ?? 0) > 0)
    .map((r) => `${RESOURCE_NAMES[r]} ${Math.round(amounts[r] as number)}`)
    .join('、');
}
