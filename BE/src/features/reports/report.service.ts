import { Types } from 'mongoose';
import { PaymentModel, RentalContractModel, StorageUnitModel } from '../../shared/db/models';
import { AGING_BUCKETS, COLLECTED_PAYMENT_STATUSES, localMidnightMs, PERIODS_PER_MONTH } from '@ssm/shared';
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

/** Net collected cash (charges − refunds, excluding internal settlements) per month and facility. */
export async function revenueByMonth(facilityIds: (string | Types.ObjectId)[], months = 6) {
  const from = addMonthsUTC(new Date(Date.UTC(todayUTC().getUTCFullYear(), todayUTC().getUTCMonth(), 1)), -(months - 1));
  return PaymentModel.aggregate([
    // Mốc đầu là 00:00 GIỜ VN ngày 1 (không phải 00:00Z = 07:00 sáng giờ VN) — khoản trả lúc 00:00–07:00 sáng ngày 1 vẫn thuộc tháng đó,
    // như cách nhóm tháng theo giờ VN bên dưới và ở Webapp (monthKey). Khoản gốc đã hoàn vẫn là doanh thu gộp — xem COLLECTED_PAYMENT_STATUSES.
    { $match: { facilityId: { $in: oid(facilityIds) }, status: { $in: [...COLLECTED_PAYMENT_STATUSES] }, paidAt: { $gte: new Date(localMidnightMs(from)) }, method: { $ne: 'INTERNAL' } } },
    { $group: {
      _id: { month: { $dateToString: { format: '%Y-%m', date: '$paidAt', timezone: 'Asia/Ho_Chi_Minh' } }, facilityId: '$facilityId' },
      total: { $sum: { $cond: [{ $eq: ['$direction', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } },
    } },
    { $group: { _id: '$_id.month', total: { $sum: '$total' }, byFacility: { $push: { k: { $toString: '$_id.facilityId' }, v: '$total' } } } },
    { $project: { _id: 0, month: '$_id', total: 1, byFacility: { $arrayToObject: '$byFacility' } } },
    { $sort: { month: 1 } },
  ]);
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
