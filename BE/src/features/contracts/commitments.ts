import type { ClientSession } from 'mongoose';
import { ReservationModel } from '../../shared/db/models';
import type { RentalContractHydrated } from './rental-contract.model';

type ContractDoc = RentalContractHydrated;

/**
 * Hợp đồng tạo trước khi có `commitments`: dựng lại kỳ cam kết GỐC từ báo giá lúc đặt, để khi gia hạn hệ thống biết đâu là
 * kỳ gốc (giá cũ) và đâu là kỳ gia hạn (giá mới) — không thì cả quãng trước bị coi như "ngoài cam kết".
 */
export async function ensureInitialCommitment(c: ContractDoc, session: ClientSession | null) {
  if (c.commitments?.length) return;
  const rsv = await ReservationModel.findById(c.reservationId, { quote: 1, periods: 1 }).session(session).lean();
  const initialEnd = c.renewals[0]?.previousEndDate ?? c.endDate;
  c.commitments = [{
    kind: 'INITIAL', startDate: c.startDate, endDate: initialEnd, periods: rsv?.periods ?? 1,
    gross: rsv ? rsv.quote.rate + rsv.quote.surchargeAmount : c.billing.rate, discountAmount: rsv?.quote.discountAmount ?? 0, rate: c.billing.rate,
    policyId: rsv?.quote.policyId ?? c.terms.policyId, at: c.startDate,
  }] as ContractDoc['commitments'];
}

