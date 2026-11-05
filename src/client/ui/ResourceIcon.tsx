/**
 * Inline vector glyphs for the four resources (drawn in code, no image assets), in the resource
 * colors of docs/art-direction.md (the --res-* custom properties and the map's yield hints use
 * the same values) with the shared dark outline. Flat fills only: a gradient id inside a hidden
 * tooltip would break every other icon that references it.
 */
import type { Resource } from '../../sim/data/economy';

const OUTLINE = '#1a1510';

export function ResourceIcon({ resource }: { resource: Resource }) {
  switch (resource) {
    case 'scrap':
      return (
        <svg class="res-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.2l2.1 2.5 3.3-.5.9 3.2 3 1.4-1.1 3.2 1.1 3.2-3 1.4-.9 3.2-3.3-.5L12 21.8l-2.1-2.5-3.3.5-.9-3.2-3-1.4 1.1-3.2-1.1-3.2 3-1.4.9-3.2 3.3.5z"
            fill="#d0703a"
            stroke={OUTLINE}
            stroke-width="1.3"
            stroke-linejoin="round"
          />
          <path d="M7.6 9.6a5 5 0 0 1 4.4-2.6" fill="none" stroke="#f2a774" stroke-width="1.4" stroke-linecap="round" />
          <circle cx="12" cy="12" r="3.1" fill={OUTLINE} />
        </svg>
      );
    case 'food':
      return (
        <svg class="res-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 21.5c1.5-3 4.2-4.3 7-4.3s5.5 1.3 7 4.3z" fill="#8a6f45" stroke={OUTLINE} stroke-width="1.2" stroke-linejoin="round" />
          <path d="M12 19V10.5" stroke={OUTLINE} stroke-width="2.6" stroke-linecap="round" />
          <path d="M12 19V10.5" stroke="#5d8f2c" stroke-width="1.2" stroke-linecap="round" />
          <path d="M12 13.2C7.2 13.6 3.8 10.8 3.6 5.6c4.9-.5 8.2 2.4 8.4 7.6z" fill="#8cc24a" stroke={OUTLINE} stroke-width="1.2" stroke-linejoin="round" />
          <path d="M12 11c-.1-5.2 3.2-8.3 8.4-8.2.1 5.2-3.2 8.3-8.4 8.2z" fill="#8cc24a" stroke={OUTLINE} stroke-width="1.2" stroke-linejoin="round" />
          <path d="M6.2 7.6l4.6 4.2M17.8 5.2l-4.6 4.6" stroke="#bfe58a" stroke-width="1" stroke-linecap="round" />
        </svg>
      );
    case 'fuel':
      return (
        <svg class="res-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.4S5 10.3 5 15a7 7 0 0 0 14 0c0-4.7-7-12.6-7-12.6z" fill="#6a5a9a" stroke={OUTLINE} stroke-width="1.3" stroke-linejoin="round" />
          <path d="M8.4 14.6a3.8 3.8 0 0 0 2.9 3.9" fill="none" stroke="#cbbcff" stroke-width="1.5" stroke-linecap="round" />
          <path d="M9.3 11.6l1.4-1.9" fill="none" stroke="#8fe6d8" stroke-width="1.3" stroke-linecap="round" />
        </svg>
      );
    case 'research':
      return (
        <svg class="res-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 2.8h6M10 3v6.2L4.8 18.1A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-2.9L14 9.2V3" fill="#d6ecf6" stroke={OUTLINE} stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" />
          <path d="M7.6 14.4h8.8l2 3.6a1.2 1.2 0 0 1-1 1.8H6.6a1.2 1.2 0 0 1-1-1.8z" fill="#5fb2e6" />
          <circle cx="10.6" cy="17" r="1" fill="#d6ecf6" />
          <circle cx="13.6" cy="15.9" r="0.7" fill="#d6ecf6" />
        </svg>
      );
  }
}
