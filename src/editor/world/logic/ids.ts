/** Small helpers for making ids (pure logic). */

/** "room-001", "room-002", ... the first number not used yet. */
export function nextRoomId(existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `room-${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
}

let counter = 0;
/** Short unique id for decor / entities, e.g. "d-k3f9a2x1". */
export function uid(prefix: string, taken?: Set<string>): string {
  for (;;) {
    counter = (counter + 1) % 1296;
    const id = `${prefix}-${Math.random().toString(36).slice(2, 8)}${counter.toString(36)}`;
    if (!taken || !taken.has(id)) return id;
  }
}

/** "Hall" -> "Hall copy", "Hall copy" -> "Hall copy 2", ... */
export function copyName(name: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  const base = name.replace(/ copy( \d+)?$/, '');
  let candidate = `${base} copy`;
  for (let n = 2; used.has(candidate); n++) candidate = `${base} copy ${n}`;
  return candidate;
}
