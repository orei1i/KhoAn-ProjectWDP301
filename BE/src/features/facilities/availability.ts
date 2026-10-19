import type { Types } from 'mongoose';
import { StorageUnitModel } from '../../shared/db/models';

type Id = Types.ObjectId | string;

/**
 * Mỗi ô kho là một vật lý duy nhất và khách BẮT BUỘC chọn đúng ô đó trên sơ đồ lúc đặt (không đặt
 * theo "loại kho" trừu tượng rồi chờ phân sau) — ô chuyển sang RESERVED ngay lúc đặt. Vì vậy "còn
 * trống" chỉ đơn giản là đếm theo `status` hiện tại, không cần tính chồng lấn theo khoảng ngày nữa
 * (khác thiết kế cũ, vốn giữ chỗ bằng số lượng rồi phân ô sau).
 */
export async function availability(facilityId: Id, unitTypeId: Id) {
  const rows = await StorageUnitModel.aggregate<{ _id: string; n: number }>([
    { $match: { facilityId, unitTypeId, isDeleted: false } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const free = by.AVAILABLE ?? 0;
  return { total, free, available: free };
}
