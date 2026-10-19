'use client';

import { firebaseAuth, firebaseConfigured } from '@/shared/api/firebase';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const current = firebaseConfigured ? firebaseAuth().currentUser : null;
  const token = current ? await current.getIdToken() : null; // SDK caches and refreshes (1h) automatically
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Không kết nối được API (${API_URL}) — BE đã chạy chưa?`);
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Lỗi máy chủ (${res.status})`, err?.details);
  }
  return data as T;
}

/** Tải file nhị phân (PDF...) có kèm token — thẻ <a href> thường không gắn được header Authorization. */
async function blob(path: string): Promise<Blob> {
  const current = firebaseConfigured ? firebaseAuth().currentUser : null;
  const token = current ? await current.getIdToken() : null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, 'NETWORK', `Không kết nối được API (${API_URL}) — BE đã chạy chưa?`);
  }
  if (!res.ok) {
    const err = ((await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Lỗi máy chủ (${res.status})`);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  blob,
};
