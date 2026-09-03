export interface SortKey { id: string; label: string; path: string; direction?: 'asc' | 'desc'; }

const at = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

/** Rank strings and numbers sensibly, pushing empty values to the end. */
function cmp(a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * Sort by several keys at once. The order the player picked the keys is the
 * order they are applied, so "Type then Cost" reads exactly as chosen.
 */
export function sortByKeys<T>(items: T[], keys: SortKey[], resolve: (item: T) => unknown): T[] {
  if (!keys.length) return items;
  return items.slice().sort((x, y) => {
    for (const k of keys) {
      const r = cmp(at(resolve(x), k.path), at(resolve(y), k.path));
      if (r !== 0) return k.direction === 'desc' ? -r : r;
    }
    return 0;
  });
}

/** Toggle a key in the active list, preserving pick order. */
export function toggleKey(active: SortKey[], key: SortKey): SortKey[] {
  return active.some(k => k.id === key.id)
    ? active.filter(k => k.id !== key.id)
    : [...active, key];
}
