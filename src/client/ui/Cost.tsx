import type { CostItem } from '../hud/availability';
import { ResourceIcon } from './ResourceIcon';

export function Cost({ items }: { items: readonly CostItem[] }) {
  if (items.length === 0) return <span class="cost">免费</span>;
  return (
    <span class="cost num">
      {items.map((c) => (
        <span key={c.resource} class={`c res-${c.resource} ${c.affordable ? '' : 'short'}`} title={c.name}>
          <ResourceIcon resource={c.resource} />
          {c.amount}
        </span>
      ))}
    </span>
  );
}
