'use client';

import { ContractsBoard } from '@/features/contracts/contracts-board';

/** Vận hành: xem hợp đồng của mọi chi nhánh (chỉ xem) — trạng thái, thanh toán, văn bản đã ký, đặt chỗ đã huỷ. */
export default function OpsContracts() {
  return <ContractsBoard readOnly />;
}
