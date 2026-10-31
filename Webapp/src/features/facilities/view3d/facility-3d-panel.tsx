'use client';

import dynamic from 'next/dynamic';
import { Component, useEffect, useState, type ReactNode } from 'react';
import type { PublicSiteUnit, UnitCategory } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { Button, Skeleton } from '@/shared/ui';

/** Loại kho kèm giá đang hiển thị — `offReason`: loại này không chọn được với thời hạn hiện tại (ô vẫn hiện còn trống, bấm thì báo lý do). */
export interface Site3DType {
  _id: string; name: string; category: UnitCategory;
  dimensions: { widthM: number; depthM: number; heightM: number };
  priceText: string; offReason?: string;
}

const Loading = () => <Skeleton className="h-[62vh] max-h-[640px] min-h-[380px] rounded-xl" />;
// Chỉ tải three.js khi khách mở chế độ 3D — trang chi nhánh mở bình thường không tốn thêm gói nào.
const FacilityScene = dynamic(() => import('./scene'), { ssr: false, loading: Loading });

/** Lý do không dựng được 3D trên thiết bị này (không có WebGL / máy quá yếu); null = dựng được. */
function cannot3D(): string | null {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.deviceMemory ?? 8) < 2 || (nav.hardwareConcurrency ?? 8) < 2) return 'Máy này hơi yếu để xem 3D';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    if (!gl) return 'Trình duyệt không hỗ trợ xem 3D';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  } catch {
    return 'Trình duyệt không hỗ trợ xem 3D';
  }
}

/** Lỗi dựng cảnh hoặc không tải được gói 3D → quay về sơ đồ 2D thay vì làm hỏng cả trang đặt kho. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Chế độ "Xem 3D": kiểm tra thiết bị, lấy toàn bộ ô của chi nhánh rồi mới tải cảnh 3D. */
export function Facility3DPanel({ facilityId, types, selected, onToggle, onBlocked, onFallback, reloadKey = 0 }: {
  facilityId: string; types: Site3DType[]; selected: readonly string[];
  /** Đợt 17 (C5): tăng lên để lấy lại trạng thái ô (ô vừa có người đặt) mà không dựng lại từ đầu. */
  reloadKey?: number;
  onToggle: (unit: PublicSiteUnit) => void; onBlocked: (message: string) => void; onFallback: (reason: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<PublicSiteUnit[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const reason = cannot3D();
    if (reason) onFallback(reason); else setReady(true);
  }, [onFallback]);

  // Lấy lại mỗi lần mở: trạng thái ô có thể đổi trong lúc khách xem trang.
  useEffect(() => {
    let alive = true;
    api.get<{ items: PublicSiteUnit[] }>(`/facilities/public/${facilityId}/site-map`)
      .then((d) => { if (alive) { setItems(d.items); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [facilityId, attempt, reloadKey]);

  if (error) {
    return (
      <div className="rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-600 ring-1 ring-inset ring-stone-200">
        <p>Chưa tải được mô hình 3D ({error}).</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setError(''); setItems(null); setAttempt((n) => n + 1); }}>Thử lại</Button>
      </div>
    );
  }
  if (!ready || !items) return <Loading />;
  if (items.length === 0) return <p className="text-sm text-stone-500">Chi nhánh chưa có ô kho nào.</p>;
  return (
    <SceneBoundary onError={() => onFallback('Không dựng được mô hình 3D')}>
      <FacilityScene units={items} types={types} selected={selected} onToggle={onToggle} onBlocked={onBlocked} onContextLost={() => onFallback('Trình duyệt đã dừng đồ hoạ 3D')} />
    </SceneBoundary>
  );
}
