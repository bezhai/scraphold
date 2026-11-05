import { expect, it } from 'vitest';
import { TECHS, TECH_IDS, POLICIES, POLICY_IDS } from './economy';
it('defines ten inspired technologies and three gated policies', () => {
  expect(TECH_IDS).toHaveLength(25);
  expect(POLICY_IDS).toHaveLength(14);
  for (const t of TECH_IDS) { expect(TECHS[t].inspirationText.length).toBeGreaterThan(0); expect(TECHS[t].cost).toBeGreaterThan(0); }
  for (const p of ['stormReadiness', 'expeditionSupplies', 'fullBroadcast'] as const) expect(POLICIES[p].tech).not.toBeNull();
});
