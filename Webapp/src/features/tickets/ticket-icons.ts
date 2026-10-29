import { Bug, CircleHelp, CreditCard, Hammer, Headset, KeyRound, ShieldAlert, SprayCan, Wrench, type LucideIcon } from 'lucide-react';
import type { TicketCategory } from '@ssm/shared';

/** Loại yêu cầu hỗ trợ → icon, để danh sách nhìn là nhận ra loại việc. */
export const TICKET_CATEGORY_ICON: Record<TicketCategory, LucideIcon> = {
  ACCESS: KeyRound, DAMAGE: Hammer, PEST: Bug, BILLING: CreditCard, MAINTENANCE: Wrench,
  SECURITY: ShieldAlert, CLEANING: SprayCan, OTHER: CircleHelp, CONSULTATION: Headset,
};
