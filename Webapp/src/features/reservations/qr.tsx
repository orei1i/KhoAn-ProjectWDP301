/** Deterministic QR-looking matrix for the mock UI (not a scannable QR). The real app encodes a signed one-time token. */
export function FakeQr({ value, size = 168 }: { value: string; size?: number }) {
  const N = 25;
  let h = 2166136261;
  for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const bit = (x: number, y: number) => {
    let v = h ^ Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) & 1) === 1;
  };
  const finder = (x: number, y: number) => {
    for (const [fx, fy] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
      const dx = x - fx, dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        return ring === 3 || ring <= 1 ? 1 : 0;
      }
      if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) return 0;
    }
    return -1;
  };
  const cells: [number, number][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const f = finder(x, y);
    if (f === 1 || (f === -1 && bit(x, y))) cells.push([x, y]);
  }
  return (
    <svg viewBox={`-2 -2 ${N + 4} ${N + 4}`} width={size} height={size} role="img" aria-label={`Mã QR nhận kho ${value}`} className="rounded-lg bg-white">
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#16201e" />)}
    </svg>
  );
}
