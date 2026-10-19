import type { ContractStatus } from './enums';
import type { RentalContract } from './entities';
import { addDays, fmtDate, vnd } from './format';

/**
 * Trạng thái hợp đồng quay về khi huỷ đăng ký trả kho (khách / nhân viên rút, hoặc job tự huỷ): theo đợt nợ đang mở — còn nợ đã
 * khoá thì về LOCKED_OUT, còn nợ chưa khoá thì DELINQUENT, không nợ thì ACTIVE. Về ACTIVE khi đang nợ sẽ kẹt: không khoá được, không
 * gửi được thông báo cuối.
 */
export const statusBeforeMoveOut = (c: { delinquency?: { lockedOutAt?: unknown } | null }): Extract<ContractStatus, 'ACTIVE' | 'DELINQUENT' | 'LOCKED_OUT'> =>
  c.delinquency ? (c.delinquency.lockedOutAt ? 'LOCKED_OUT' : 'DELINQUENT') : 'ACTIVE';

/**
 * Cảnh báo công nợ hiện cho KHÁCH ở hợp đồng đang nợ — theo đúng các mốc Điều 7 Điều khoản và đúng hạn chót trong thông báo khách
 * đã nhận (contract.notices), dùng chung Webapp và app mobile để hai nơi nói cùng một câu.
 */
export interface DelinquencyAlert { tone: 'amber' | 'red'; title: string; text: string }

type C = Pick<RentalContract, 'status' | 'balance' | 'delinquency' | 'notices' | 'terms' | 'billing'>;

const lastNotice = (c: C, kind: string, since?: string | null) =>
  [...(c.notices ?? [])].reverse().find((n) => n.kind === kind && (!since || n.at >= since));

export function delinquencyAlert(c: C): DelinquencyAlert | null {
  const due = vnd(c.balance.outstanding);
  if (c.status === 'DELINQUENT') {
    const lockFrom = lastNotice(c, 'GRACE_EXPIRED', c.delinquency?.since)?.deadline ?? addDays(c.billing.paidThrough, c.terms.lockoutAfterDays + 2);
    return {
      tone: 'amber', title: 'Quá hạn thanh toán',
      text: `Dư nợ ${due}. Nếu chưa thanh toán, quyền ra vào kho sẽ bị khoá từ ngày ${fmtDate(lockFrom)}.`,
    };
  }
  if (c.status === 'LOCKED_OUT') {
    const finalAt = c.delinquency?.finalNoticeAt;
    const final = finalAt ? lastNotice(c, 'FINAL_NOTICE', finalAt) : undefined;
    if (finalAt && final?.deadline) {
      return {
        tone: 'red', title: 'THÔNG BÁO CUỐI',
        text: `Thanh toán ${due} hoặc liên hệ chi nhánh trước hết ngày ${fmtDate(addDays(final.deadline, -1))}. Từ ngày ${fmtDate(final.deadline)}, chi nhánh được mở kho, kiểm kê và thanh lý đồ trong kho để bù công nợ; phần còn dư sẽ được trả lại bạn.`,
      };
    }
    return {
      tone: 'red', title: 'Đã khoá quyền ra vào',
      text: `Đồ trong kho vẫn được giữ nguyên. Thanh toán đủ ${due} để mở lại ngay. Nếu vẫn chưa thanh toán, KhoAn sẽ gửi thông báo cuối trước khi được xử lý đồ trong kho.`,
    };
  }
  return null;
}
