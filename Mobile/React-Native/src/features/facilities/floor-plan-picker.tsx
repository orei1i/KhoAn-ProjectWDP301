import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AccessMethod, UnitStatus } from '@ssm/shared';
import { UNIT_STATUS } from '@ssm/shared';
import { C, R, S } from '../../shared/ui/theme';

export interface FloorPlanUnit {
  _id: string; unitNumber: string; location: { floor: number; zone?: string }; status: UnitStatus;
  /** Vắng mặt (luồng đổi ô chưa cần) = không tham gia lọc khoá, không bị làm mờ. Điều hòa KHÔNG ở
   * đây — mọi ô của loại kho hợp lệ đều sẵn có máy lạnh, dùng hay không là add-on chọn lúc đặt. */
  accessMethod?: AccessMethod;
}

const CELL: Record<UnitStatus, { bg: string; border: string; text: string }> = {
  AVAILABLE: { bg: C.greenBg, border: '#a7f3d0', text: C.green },
  RESERVED: { bg: C.blueBg, border: '#bae6fd', text: C.blue },
  OCCUPIED: { bg: C.fill, border: C.line, text: C.muted },
  MAINTENANCE: { bg: C.amberBg, border: '#fde68a', text: C.amber },
  PENDING_INSPECTION: { bg: C.violetBg, border: '#ddd6fe', text: C.violet },
};

/**
 * Sơ đồ 2D cơ bản: gom theo tầng, mỗi ô kho là một nút bấm — chỉ ô còn trống mới chọn được.
 * Cùng thiết kế với Webapp/src/features/facilities/floor-plan-picker.tsx.
 *
 * Hình thức khoá là thuộc tính của TỪNG Ô (không phải loại kho) — `lockMethod` lọc ngay trên chính
 * sơ đồ này: ô không khớp bị LÀM MỜ VÀ TẮT (không bấm được) nhưng vẫn hiện nguyên vị trí.
 *
 * Chọn NHIỀU ô (đặt nhiều kho một lượt): truyền `selected` — mỗi lần bấm một ô gọi `onChange`, nơi dùng tự bật/tắt
 * ô đó trong danh sách; ô đã chọn hiện dấu ✓ ngay trên sơ đồ. Không truyền `selected` = chọn một ô như cũ (`value`).
 */
export function FloorPlanPicker({ items, value, onChange, lockMethod = null, selected }: {
  items: FloorPlanUnit[]; value: string | null; onChange: (unitId: string) => void;
  lockMethod?: AccessMethod | null; selected?: readonly string[];
}) {
  const floors = [...new Set(items.map((u) => u.location.floor))].sort((a, b) => b - a);
  const [floor, setFloor] = useState<number | null>(null);
  const activeFloor = floor !== null && floors.includes(floor) ? floor : (floors[0] ?? null);

  if (items.length === 0) return <Text style={st.empty}>Chưa có ô kho nào thuộc loại này.</Text>;

  const matches = (u: FloorPlanUnit) => lockMethod === null || u.accessMethod === undefined || u.accessMethod === lockMethod;

  return (
    <View style={{ gap: S.md }}>
      {floors.length > 1 && (
        <View style={st.floorRow}>
          {floors.map((fl) => {
            const active = fl === activeFloor;
            return (
              <Pressable key={fl} onPress={() => setFloor(fl)} style={[st.floorChip, active ? st.floorChipActive : st.floorChipInactive]}>
                <Text style={[st.floorChipText, active && st.floorChipTextActive]}>{fl < 0 ? 'Tầng hầm' : `Tầng ${fl}`}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {floors.filter((fl) => fl === activeFloor).map((fl) => (
        <View key={fl} style={st.grid}>
          {items.filter((u) => u.location.floor === fl).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)).map((u) => {
            const dimmed = !matches(u);
            const pickable = u.status === 'AVAILABLE' && !dimmed;
            const picked = selected ? selected.includes(u._id) : u._id === value;
            const c = CELL[u.status];
            return (
              <Pressable key={u._id} disabled={!pickable} onPress={() => onChange(u._id)}
                style={[st.cell, { backgroundColor: c.bg, borderColor: picked ? C.brand600 : c.border, borderWidth: picked ? 2 : 1 }, picked && { backgroundColor: C.brand50 }, dimmed && st.cellDimmed]}>
                <Text style={[st.cellNumber, { color: c.text }]}>{u.unitNumber}</Text>
                <Text style={[st.cellStatus, { color: c.text }]}>{dimmed ? 'Khác lựa chọn' : picked && selected ? '✓ Đã chọn' : pickable ? 'Còn trống' : UNIT_STATUS[u.status].label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  empty: { fontSize: 13, color: C.muted },
  floorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs },
  floorChip: { paddingVertical: 6, paddingHorizontal: S.sm + 2, borderRadius: R.full, borderWidth: 1 },
  floorChipActive: { backgroundColor: C.ink, borderColor: C.ink },
  floorChipInactive: { backgroundColor: C.card, borderColor: C.line },
  floorChipText: { fontSize: 12, fontWeight: '600', color: C.text },
  floorChipTextActive: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  cell: { width: 84, borderRadius: R.md, paddingVertical: S.sm, paddingHorizontal: S.sm },
  cellDimmed: { opacity: 0.35 },
  cellNumber: { fontSize: 13, fontWeight: '700' },
  cellStatus: { fontSize: 10, marginTop: 2 },
});
