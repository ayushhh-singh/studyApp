/**
 * Squarified treemap (Bruls, Huizing & van Wijk 2000). Lays items out as rects
 * whose areas are proportional to `value`, favouring near-square tiles so the
 * Conquest Map stays legible — including at 390px. Coordinates are returned in
 * the same units as the input box, so pass a box matching your container's
 * aspect ratio (e.g. 4×3) and convert to percentages when rendering.
 */
export interface TreemapRect<T> {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function squarify<T extends { value: number }>(
  items: T[],
  boxW: number,
  boxH: number,
): TreemapRect<T>[] {
  const result: TreemapRect<T>[] = [];
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return result;

  const scale = (boxW * boxH) / total;
  const scaled = positive.map((item) => ({ item, area: item.value * scale }));

  let rect = { x: 0, y: 0, w: boxW, h: boxH };
  let row: { item: T; area: number }[] = [];

  function worst(candidate: { area: number }[], side: number): number {
    const s = candidate.reduce((a, r) => a + r.area, 0);
    if (s <= 0) return Infinity;
    const max = Math.max(...candidate.map((r) => r.area));
    const min = Math.min(...candidate.map((r) => r.area));
    const side2 = side * side;
    const s2 = s * s;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  }

  function layoutRow() {
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    if (rowArea <= 0) return;
    const horizontal = rect.w >= rect.h; // stack the row along the shorter side
    if (horizontal) {
      const colW = rowArea / rect.h;
      let oy = rect.y;
      for (const r of row) {
        const h = r.area / colW;
        result.push({ item: r.item, x: rect.x, y: oy, w: colW, h });
        oy += h;
      }
      rect = { x: rect.x + colW, y: rect.y, w: rect.w - colW, h: rect.h };
    } else {
      const rowH = rowArea / rect.w;
      let ox = rect.x;
      for (const r of row) {
        const w = r.area / rowH;
        result.push({ item: r.item, x: ox, y: rect.y, w, h: rowH });
        ox += w;
      }
      rect = { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH };
    }
    row = [];
  }

  for (const sc of scaled) {
    const side = Math.min(rect.w, rect.h);
    const candidate = [...row, sc];
    if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
    } else {
      layoutRow();
      row = [sc];
    }
  }
  layoutRow();
  return result;
}
