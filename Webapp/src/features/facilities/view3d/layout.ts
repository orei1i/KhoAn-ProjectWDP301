import type { PublicSiteUnit, UnitCategory } from '@ssm/shared';

/** Bố cục tự động cho mô hình 3D — hàm thuần, không dùng three: cùng dữ liệu luôn ra cùng hình (không phụ thuộc thứ tự trả về, không ngẫu nhiên). */

export interface SiteTypeSize { _id: string; category?: UnitCategory; dimensions?: { widthM?: number; depthM?: number; heightM?: number } }
export interface PlacedUnit {
  unit: PublicSiteUnit;
  floor: number;
  /** Tâm đáy khối (m); cửa nằm ở mặt +Z, quay ra lối đi. */
  x: number; y: number; z: number;
  w: number; h: number; d: number;
}
export interface PlacedSlab { floor: number; level: number; x: number; y: number; z: number; w: number; d: number; storey: number }
/** Biển chữ nằm trên sàn; `size` = chiều cao chữ nổi (m). */
export interface PlacedLabel { floor: number; text: string; x: number; y: number; z: number; size: number }
export interface SiteLayout {
  units: PlacedUnit[];
  slabs: PlacedSlab[];
  labels: PlacedLabel[];
  /** Các tầng có ô, từ thấp đến cao. */
  floors: number[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number };
}

/** Cỡ dự phòng khi loại kho thiếu kích thước (rộng × sâu × cao, m). */
const SIZE_BY_CATEGORY: Record<UnitCategory, [number, number, number]> = {
  LOCKER: [1, 1, 1.2], SMALL: [1.5, 2, 2.4], MEDIUM: [2, 3, 2.4], LARGE: [3, 4, 2.8], XL: [4, 6, 3],
};
const FALLBACK_SIZE: [number, number, number] = [2, 3, 2.4];
const AISLE = 3.2; // lối đi trước mỗi dãy
const UNIT_GAP = 0.14;
const SLAB_MARGIN = 2.2;
const SLAB_THICK = 0.3;
const STOREY_GAP = 3.6; // tầng tách rời như mô hình bóc lớp — sàn trong suốt, đủ hở để nhìn vào các dãy từ góc xiên
const BUILDING_GAP = 9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const byNatural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export const floorLabel = (floor: number) => (floor < 0 ? `Hầm ${-floor}` : `Tầng ${floor}`);

/** Kích thước hiển thị: theo W×D×H của loại kho, có chặn để ô tủ nhỏ vẫn bấm được và ô lớn không lấn cả dãy (mô hình minh hoạ, không đúng tỉ lệ). */
function displaySize(t: SiteTypeSize | undefined): [number, number, number] {
  const [fw, fd, fh] = t?.category ? SIZE_BY_CATEGORY[t.category] : FALLBACK_SIZE;
  const dim = t?.dimensions;
  return [clamp(dim?.widthM || fw, 1.2, 6), clamp(dim?.depthM || fd, 1.2, 6.5), clamp(dim?.heightM || fh, 1.2, 3.2)];
}

interface Sized { unit: PublicSiteUnit; w: number; h: number; d: number }

const rowTitle = (u: PublicSiteUnit) => [u.location.zone, u.location.aisle && `Dãy ${u.location.aisle}`].filter(Boolean).join(' · ');

