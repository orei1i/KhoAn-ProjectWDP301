/**
 * Ảnh chữ ký vẽ tay (ký online kiểu DRAWN, ký nhận khi bàn giao kho) phải là PNG THẬT: data URL base64, đúng 8 byte chữ ký PNG, khối IHDR
 * đầu tiên đọc được kích thước hợp lý. Chặn chuỗi base64 bất kỳ / file khác đổi đuôi — ảnh hỏng lưu vào DB sẽ làm hỏng PDF về sau.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIDE = 4096;

export function decodePngDataUrl(dataUrl: string): { width: number; height: number } | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  // chữ ký (8) + độ dài khối (4) + "IHDR" (4) + rộng (4) + cao (4) …
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIGNATURE) || b.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null;
  return { width, height };
}

export const isValidPngDataUrl = (dataUrl: string | null | undefined) => !!dataUrl && decodePngDataUrl(dataUrl) !== null;
