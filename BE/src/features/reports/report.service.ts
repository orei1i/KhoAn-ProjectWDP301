import { Types } from 'mongoose';
import { InspectionModel, PaymentModel, RentalContractModel, ReservationModel, StorageUnitModel, UserModel } from '../../shared/db/models';
import { AGING_BUCKETS, COLLECTED_PAYMENT_STATUSES, localMidnightMs, OUTBOUND_PAYMENT_TYPES, PERIODS_PER_MONTH, revenueRows, type RevenueMonthRow } from '@ssm/shared';
import { addMonthsUTC, todayUTC } from '../../shared/utils/dates';

const oid = (ids: (string | Types.ObjectId)[]) => ids.map((i) => new Types.ObjectId(String(i)));

/** Units by status + area occupancy, per facility. Uses the {facilityId, status} index. */
export async function occupancy(facilityIds: (string | Types.ObjectId)[]) {
  return StorageUnitModel.aggregate([
    { $match: { facilityId: { $in: oid(facilityIds) } } },
    { $lookup: { from: 'unitTypes', localField: 'unitTypeId', foreignField: '_id', as: 't', pipeline: [{ $project: { areaM2: 1 } }] } },
    { $set: { area: { $ifNull: [{ $first: '$t.areaM2' }, 0] }, occ: { $in: ['$status', ['OCCUPIED', 'PENDING_INSPECTION']] } } },
    { $group: {
      _id: '$facilityId',
      total: { $sum: 1 },
      occupied: { $sum: { $cond: ['$occ', 1, 0] } },
      maintenance: { $sum: { $cond: [{ $eq: ['$status', 'MAINTENANCE'] }, 1, 0] } },
      available: { $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] } },
      reserved: { $sum: { $cond: [{ $eq: ['$status', 'RESERVED'] }, 1, 0] } },
      area: { $sum: '$area' },
      occupiedArea: { $sum: { $cond: ['$occ', '$area', 0] } },
    } },
    { $set: {
      facilityId: '$_id',
      occupancy: { $cond: [{ $gt: [{ $subtract: ['$total', '$maintenance'] }, 0] }, { $divide: ['$occupied', { $subtract: ['$total', '$maintenance'] }] }, 0] },
      areaOccupancy: { $cond: [{ $gt: ['$area', 0] }, { $divide: ['$occupiedArea', '$area'] }, 0] },
    } },
    { $unset: '_id' },
  ]);
}

/**
 * Doanh thu theo tháng và chi nhánh — đợt 15 (C4): MỘT công thức với trang báo cáo ở Webapp (revenueRows ở @ssm/shared): thực thu − hoàn
 * của các khoản không phải tiền giữ chân, + tiền giữ chân bị giữ lại khi đặt chỗ huỷ (huỷ sát ngày / không đến), + phần tiền giữ chân
 * cấn trừ khi quyết toán (hư hại, thu hồi ưu đãi, phí, nợ cấn vào tiền giữ chân — các khoản nợ đó CANCELLED nhưng không mất khỏi doanh
 * thu), + tiền thanh lý dùng trừ nợ. Phần thanh lý còn dư trả khách không trừ vào doanh thu; khoản hoàn sau khiếu nại biên bản thì trừ.
 * Tiền giữ chân thu / hoàn / chuyển thành doanh thu báo riêng ở `deposits`.
 */
