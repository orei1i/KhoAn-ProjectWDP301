import type { Role } from '@ssm/shared';
import { UserModel } from '../../shared/db/models';
import { isBlockedAddress, sendMail } from '../../shared/mail/mailer';

/**
 * Báo việc mới cho nhân sự nội bộ qua email (VD có yêu cầu tư vấn mới → quản lý chi nhánh; yêu cầu dữ liệu cá nhân → quản trị viên).
 * Chỉ gửi cho tài khoản đang hoạt động, đã có đăng nhập thật và không thuộc tên miền demo bị chặn. Không bao giờ ném lỗi — việc chính
 * (tạo phiếu, tạo yêu cầu) đã xong; email chỉ là nhắc thêm, phiếu vẫn nằm trong hàng chờ trên hệ thống.
 */
export async function notifyStaff(target: { roles: Role[]; facilityId?: unknown }, subject: string, lines: string[]) {
  try {
    const users = await UserModel.find({
      role: { $in: target.roles }, status: 'ACTIVE', firebaseUid: { $ne: null },
      ...(target.facilityId ? { facilityIds: target.facilityId } : {}),
    }, { email: 1, fullName: 1 }).lean();
    for (const u of users) {
      if (!u.email || isBlockedAddress(u.email)) continue;
      const body = [`Xin chào ${u.fullName},`, ...lines, 'Hệ thống KhoAn'];
      await sendMail({ to: u.email, subject, text: body.join('\n\n'), html: body.map((l) => `<p>${l.replace(/[<>&]/g, '')}</p>`).join('') });
    }
  } catch (e) {
    console.error('[notify-staff]', e instanceof Error ? e.message : e);
  }
}
