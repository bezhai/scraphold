/** localStorage when the browser allows it, otherwise a no-op store (private mode, sandboxed iframes). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const NONE: KeyValueStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export function browserStorage(): KeyValueStorage {
  try {
    return window.localStorage ?? NONE;
  } catch {
    return NONE;
  }
}
