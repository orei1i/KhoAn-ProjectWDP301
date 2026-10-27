import type { NoticeEmailStatus, Role } from '@ssm/shared';
import { UserModel } from '../../shared/db/models';
import { isBlockedAddress, sendMail } from '../../shared/mail/mailer';

/** Kết quả báo nhân sự: SENT nếu ít nhất một người nhận được; NO_RECIPIENT = không có tài khoản nào đủ điều kiện nhận. */
export type StaffNotifyStatus = Exclude<NoticeEmailStatus, 'PENDING' | 'NO_EMAIL'> | 'NO_RECIPIENT';

/**
 * Báo việc mới cho nhân sự nội bộ qua email (VD có yêu cầu tư vấn mới → quản lý chi nhánh; yêu cầu dữ liệu cá nhân → quản trị viên).
 * Chỉ gửi cho tài khoản đang hoạt động, đã có đăng nhập thật và không thuộc tên miền demo bị chặn. Không bao giờ ném lỗi — việc chính
 * (tạo phiếu, tạo yêu cầu) đã xong; email chỉ là nhắc thêm, phiếu vẫn nằm trong hàng chờ trên hệ thống. Trả trạng thái gộp để ghi lại.
 */
export async function notifyStaff(target: { roles: Role[]; facilityId?: unknown }, subject: string, lines: string[]): Promise<StaffNotifyStatus> {
  try {
    const users = await UserModel.find({
      role: { $in: target.roles }, status: 'ACTIVE', firebaseUid: { $ne: null },
      ...(target.facilityId ? { facilityIds: target.facilityId } : {}),
    }, { email: 1, fullName: 1 }).lean();
    const results: StaffNotifyStatus[] = [];
    for (const u of users) {
      if (!u.email || isBlockedAddress(u.email)) { results.push('SKIPPED'); continue; }
      const body = [`Xin chào ${u.fullName},`, ...lines, 'Hệ thống KhoAn'];
      const r = await sendMail({ to: u.email, subject, text: body.join('\n\n'), html: body.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('') });
      results.push(r.sent ? 'SENT' : r.reason === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : r.reason === 'BLOCKED' ? 'SKIPPED' : 'FAILED');
    }
    if (results.length === 0) return 'NO_RECIPIENT';
    return (['SENT', 'FAILED', 'NOT_CONFIGURED'] as const).find((s) => results.includes(s)) ?? 'SKIPPED';
  } catch (e) {
    console.error('[notify-staff]', e instanceof Error ? e.message : e);
    return 'FAILED';
  }
}
