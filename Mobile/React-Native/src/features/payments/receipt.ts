import { useState } from 'react';
import { Linking } from 'react-native';
import type { PaymentTransaction } from '@ssm/shared';
import { COLLECTED_PAYMENT_STATUSES } from '@ssm/shared';
import { API_URL, ApiError, api } from '../../shared/api/client';
import { useStore } from '../../shared/store/store';

/** Có biên lai: khoản đã thu tiền, hoặc khoản hoàn đã chi (cùng điều kiện với web). */
export const hasReceipt = (p: Pick<PaymentTransaction, 'direction' | 'status' | 'method'>) =>
  p.method !== 'INTERNAL' && (p.direction === 'CHARGE' ? COLLECTED_PAYMENT_STATUSES.includes(p.status) : p.status === 'SUCCEEDED');

/**
 * Biên lai PDF: xin link ký ngắn hạn (5 phút) rồi mở bằng trình duyệt của máy — trình duyệt tải / xem / chia sẻ PDF, không cần thư viện thêm.
 * `opening` = id khoản đang mở (để hiện "Đang mở…" và chặn bấm chồng).
 */
export function useReceipt() {
  const { toast } = useStore();
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (paymentId: string) => {
    setOpening(paymentId);
    try {
      const link = await api.post<{ path: string }>(`/payments/${paymentId}/receipt-link`);
      await Linking.openURL(`${API_URL}${link.path}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Không mở được biên lai — thử lại sau', 'error');
    } finally {
      setOpening(null);
    }
  };
  return { opening, open };
}
