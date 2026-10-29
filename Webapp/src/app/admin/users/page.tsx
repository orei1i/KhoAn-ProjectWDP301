'use client';

import { useMemo, useState } from 'react';
import { Building2, Clock, KeyRound, LogIn, Mail, Pencil, ShieldCheck, TriangleAlert, UserPlus, UserRound, Users as UsersIcon } from 'lucide-react';
import type { CheckInShift, Role, User, UserStatus } from '@ssm/shared';
import { STAFF_SHIFTS } from '@ssm/shared';
import { useStore } from '@/shared/store/store';
import { CHECK_IN_SHIFT, ROLE, USER_STATUS } from '@/shared/lib/labels';
import { facilityName } from '@/shared/lib/domain';
import { fmtDateTime, todayISO } from '@/shared/lib/format';
import { Button, Card, EmptyState, Field, Modal, PageHeader, StatusBadge, cx, inputCls } from '@/shared/ui';
import { Avatar, Callout, Meta, PillFilter, QueueRow } from '@/features/staff-ui';
import { ROLE_ICON, RoleBadge, SearchInput, Section } from '@/features/backoffice-ui';

type Form = { _id?: string; fullName: string; email: string; role: Role; facilityIds: string[]; status: UserStatus; shift: CheckInShift | null; authNumber: string; authDate: string };
const ROLES = Object.keys(ROLE) as Role[];

