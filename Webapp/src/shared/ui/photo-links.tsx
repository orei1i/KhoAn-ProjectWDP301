'use client';

import { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { EVIDENCE_PHOTO_MAX_BYTES, EVIDENCE_PHOTO_MAX_EDGE, isUploadedPhotoUrl } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';

/**
 * ẢNH CHỨNG CỨ (RV3): chọn ảnh từ máy → nén ở trình duyệt → tải lên POST /uploads/photos → nhận link ảnh của KhoAn. Không còn dán link
 * Google Drive. Giá trị form vẫn là MỘT chuỗi các link cách nhau xuống dòng (giữ nguyên cách các màn hình đang lưu state), nên
 * `parsePhotoLinks` dùng như cũ để lấy danh sách gửi lên server.
 */
const LINK_RE = /^https:\/\/\S+$/;
export function parsePhotoLinks(text: string, max = 20) {
  const urls = text.split(/[\s,]+/).filter(Boolean);
  return { urls, ok: urls.length <= max && urls.every((u) => (LINK_RE.test(u) || isUploadedPhotoUrl(u)) && u.length <= 500) };
}

/** Thu nhỏ ảnh (cạnh dài ≤ EVIDENCE_PHOTO_MAX_EDGE) và nén JPEG — ảnh điện thoại 5–10MB còn vài trăm KB. */
async function compress(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, EVIDENCE_PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length * 0.75 <= EVIDENCE_PHOTO_MAX_BYTES) return url;
  }
  throw new Error('Ảnh quá lớn — chọn ảnh khác');
}

/** Ô tải ảnh: ảnh đã có hiện thu nhỏ (bấm để xem, nút × để bỏ), nút "Thêm ảnh" chọn nhiều ảnh một lần. */
export function PhotoUploadInput({ value, onChange, max = 20, required = false }: { value: string; onChange: (v: string) => void; max?: number; required?: boolean }) {
  const { toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const urls = parsePhotoLinks(value, max).urls;
  // Giá trị mới nhất trong lúc nhiều ảnh tải lên song song.
  const latest = useRef(urls);
  latest.current = urls;
  const set = (next: string[]) => { latest.current = next; onChange(next.join('\n')); };

  const pick = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, max - urls.length));
    if (!list.length) return;
    setBusy((n) => n + list.length);
    for (const f of list) {
      try {
        const dataUrl = await compress(f);
        const { url } = await api.post<{ url: string }>('/uploads/photos', { dataUrl });
        set([...latest.current, url]);
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Không tải được ảnh', 'error');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={`${i}-${u}`} className="relative size-20 overflow-hidden rounded-lg ring-1 ring-inset ring-stone-200">
            <a href={u} target="_blank" rel="noreferrer noopener" title={`Ảnh ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- ảnh của API, không qua tối ưu ảnh của Next */}
              <img src={u} alt={`Ảnh ${i + 1}`} className="size-full object-cover" />
            </a>
            <button type="button" onClick={() => set(urls.filter((_, k) => k !== i))} aria-label={`Bỏ ảnh ${i + 1}`}
              className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-ink/70 text-white hover:bg-ink">
              <X className="size-3" />
            </button>
          </div>
        ))}
        {urls.length < max && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
            className="grid size-20 place-items-center rounded-lg border border-dashed border-stone-300 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-60">
            <span className="flex flex-col items-center gap-1">
              {busy > 0 ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
              {busy > 0 ? `Đang tải ${busy}` : 'Thêm ảnh'}
            </span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} />
      <p className="mt-1 text-xs text-stone-500">{urls.length}/{max} ảnh{required ? ' · cần ít nhất 1 ảnh' : ''}</p>
    </div>
  );
}

/** Ô ảnh chứng cứ có nhãn (form bồi thường của khách và quản lý). */
export function PhotoLinksField({ value, onChange, label = 'Ảnh chứng cứ (không bắt buộc)', max = 20 }: { value: string; onChange: (v: string) => void; label?: string; max?: number }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <span id={id} className="mb-1.5 block text-xs font-medium text-stone-700">{label}</span>
      <PhotoUploadInput value={value} onChange={onChange} max={max} />
    </div>
  );
}

/** Ảnh trong chi tiết hồ sơ — ảnh thu nhỏ, bấm mở ảnh lớn ở tab mới (link cũ dạng Google Drive vẫn bấm mở được). */
export function PhotoLinks({ urls }: { urls?: string[] | null }) {
  if (!urls?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <a key={`${i}-${u}`} href={u} target="_blank" rel="noreferrer noopener" title={`Ảnh ${i + 1}`}
          className="block size-16 overflow-hidden rounded-lg bg-stone-100 ring-1 ring-inset ring-stone-200 hover:opacity-90">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh của API, không qua tối ưu ảnh của Next */}
          <img src={u} alt={`Ảnh ${i + 1}`} className="size-full object-cover" />
        </a>
      ))}
    </div>
  );
}
