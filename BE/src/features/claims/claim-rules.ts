/**
 * Quy tắc bồi thường hư hỏng / mất mát (A2). Mức trách nhiệm, thời hạn gửi, hạn mức duyệt của quản lý chi nhánh là ĐIỀU KHOẢN dùng
 * chung với Webapp / app — nằm ở @ssm/shared (claim-rules). Ở đây chỉ còn giới hạn vận hành của riêng BE.
 */
export { CLAIM_COUNTED_STATUSES, CLAIM_FM_APPROVAL_LIMIT, CLAIM_WINDOW_DAYS, claimCapOf, claimNeedsOps, claimTotal, sameIncident } from '@ssm/shared';

/** Số hồ sơ đang mở tối đa trên một hợp đồng. Chặn gửi trùng, không phải chặn quyền khiếu nại. */
export const MAX_OPEN_CLAIMS_PER_CONTRACT = 3;
