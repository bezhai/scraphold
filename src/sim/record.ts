/** A record with every key set to 0 (resource tables, counters, modifier tables). */
export function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const r = {} as Record<K, number>;
  for (const k of keys) r[k] = 0;
  return r;
}
