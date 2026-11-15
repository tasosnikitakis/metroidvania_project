/**
 * Run-length encoding for tile layers (pure logic).
 * Rooms are mostly long runs of the same tile, so [count, id, count, id, ...]
 * is far smaller than the raw array. Used only for the crash-recovery draft
 * kept in the browser's localStorage, which has a small size limit.
 */
export function rleEncode(values: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    let n = 1;
    while (i + n < values.length && values[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  return out;
}

export function rleDecode(pairs: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const n = pairs[i];
    const v = pairs[i + 1];
    for (let k = 0; k < n; k++) out.push(v);
  }
  return out;
}
