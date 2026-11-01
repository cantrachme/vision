/** Deterministic, layered shell; neighbor search runs once, never per frame. */
export function makeOrbGeometry(count: number) {
  let seed = 71;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const buckets = new Map<string, number[]>();
  const cell = 0.16;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1, a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    // Thin nested membranes, with no solid core.
    const layer = random() < 0.22 ? 0.78 : 1;
    const radius = layer + (random() - 0.5) * 0.045;
    const x = Math.cos(a) * r * radius, z = Math.sin(a) * r * radius;
    positions.set([x, y * radius, z], i * 3);
    sizes[i] = 0.55 + Math.pow(random(), 5) * 2.1;
    const k = key(Math.floor(x / cell), Math.floor(y * radius / cell), Math.floor(z / cell));
    const bucket = buckets.get(k) || []; bucket.push(i); buckets.set(k, bucket);
  }
  const lines: number[] = [];
  // A sparse local graph makes fine webs, not a latitude/longitude wireframe.
  for (let i = 0; i < count; i += 2) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const bx = Math.floor(x / cell), by = Math.floor(y / cell), bz = Math.floor(z / cell);
    const candidates: { id: number; d: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of buckets.get(key(bx + dx, by + dy, bz + dz)) || []) {
        if (j <= i) continue;
        const d = (positions[j * 3] - x) ** 2 + (positions[j * 3 + 1] - y) ** 2 + (positions[j * 3 + 2] - z) ** 2;
        if (d < 0.022 && d > 0.0004) candidates.push({ id: j, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const { id } of candidates.slice(0, 3)) {
      lines.push(x, y, z, positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]);
    }
  }
  return { positions, sizes, lines: new Float32Array(lines) };
}