export async function revenueByMonth(facilityIds: (string | Types.ObjectId)[], months = 6): Promise<RevenueMonthRow[]> {
  const first = addMonthsUTC(new Date(Date.UTC(todayUTC().getUTCFullYear(), todayUTC().getUTCMonth(), 1)), -(months - 1));
  const keys = Array.from({ length: months }, (_, i) => addMonthsUTC(first, i).toISOString().slice(0, 7));
  // Mốc đầu là 00:00 GIỜ VN ngày 1 (không phải 00:00Z = 07:00 sáng giờ VN) — khoản trả lúc 00:00–07:00 sáng ngày 1 vẫn thuộc tháng đó.
  const from = new Date(localMidnightMs(first));
  const ids = oid(facilityIds);
  const PAY = { facilityId: 1, type: 1, direction: 1, amount: 1, status: 1, method: 1, paidAt: 1, refundOf: 1, reservationId: 1, refundedAmount: 1 } as const;
  const [pays, reservations, settled] = await Promise.all([
    PaymentModel.find({ facilityId: { $in: ids }, status: { $in: [...COLLECTED_PAYMENT_STATUSES] }, paidAt: { $gte: from }, method: { $ne: 'INTERNAL' } }, PAY).lean(),
    ReservationModel.find({ facilityId: { $in: ids }, status: 'CANCELLED', 'cancellation.cancelledAt': { $gte: from } }, { facilityId: 1, status: 1, cancellation: 1 }).lean(),
    InspectionModel.find({ facilityId: { $in: ids }, type: { $in: ['MOVE_OUT', 'ABANDONMENT'] }, performedAt: { $gte: from } }, { facilityId: 1, type: 1, performedAt: 1, depositSettlement: 1, adjustments: 1 }).lean(),
  ]);
  // Khoản gốc của các dòng hoàn (để tách hoàn tiền giữ chân), tiền giữ chân của các đặt chỗ đã huỷ, và biên bản có điều chỉnh tạo ra dòng hoàn.
  const refundIds = pays.filter((p) => p.direction === 'REFUND').map((p) => p._id);
  const [origins, heldDeposits, adjusted] = await Promise.all([
    PaymentModel.find({ _id: { $in: pays.map((p) => p.refundOf).filter(Boolean) } }, PAY).lean(),
    PaymentModel.find({ reservationId: { $in: reservations.map((r) => r._id) }, type: 'DEPOSIT' }, PAY).lean(),
    refundIds.length ? InspectionModel.find({ 'adjustments.refundPaymentId': { $in: refundIds } }, { facilityId: 1, type: 1, performedAt: 1, adjustments: 1 }).lean() : [],
  ]);
  const inspections = [...settled, ...adjusted.filter((a) => !settled.some((x) => String(x._id) === String(a._id)))];
  return revenueRows({ months: keys, facilityIds: ids, payments: [...pays, ...heldDeposits, ...origins], reservations, inspections });
}

const CLOSED = { $in: ['$status', ['CLOSED', 'ABANDONED']] };
/** Còn nợ VÀ đã quá ân hạn trong khoảng [min, max] ngày — đúng định nghĩa bảng tuổi nợ (AGING_BUCKETS / pastDueDays ở @ssm/shared). */
const pastDue = (min: number, max: number | null) => ({ $and: [
  { $gt: ['$balance.outstanding', 0] },
  { $gte: ['$delinquency.daysOverdue', min] },
  ...(max === null ? [] : [{ $lte: ['$delinquency.daysOverdue', max] }]),
] });
/** Giá theo kỳ quy đổi ra tháng (PERIODS_PER_MONTH ở @ssm/shared) — hợp đồng thuê ngày / tuần không bị cộng như thuê tháng. */
const monthlyRate = { $multiply: ['$billing.rate', { $switch: {
  branches: Object.entries(PERIODS_PER_MONTH).map(([period, k]) => ({ case: { $eq: ['$billing.rentalPeriod', period] }, then: k })),
  default: 1,
} }] };

/**
 * Open-contract MRR, công nợ và tuổi nợ. `overdue` / `overdueContracts` = nợ QUÁ HẠN (cùng định nghĩa bảng tuổi nợ: tổng các nhóm
 * d1_7…d30p); `outstanding` = TỔNG công nợ, gồm cả hoá đơn kỳ mới chưa đến hạn.
 */