export default function Users() {
  const { db, run, user } = useStore();
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const facilities = db.facilities.filter((f) => !f.isDeleted);

  const rows = useMemo(() => db.users.filter((u) => !u.isDeleted && (role === 'ALL' || u.role === role) && (!q || `${u.fullName} ${u.email}`.toLowerCase().includes(q.toLowerCase()))), [db.users, role, q]);
  const edit = (u: User) => setForm({ _id: u._id, fullName: u.fullName, email: u.email, role: u.role, facilityIds: [...u.facilityIds], status: u.status, shift: u.shift ?? null, authNumber: u.authorization?.number ?? '', authDate: u.authorization?.issuedOn?.slice(0, 10) ?? '' });
  // Giấy uỷ quyền: nhập đủ số + ngày, hoặc để trống cả hai (hợp đồng sẽ ghi "số giấy uỷ quyền: đang cập nhật").
  const authOk = !form || form.role !== 'FACILITY_MANAGER' || (!form.authNumber.trim() && !form.authDate) || (form.authNumber.trim().length >= 3 && !!form.authDate && form.authDate <= todayISO().slice(0, 10));
  const toSave = (f: Form) => ({ ...f, authorization: f.role === 'FACILITY_MANAGER' && f.authNumber.trim() && f.authDate ? { number: f.authNumber.trim(), issuedOn: f.authDate } : null });
  const scoped = form && (form.role === 'STAFF' || form.role === 'FACILITY_MANAGER');
  // Quản lý chi nhánh phụ trách đúng 1 kho → chọn một, không phải tick nhiều.
  const single = form?.role === 'FACILITY_MANAGER';
  // Nhân viên chia theo ca cố định — hàng đợi nhận kho lọc theo ca để đúng người trực xử lý.
  const needsShift = form?.role === 'STAFF';
  // BE chặn admin tự hạ quyền / tự khoá chính mình — khoá luôn hai ô này trên form cho rõ.
  const isSelf = !!form?._id && form._id === user?._id;
  // Nhân sự chi nhánh đang có việc được giao: khoá / đổi vai trò / chuyển chi nhánh thì BE tự gỡ phân công (xem updateUser).
  const wasScoped = !!form?._id && ['STAFF', 'FACILITY_MANAGER'].includes(db.users.find((u) => u._id === form._id)?.role ?? '');
  // Tài khoản khách và nhân sự phải tách riêng: không đổi khách ↔ nhân sự (BE trả ROLE_CHANGE_FORBIDDEN); đổi giữa các vai trò nhân sự vẫn được.
  const wasCustomer = !!form?._id && db.users.find((u) => u._id === form._id)?.role === 'CUSTOMER';
  const roleOptions = !form?._id ? ROLES : wasCustomer ? (['CUSTOMER'] as Role[]) : ROLES.filter((r) => r !== 'CUSTOMER');

  return (
    <>
      <PageHeader title="Người dùng & phân quyền" description="Nhân viên kho và Quản lý chi nhánh chỉ truy cập dữ liệu thuộc chi nhánh được gán." actions={<Button onClick={() => setForm({ fullName: '', email: '', role: 'STAFF', facilityIds: [], status: 'PENDING_VERIFICATION', shift: 'SHIFT_1', authNumber: '', authDate: '' })}><UserPlus className="size-4" />Tạo tài khoản</Button>} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillFilter value={role} onChange={setRole} options={[
          { key: 'ALL' as const, label: 'Tất cả', icon: <UsersIcon />, count: db.users.length },
          ...ROLES.map((r) => { const Icon = ROLE_ICON[r]; return { key: r, label: ROLE[r].label, icon: <Icon />, count: db.users.filter((u) => u.role === r).length }; }),
        ]} />
        <SearchInput className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Tìm tên, email" />
      </div>
      <Card className="mt-4">
        {rows.length === 0 ? <EmptyState icon={<UsersIcon className="size-6" />} title="Không có người dùng phù hợp" /> : (
          <ul className="divide-y divide-stone-100">
            {rows.map((u) => (
              <QueueRow key={u._id} onSelect={() => edit(u)}
                lead={<Avatar name={u.fullName} tone={ROLE[u.role].tone} />}
                title={u.fullName}
                badges={<><RoleBadge role={u.role} /><StatusBadge map={USER_STATUS} value={u.status} /></>}
                meta={<>
                  <Meta icon={<Mail />}>{u.email}</Meta>
                  {(u.facilityIds.length > 0 || u.role !== 'CUSTOMER') && (
                    <Meta icon={<Building2 />}>{u.facilityIds.length ? u.facilityIds.map((id) => facilityName(db, id)).join(', ') : 'Toàn hệ thống'}</Meta>
                  )}
                  {u.role === 'STAFF' && u.shift && <Meta icon={<Clock />}>{CHECK_IN_SHIFT[u.shift].label}</Meta>}
                  <Meta icon={<LogIn />}>{fmtDateTime(u.lastLoginAt)}</Meta>
                </>}
                actions={<Pencil className="size-4 text-stone-300" aria-hidden />}
              />
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?._id ? 'Sửa tài khoản' : 'Tạo tài khoản'} description="Đổi vai trò, chi nhánh hoặc trạng thái sẽ buộc người dùng đăng nhập lại."
        footer={<Button disabled={(needsShift && !form?.shift) || !authOk} onClick={() => form && void run('saveUser', toSave(form), (v) => (v.resetLink ? 'Đã tạo tài khoản — link đặt mật khẩu đã sao chép vào clipboard' : 'Đã lưu tài khoản'), (v) => { if (v.resetLink) void navigator.clipboard?.writeText(v.resetLink); setForm(null); })}>Lưu</Button>}>
        {form && (
          <div className="space-y-6">
            {form._id && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-stone-50 p-3 ring-1 ring-inset ring-stone-200">
                <Avatar name={form.fullName || form.email} tone={ROLE[form.role].tone} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{form.fullName || '—'}</p>
                  <p className="truncate text-xs text-stone-500">{form.email}</p>
                </div>
                <RoleBadge role={form.role} />
              </div>
            )}
            {(() => {
              // tokenVersion đếm số lần quyền bị đổi và phiên bị thu hồi. Bằng 0 thì không có gì để nói.
              const revoked = db.users.find((u) => u._id === form._id)?.tokenVersion ?? 0;
              return revoked > 0 ? <Callout tone="gray" icon={<KeyRound />}>Tài khoản này đã bị thu hồi phiên đăng nhập <b>{revoked}</b> lần do thay đổi quyền.</Callout> : null;
            })()}

            <Section icon={<UserRound />} title="Tài khoản">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Họ tên"><input className={inputCls} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
                {form._id
                  ? <Field label="Email" tip="Không sửa được."><input className={cx(inputCls, 'bg-stone-50 text-stone-500')} value={form.email} readOnly aria-readonly /></Field>
                  : <Field label="Email"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
              </div>
            </Section>

            <Section icon={<ShieldCheck />} title="Vai trò & trạng thái">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vai trò" hint={wasCustomer ? 'Tài khoản khách không đổi sang nhân sự.' : undefined}><select className={inputCls} disabled={isSelf || wasCustomer} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role, shift: e.target.value === 'STAFF' ? (form.shift ?? 'SHIFT_1') : null })}>{roleOptions.map((r) => <option key={r} value={r}>{ROLE[r].label}</option>)}</select></Field>
                <Field label="Trạng thái"><select className={inputCls} disabled={isSelf} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as UserStatus })}>{Object.entries(USER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
              </div>
              {isSelf && <Callout tone="gray" icon={<ShieldCheck />}>Không tự đổi vai trò / tự khoá chính mình.</Callout>}
              {wasScoped && (
                <Callout tone="amber" icon={<TriangleAlert />}>Tạm khoá / đổi vai trò / chuyển chi nhánh sẽ gỡ các việc đang giao cho người này ở chi nhánh không còn phụ trách.</Callout>
              )}
              {form.role === 'FACILITY_MANAGER' && (
                <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
                  <Field label="Số giấy uỷ quyền ký hợp đồng" tip="In vào hợp đồng của chi nhánh.">
                    <input className={inputCls} value={form.authNumber} placeholder="01/2026/UQ-KHOAN" onChange={(e) => setForm({ ...form, authNumber: e.target.value })} />
                  </Field>
                  <Field label="Ngày uỷ quyền"><input type="date" className={inputCls} max={todayISO().slice(0, 10)} value={form.authDate} onChange={(e) => setForm({ ...form, authDate: e.target.value })} /></Field>
                </div>
              )}
              {needsShift && (
                <Field label="Ca làm việc">
                  <select className={inputCls} value={form.shift ?? ''} onChange={(e) => setForm({ ...form, shift: e.target.value as CheckInShift })}>
                    {STAFF_SHIFTS.map((s) => <option key={s} value={s}>{CHECK_IN_SHIFT[s].label}</option>)}
                  </select>
                </Field>
              )}
            </Section>

            <Section icon={<Building2 />} title="Phạm vi chi nhánh" aside={<span className="text-xs text-stone-500">{scoped ? 'Bắt buộc ít nhất 1 chi nhánh.' : 'Không giới hạn theo chi nhánh.'}</span>}>
              <div className="grid gap-2 sm:grid-cols-2">
                {facilities.map((f) => {
                  const on = !!scoped && form.facilityIds.includes(f._id);
                  return (
                    <label key={f._id} className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset transition-colors', scoped ? (on ? 'cursor-pointer bg-brand-50 text-brand-950 ring-brand-300' : 'cursor-pointer ring-stone-300 hover:bg-stone-50') : 'cursor-not-allowed opacity-50 ring-stone-200')}>
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name="facilityScope"
                        className="accent-brand-700"
                        disabled={!scoped}
                        checked={!!scoped && form.facilityIds.includes(f._id)}
                        onChange={(e) => setForm({
                          ...form,
                          facilityIds: single
                            ? [f._id]
                            : e.target.checked ? [...form.facilityIds, f._id] : form.facilityIds.filter((x) => x !== f._id),
                        })}
                      />
                      <Building2 className={cx('size-4 shrink-0', on ? 'text-brand-600' : 'text-stone-400')} aria-hidden />
                      <span className="min-w-0 truncate">{f.name}</span>
                    </label>
                  );
                })}
              </div>
            </Section>
          </div>
        )}
      </Modal>
    </>
  );
}
