import type { SiteLayout } from './layout';

/** Cảnh xung quanh dùng chung (không phải mặt bằng thật): sân, bãi xe, cổng, văn phòng, hàng rào, cây — chỉ phụ thuộc kích thước cụm nhà nên luôn ổn định. */

export interface BoxSpec { p: [number, number, number]; s: [number, number, number]; c: string }
export interface TreeSpec { x: number; z: number; h: number; c: string }
export interface SignSpec { p: [number, number, number]; w: number }

export const COLOR = {
  ground: '#e8ebea', lot: '#f4f6f5', yard: '#d9dfdd', line: '#ffffff', wall: '#f3f6f5', wallShade: '#e1e7e5',
  slab: '#ffffff', deck: '#eef2f1', beam: '#a9b6b3', column: '#c3cdca', fence: '#a9b6b3', post: '#8d9896', brand: '#14a085', brandDark: '#0d6b5b', glass: '#2f6d64',
  amber: '#f4ac3e', trunk: '#8a6a45', leafA: '#4fae8f', leafB: '#3a9478', hedge: '#6dbb9f', tyre: '#2b3634',
};

const FRONT_YARD = 24; // chiều sâu sân trước cụm nhà
const SIDE = 9;
const BACK = 6;
const GATE_HALF = 5.5;

