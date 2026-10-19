/**
 * Relay gửi email qua Gmail bằng Google Apps Script — dùng khi nơi chạy BE (VD Railway gói Free/Hobby) chặn cổng SMTP.
 * BE gọi script này qua HTTPS (cổng 443); script gửi thư từ chính tài khoản Gmail đã triển khai nó.
 * File này KHÔNG chạy trong dự án — dán vào https://script.google.com (xem hướng dẫn trong BE/.env.example).
 *
 * Thiết lập:
 *  1. script.google.com → Dự án mới → dán toàn bộ file này vào Code.gs.
 *  2. Project Settings (bánh răng) → Script properties → Add: tên SECRET, giá trị = một chuỗi ngẫu nhiên dài
 *     (đặt cùng giá trị cho biến MAIL_RELAY_SECRET của BE).
 *  3. Deploy → New deployment → loại "Web app": Execute as = Me, Who has access = Anyone → Deploy → cấp quyền
 *     (cho phép gửi email) → sao chép "Web app URL" (đặt vào MAIL_RELAY_URL của BE).
 *  Sửa script sau này phải Deploy → Manage deployments → Edit → Version: New version thì URL cũ mới nhận bản mới.
 *
 * Hạn mức Gmail miễn phí qua Apps Script: ~100 người nhận/ngày — đủ cho demo.
 */
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (!d.secret || d.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) return reply({ ok: false, error: 'FORBIDDEN' });
    if (!d.to || !d.subject) return reply({ ok: false, error: 'BAD_REQUEST' });
    MailApp.sendEmail({
      to: d.to,
      subject: d.subject,
      body: d.text || '',
      htmlBody: d.html || undefined,
      name: d.name || 'KhoAn',
      attachments: (d.attachments || []).map(function (a) {
        return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mimeType, a.filename);
      }),
    });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