export async function receivables(facilityIds: (string | Types.ObjectId)[]) {
  const [row] = await RentalContractModel.aggregate([
    // Hợp đồng đang mở + hợp đồng đã đóng còn nợ sau quyết toán (nợ vẫn là khoản phải thu, nhưng không tính vào số hợp đồng / MRR).
    { $match: { facilityId: { $in: oid(facilityIds) }, $or: [{ status: { $nin: ['CLOSED', 'ABANDONED'] } }, { status: { $in: ['CLOSED', 'ABANDONED'] }, 'balance.outstanding': { $gt: 0 } }] } },
    { $group: {
      _id: null,
      activeContracts: { $sum: { $cond: [CLOSED, 0, 1] } },
      mrr: { $sum: { $cond: [CLOSED, 0, monthlyRate] } },
      outstanding: { $sum: { $cond: [{ $gt: ['$balance.outstanding', 0] }, '$balance.outstanding', 0] } },
      overdue: { $sum: { $cond: [pastDue(1, null), '$balance.outstanding', 0] } },
      overdueContracts: { $sum: { $cond: [pastDue(1, null), 1, 0] } },
      delinquent: { $sum: { $cond: [{ $in: ['$status', ['DELINQUENT', 'LOCKED_OUT']] }, 1, 0] } },
      ...Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { $sum: { $cond: [pastDue(b.min, b.max), '$balance.outstanding', 0] } }])),
    } },
    { $unset: '_id' },
  ]);
  // Cộng giá quy đổi chưa làm tròn rồi mới làm tròn tổng — như facilityStats ở Webapp.
  if (row) return { ...row, mrr: Math.round(row.mrr) };
  return { activeContracts: 0, mrr: 0, outstanding: 0, overdue: 0, overdueContracts: 0, delinquent: 0, d1_7: 0, d8_15: 0, d16_30: 0, d30p: 0 };
}

/**
 * CHỐT CA TIỀN MẶT (C3): mọi khoản TIỀN MẶT của chi nhánh trong một ngày giờ VN, nhóm theo nhân viên thu / chi (recordedBy).
 * Thu = các khoản thu đã nhận (kể cả đã hoàn về sau — tiền mặt đã vào két lúc thu); chi = hoàn / bồi thường / trả tiền thanh lý bằng
 * tiền mặt đã chi. `net` = thu − chi = tiền mặt phải nộp.
 */
export async function cashReport(facilityId: string, date: string) {
  const from = new Date(localMidnightMs(new Date(`${date}T00:00:00.000Z`)));
  const to = new Date(from.getTime() + 86_400_000);
  const rows = await PaymentModel.aggregate<{ _id: { staff: Types.ObjectId | null; out: boolean }; count: number; total: number }>([
    { $match: { facilityId: new Types.ObjectId(facilityId), method: 'CASH', paidAt: { $gte: from, $lt: to } } },
    { $set: { out: { $in: ['$type', [...OUTBOUND_PAYMENT_TYPES]] } } },
    { $match: { $or: [{ out: false, status: { $in: [...COLLECTED_PAYMENT_STATUSES] } }, { out: true, status: 'SUCCEEDED' }] } },
    { $group: { _id: { staff: '$recordedBy', out: '$out' }, count: { $sum: 1 }, total: { $sum: '$amount' } } },
  ]);
  const ids = [...new Set(rows.map((r) => String(r._id.staff ?? '')))].filter(Boolean);
  const names = new Map((await UserModel.find({ _id: { $in: ids } }, { fullName: 1 }).lean()).map((u) => [String(u._id), u.fullName]));
  const byStaff = new Map<string, { staffId: string | null; fullName: string; collected: { count: number; total: number }; paidOut: { count: number; total: number } }>();
  for (const r of rows) {
    const key = String(r._id.staff ?? '');
    if (!byStaff.has(key)) byStaff.set(key, { staffId: key || null, fullName: names.get(key) ?? '(không rõ người thu)', collected: { count: 0, total: 0 }, paidOut: { count: 0, total: 0 } });
    const s = byStaff.get(key)!;
    const slot = r._id.out ? s.paidOut : s.collected;
    slot.count += r.count; slot.total += r.total;
  }
  const list = [...byStaff.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  const collected = list.reduce((s, x) => s + x.collected.total, 0);
  const paidOut = list.reduce((s, x) => s + x.paidOut.total, 0);
  return { date, facilityId, byStaff: list, totals: { collected, paidOut, net: collected - paidOut } };
}