/** Gom ô một tầng thành các dãy: mỗi khu / dãy một nhóm (sắp xếp tự nhiên theo mã ô), dài quá `maxRow` thì xuống dãy mới. */
function rowsOf(units: Sized[], maxRow: number) {
  const groups = new Map<string, Sized[]>();
  for (const s of units) {
    const key = `${s.unit.location.zone ?? ''}|${s.unit.location.aisle ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }
  const rows: { title: string; items: Sized[]; width: number; depth: number }[] = [];
  for (const key of [...groups.keys()].sort(byNatural)) {
    const items = groups.get(key)!.sort((a, b) => byNatural(a.unit.unitNumber, b.unit.unitNumber));
    let row: (typeof rows)[number] | null = null;
    items.forEach((s, i) => {
      if (!row || row.width + s.w > maxRow) {
        row = { title: i === 0 ? rowTitle(s.unit) : '', items: [], width: 0, depth: 0 };
        rows.push(row);
      }
      row.items.push(s);
      row.width += s.w + UNIT_GAP;
      row.depth = Math.max(row.depth, s.d);
    });
  }
  return rows;
}

export function buildLayout(units: readonly PublicSiteUnit[], types: readonly SiteTypeSize[]): SiteLayout {
  const typeOf = new Map(types.map((t) => [t._id, t]));
  const sized: Sized[] = units.map((unit) => {
    const [w, d, h] = displaySize(typeOf.get(String(unit.unitTypeId)));
    return { unit, w, d, h };
  });
  const floors = [...new Set(units.map((u) => u.location.floor))].sort((a, b) => a - b);
  const levelOf = new Map(floors.map((f, i) => [f, i]));
  const storey = Math.max(2.4, ...sized.map((s) => s.h)) + SLAB_THICK + STOREY_GAP;

  const buildings = new Map<string, Sized[]>();
  for (const s of sized) {
    const key = s.unit.location.building?.trim() ?? '';
    const list = buildings.get(key);
    if (list) list.push(s); else buildings.set(key, [s]);
  }
  const buildingKeys = [...buildings.keys()].sort(byNatural);

  const placed: PlacedUnit[] = [];
  const slabs: PlacedSlab[] = [];
  const labels: PlacedLabel[] = [];
  let cursorX = 0;
  let totalDepth = 0;

  for (const key of buildingKeys) {
    const list = buildings.get(key)!;
    const byFloor = new Map<number, Sized[]>();
    for (const s of list) {
      const f = byFloor.get(s.unit.location.floor);
      if (f) f.push(s); else byFloor.set(s.unit.location.floor, [s]);
    }
    // Chiều dài dãy chọn theo tầng đông nhất để khối nhà gần vuông; mọi tầng dùng chung nên chồng khớp nhau.
    const areaMax = Math.max(...[...byFloor.values()].map((f) => f.reduce((sum, s) => sum + (s.w + UNIT_GAP) * (s.d + AISLE), 0)));
    const widest = Math.max(...list.map((s) => s.w));
    const maxRow = Math.max(widest + UNIT_GAP, clamp(Math.sqrt(areaMax) * 1.25, 14, 70));

    const laid = [...byFloor.keys()].sort((a, b) => a - b).map((floor) => {
      const rows = rowsOf(byFloor.get(floor)!, maxRow);
      return { floor, rows, width: Math.max(...rows.map((r) => r.width)), depth: rows.reduce((sum, r) => sum + r.depth + AISLE, 0) };
    });
    const width = Math.max(...laid.map((l) => l.width)) + SLAB_MARGIN * 2;
    const depth = Math.max(...laid.map((l) => l.depth)) + SLAB_MARGIN;

    for (const { floor, rows } of laid) {
      const level = levelOf.get(floor)!;
      const base = level * storey;
      const y = base + SLAB_THICK;
      slabs.push({ floor, level, x: cursorX + width / 2, y: base, z: -depth / 2, w: width, d: depth, storey });
      const prefix = key && buildingKeys.length > 1 ? `Nhà ${key} · ` : '';
      labels.push({ floor, text: `${prefix}${floorLabel(floor)}`, x: cursorX + width - 4, y: y + 0.03, z: -1.1, size: 2.1 });
      // Dãy đầu nằm sát tường sau (z âm nhất), các dãy tiến dần ra phía trước; cửa luôn quay về +Z, có lối đi ngay trước cửa.
      let z = -depth + SLAB_MARGIN / 2;
      for (const row of rows) {
        const front = z + row.depth;
        let x = cursorX + SLAB_MARGIN;
        for (const s of row.items) {
          placed.push({ unit: s.unit, floor, x: x + s.w / 2, y, z: front - s.d / 2, w: s.w, h: s.h, d: s.d });
          x += s.w + UNIT_GAP;
        }
        if (row.title) labels.push({ floor, text: row.title, x: cursorX + SLAB_MARGIN + 3, y: y + 0.03, z: front + AISLE / 2, size: 1.4 });
        z = front + AISLE;
      }
    }
    cursorX += width + BUILDING_GAP;
    totalDepth = Math.max(totalDepth, depth);
  }

  // Đưa cả cụm nhà về giữa gốc toạ độ.
  const totalWidth = Math.max(0, cursorX - BUILDING_GAP);
  const dx = -totalWidth / 2;
  const dz = totalDepth / 2;
  for (const p of placed) { p.x += dx; p.z += dz; }
  for (const s of slabs) { s.x += dx; s.z += dz; }
  for (const l of labels) { l.x += dx; l.z += dz; }

  return {
    units: placed, slabs, labels, floors,
    bounds: { minX: dx, maxX: dx + totalWidth, minZ: -dz, maxZ: dz, maxY: Math.max(1, floors.length) * storey },
  };
}