export interface SiteProps {
  /** Khối phẳng trên mặt đất — không đổ bóng. */
  flats: BoxSpec[];
  solids: BoxSpec[];
  trees: TreeSpec[];
  signs: SignSpec[];
  lot: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function siteProps({ bounds }: SiteLayout): SiteProps {
  const lot = { minX: bounds.minX - SIDE, maxX: bounds.maxX + SIDE, minZ: bounds.minZ - BACK, maxZ: bounds.maxZ + FRONT_YARD };
  const lotW = lot.maxX - lot.minX;
  const lotD = lot.maxZ - lot.minZ;
  const flats: BoxSpec[] = [];
  const solids: BoxSpec[] = [];
  const trees: TreeSpec[] = [];
  const signs: SignSpec[] = [];
  const midX = (lot.minX + lot.maxX) / 2;
  const midZ = (lot.minZ + lot.maxZ) / 2;

  // Nền khuôn viên và sân bê tông trước nhà.
  flats.push({ p: [midX, 0.01, midZ], s: [lotW, 0.02, lotD], c: COLOR.lot });
  const yardZ0 = bounds.maxZ + 1.5;
  const yardZ1 = lot.maxZ - 0.5;
  flats.push({ p: [midX, 0.03, (yardZ0 + yardZ1) / 2], s: [lotW - 3, 0.02, yardZ1 - yardZ0], c: COLOR.yard });
  // Vạch dẫn từ cổng vào nhà.
  for (let z = yardZ0 + 1.5; z < yardZ1 - 1; z += 3.4) flats.push({ p: [0, 0.05, z], s: [0.35, 0.02, 1.7], c: COLOR.line });

  // Bãi xe bên trái cổng: vạch ô đỗ + vài xe minh hoạ.
  const stallW = 2.9;
  const stallD = 5.4;
  const stallZ = yardZ0 + 3.2;
  const stallX0 = -GATE_HALF - 2;
  const stalls = Math.max(3, Math.min(8, Math.floor((stallX0 - lot.minX - 2) / stallW)));
  for (let i = 0; i <= stalls; i++) flats.push({ p: [stallX0 - i * stallW, 0.05, stallZ], s: [0.16, 0.02, stallD], c: COLOR.line });
  const cars: [number, string][] = [[0, '#fbfcfc'], [2, COLOR.brand], [Math.min(3, stalls - 1), '#8d9896']];
  for (const [i, c] of cars) {
    const x = stallX0 - (i + 0.5) * stallW;
    solids.push({ p: [x, 0.62, stallZ], s: [1.75, 0.7, 4.1], c });
    solids.push({ p: [x, 1.17, stallZ - 0.15], s: [1.55, 0.5, 2.1], c: COLOR.glass });
    for (const [wx, wz] of [[-0.85, -1.3], [0.85, -1.3], [-0.85, 1.3], [0.85, 1.3]]) solids.push({ p: [x + wx, 0.3, stallZ + wz], s: [0.24, 0.6, 0.7], c: COLOR.tyre });
  }

  // Văn phòng / quầy bên phải cổng.
  const officeX = Math.min(GATE_HALF + 9, lot.maxX - 7);
  const officeZ = lot.maxZ - 8;
  solids.push({ p: [officeX, 1.85, officeZ], s: [10, 3.7, 6.4], c: COLOR.wall });
  solids.push({ p: [officeX, 3.84, officeZ], s: [10.5, 0.28, 6.9], c: COLOR.brandDark });
  solids.push({ p: [officeX, 1.4, officeZ + 3.22], s: [8.2, 2.3, 0.06], c: COLOR.glass });
  solids.push({ p: [officeX, 2.72, officeZ + 3.9], s: [8.8, 0.14, 1.5], c: COLOR.brand });
  signs.push({ p: [officeX, 4.75, officeZ + 2.6], w: 6.2 });
  solids.push({ p: [officeX, 4.5, officeZ + 2.5], s: [6.4, 1.9, 0.12], c: COLOR.brandDark });

  // Hàng rào: trụ + hai thanh ngang, chừa khoảng cổng ở giữa mặt trước.
  const posts: BoxSpec[] = [];
  const postsAlong = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 4.5));
    for (let i = 0; i <= n; i++) posts.push({ p: [x0 + ((x1 - x0) * i) / n, 0.95, z0 + ((z1 - z0) * i) / n], s: [0.16, 1.9, 0.16], c: COLOR.post });
    for (const y of [0.8, 1.7]) solids.push({ p: [(x0 + x1) / 2, y, (z0 + z1) / 2], s: [x0 === x1 ? 0.07 : len, 0.07, z0 === z1 ? 0.07 : len], c: COLOR.fence });
  };
  postsAlong(lot.minX, lot.minZ, lot.maxX, lot.minZ);
  postsAlong(lot.minX, lot.minZ, lot.minX, lot.maxZ);
  postsAlong(lot.maxX, lot.minZ, lot.maxX, lot.maxZ);
  postsAlong(lot.minX, lot.maxZ, -GATE_HALF, lot.maxZ);
  postsAlong(GATE_HALF, lot.maxZ, lot.maxX, lot.maxZ);
  solids.push(...posts);

  // Cổng: hai trụ, xà ngang có biển KhoAn, thanh chắn.
  for (const x of [-GATE_HALF, GATE_HALF]) solids.push({ p: [x, 2.5, lot.maxZ], s: [0.9, 5, 0.9], c: COLOR.wallShade });
  solids.push({ p: [0, 5.1, lot.maxZ], s: [GATE_HALF * 2 + 1.4, 1.3, 0.7], c: COLOR.brandDark });
  signs.push({ p: [0, 5.1, lot.maxZ + 0.37], w: 4.8 });
  solids.push({ p: [-GATE_HALF + 3, 1.1, lot.maxZ - 0.3], s: [5.4, 0.12, 0.12], c: COLOR.amber });

  // Cây và bồn cây dọc hàng rào, khoảng cách đều nên hình luôn như nhau.
  const leaf = (i: number) => (i % 2 ? COLOR.leafA : COLOR.leafB);
  const treeAt = (x: number, z: number, i: number) => {
    trees.push({ x, z, h: 3.6 + (i % 3) * 0.7, c: leaf(i) });
    solids.push({ p: [x, 0.65, z], s: [0.32, 1.3, 0.32], c: COLOR.trunk });
  };
  let n = 0;
  for (let z = lot.minZ + 3; z < lot.maxZ - 3; z += 7.5) { treeAt(lot.minX + 2.6, z, n++); treeAt(lot.maxX - 2.6, z, n++); }
  for (let x = lot.minX + 9; x < lot.maxX - 7; x += 8) treeAt(x, lot.minZ + 2.2, n++);
  solids.push({ p: [(lot.minX - GATE_HALF) / 2, 0.42, lot.maxZ - 0.9], s: [-GATE_HALF - lot.minX - 1.6, 0.84, 1], c: COLOR.hedge });
  solids.push({ p: [(lot.maxX + GATE_HALF) / 2, 0.42, lot.maxZ - 0.9], s: [lot.maxX - GATE_HALF - 1.6, 0.84, 1], c: COLOR.hedge });

  return { flats, solids, trees, signs, lot };
}
