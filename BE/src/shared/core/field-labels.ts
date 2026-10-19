/** Nhãn tiếng Việt của các trường hay gặp — để thông báo lỗi nói rõ "Tên chi nhánh: …" thay vì "name: …". */
const LABELS: Record<string, string> = {
  name: 'Tên', code: 'Mã', line1: 'Số nhà, tên đường', district: 'Quận / Huyện', city: 'Tỉnh / Thành phố', phone: 'Điện thoại', status: 'Trạng thái',
  description: 'Mô tả', category: 'Nhóm cỡ', widthM: 'Chiều rộng', depthM: 'Chiều sâu', heightM: 'Chiều cao', indoor: 'Trong nhà',
  rates: 'Giá thuê', 'rates.DAY': 'Giá theo ngày', 'rates.WEEK': 'Giá theo tuần', 'rates.MONTH': 'Giá theo tháng',
  depositOverride: 'Tiền giữ chân cố định', minPeriods: 'Thuê tối thiểu', maxPeriods: 'Thuê tối đa',
  unitTypeId: 'Loại kho', unitNumber: 'Mã ô', floor: 'Tầng', zone: 'Khu', accessMethod: 'Hình thức khoá', prefix: 'Tiền tố mã', start: 'Số bắt đầu', count: 'Số lượng',
  facilityId: 'Chi nhánh', email: 'Email', fullName: 'Họ tên', password: 'Mật khẩu', amount: 'Số tiền', reason: 'Lý do', note: 'Ghi chú',
  'location.coordinates': 'Toạ độ',
};

export const fieldLabel = (path: string): string => LABELS[path] ?? LABELS[path.split('.').pop() ?? ''] ?? path;

/** "Tên: Phải có ít nhất 3 ký tự; Điện thoại: Sai định dạng" — tối đa 3 lỗi đầu cho gọn trong toast. */
export function summarizeFieldErrors(items: { path: string; message: string }[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const it of items) {
    const text = it.path ? `${fieldLabel(it.path)}: ${it.message}` : it.message;
    if (!seen.has(text)) { seen.add(text); parts.push(text); }
  }
  const shown = parts.slice(0, 3).join('; ');
  return parts.length > 3 ? `${shown}; … (+${parts.length - 3} lỗi khác)` : shown;
}
