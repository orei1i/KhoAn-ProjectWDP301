'use client';

import { ImageIcon } from 'lucide-react';
import { Field, inputCls } from '@/shared/ui';

/**
 * Ảnh chứng cứ dạng link (chưa có tải ảnh lên): mỗi link https một dòng hoặc cách nhau dấu phẩy — như ô link ảnh ở biên bản trả kho.
 * `parsePhotoLinks` trả danh sách link và cờ hợp lệ (mọi link đều https, không quá `max`).
 */
const HTTPS_RE = /^https:\/\/\S+$/;
export function parsePhotoLinks(text: string, max = 20) {
  const urls = text.split(/[\s,]+/).filter(Boolean);
  return { urls, ok: urls.length <= max && urls.every((u) => HTTPS_RE.test(u) && u.length <= 500) };
}

export function PhotoLinksField({ value, onChange, label = 'Link ảnh chứng cứ (không bắt buộc)', max = 20 }: { value: string; onChange: (v: string) => void; label?: string; max?: number }) {
  const { urls, ok } = parsePhotoLinks(value, max);
  return (
    <Field label={label} hint={`Mỗi link https một dòng, tối đa ${max} ảnh (Google Drive, Google Photos…)`} error={ok ? undefined : 'Chỉ nhận link bắt đầu bằng https://'}>
      <textarea className={inputCls} rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />
      {urls.length > 0 && ok && <span className="mt-1 block text-xs text-stone-500">{urls.length} ảnh</span>}
    </Field>
  );
}

/** Hiện link ảnh trong chi tiết hồ sơ — ảnh nhỏ bấm mở tab mới; ảnh không tải được thì vẫn còn link. */
export function PhotoLinks({ urls }: { urls?: string[] | null }) {
  if (!urls?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <a key={`${i}-${u}`} href={u} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-50">
          <ImageIcon className="size-3.5" />Ảnh {i + 1}
        </a>
      ))}
    </div>
  );
}
