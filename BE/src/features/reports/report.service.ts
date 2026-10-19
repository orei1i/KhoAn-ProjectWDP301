import { Types } from 'mongoose';
import { PaymentModel, RentalContractModel, StorageUnitModel } from '../../shared/db/models';
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
    { $match: { facilityId: { $in: oid(facilityIds) }, status: { $in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: { $gte: from }, method: { $ne: 'INTERNAL' } } },
    { $group: {
      _id: { month: { $dateToString: { format: '%Y-%m', date: '$paidAt', timezone: 'Asia/Ho_Chi_Minh' } }, facilityId: '$facilityId' },
      total: { $sum: { $cond: [{ $eq: ['$direction', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } },
    } },
    { $group: { _id: '$_id.month', total: { $sum: '$total' }, byFacility: { $push: { k: { $toString: '$_id.facilityId' }, v: '$total' } } } },
    { $project: { _id: 0, month: '$_id', total: 1, byFacility: { $arrayToObject: '$byFacility' } } },
    { $sort: { month: 1 } },
  ]);
}

/** Open-contract MRR, overdue balance and aging buckets. */
export async function receivables(facilityIds: (string | Types.ObjectId)[]) {
  const [row] = await RentalContractModel.aggregate([
    // Hợp đồng đang mở + hợp đồng đã đóng còn nợ sau quyết toán (nợ vẫn là khoản phải thu, nhưng không tính vào số hợp đồng / MRR).
    { $match: { facilityId: { $in: oid(facilityIds) }, $or: [{ status: { $nin: ['CLOSED', 'ABANDONED'] } }, { status: { $in: ['CLOSED', 'ABANDONED'] }, 'balance.outstanding': { $gt: 0 } }] } },
    { $group: {
      _id: null,
      activeContracts: { $sum: { $cond: [{ $in: ['$status', ['CLOSED', 'ABANDONED']] }, 0, 1] } },
      mrr: { $sum: { $cond: [{ $in: ['$status', ['CLOSED', 'ABANDONED']] }, 0, '$billing.rate'] } },
      overdue: { $sum: '$balance.outstanding' },
      delinquent: { $sum: { $cond: [{ $in: ['$status', ['DELINQUENT', 'LOCKED_OUT']] }, 1, 0] } },
      d1_7: { $sum: { $cond: [{ $and: [{ $gte: ['$delinquency.daysOverdue', 1] }, { $lte: ['$delinquency.daysOverdue', 7] }] }, '$balance.outstanding', 0] } },
      d8_15: { $sum: { $cond: [{ $and: [{ $gte: ['$delinquency.daysOverdue', 8] }, { $lte: ['$delinquency.daysOverdue', 15] }] }, '$balance.outstanding', 0] } },
      d16_30: { $sum: { $cond: [{ $and: [{ $gte: ['$delinquency.daysOverdue', 16] }, { $lte: ['$delinquency.daysOverdue', 30] }] }, '$balance.outstanding', 0] } },
      d30p: { $sum: { $cond: [{ $gt: ['$delinquency.daysOverdue', 30] }, '$balance.outstanding', 0] } },
    } },
    { $unset: '_id' },
  ]);
  return row ?? { activeContracts: 0, mrr: 0, overdue: 0, delinquent: 0, d1_7: 0, d8_15: 0, d16_30: 0, d30p: 0 };
}
