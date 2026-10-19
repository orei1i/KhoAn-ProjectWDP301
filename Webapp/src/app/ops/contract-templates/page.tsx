'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, History, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { ContractTemplate, ContractTemplateClause } from '@ssm/shared';
import { CONTRACT_VARIABLES, SAMPLE_CONTRACT_INPUTS, TEMPLATE_LIMITS, buildContractClauses, cloneDefaultClauses, validateContractTemplate } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { userName } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, Card, CardHeader, Field, PageHeader, Table, cx, inputCls } from '@/shared/ui';

interface Effective { version: number; scope: 'GLOBAL' | 'FACILITY' | 'DEFAULT'; clauses: ContractTemplateClause[] }
type Sample = keyof typeof SAMPLE_CONTRACT_INPUTS;
type LineKind = 'paragraphs' | 'bullets';

const same = (a: ContractTemplateClause[], b: ContractTemplateClause[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Soạn MẪU HỢP ĐỒNG: sửa lời văn từng điều, chèn biến `{{...}}` để hệ thống điền số liệu, xem trước ngay với hợp đồng mẫu,
 * rồi phát hành thành phiên bản mới (toàn chuỗi hoặc riêng một chi nhánh). Không thêm/xoá/đổi thứ tự điều; các câu chứa
 * số tiền và mức hoàn là biến khối do hệ thống soạn. Hợp đồng đã ký giữ nguyên văn lúc ký — mẫu mới chỉ áp cho lần ký sau.
 */
export default function OpsContractTemplates() {
  const { db, run } = useStore();
  const facilities = db.facilities.filter((f) => !f.isDeleted);
  const [facilityId, setFacilityId] = useState(''); // '' = toàn chuỗi
  const [effective, setEffective] = useState<Effective | null>(null);
  const [history, setHistory] = useState<ContractTemplate[]>([]);
  const [draft, setDraft] = useState<ContractTemplateClause[] | null>(null);
  const [active, setActive] = useState(0);
  const [sample, setSample] = useState<Sample>('STANDARD');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // Ô đang gõ gần nhất — bấm một biến sẽ chèn vào đúng vị trí con trỏ của ô đó.
  const focus = useRef<{ kind: LineKind | 'title'; index: number; el: HTMLTextAreaElement | HTMLInputElement } | null>(null);

  useEffect(() => {
    let alive = true;
    const q = facilityId ? `?facilityId=${facilityId}` : '';
    setEffective(null); setDraft(null); setError('');
    Promise.all([api.get<Effective>(`/contract-templates/effective${q}`), api.get<{ items: ContractTemplate[] }>(`/contract-templates${q}`)])
      .then(([e, h]) => { if (!alive) return; setEffective(e); setDraft(e.clauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs], bullets: [...c.bullets] }))); setHistory(h.items); setNote(''); })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [facilityId, reload]);

  const errors = useMemo(() => (draft ? validateContractTemplate(draft) : []), [draft]);
  const preview = useMemo(() => (draft ? buildContractClauses(SAMPLE_CONTRACT_INPUTS[sample], draft) : []), [draft, sample]);

  if (error) return <><PageHeader title="Mẫu hợp đồng" /><Card className="p-5 text-sm text-red-700">Không tải được mẫu hợp đồng: {error}</Card></>;
  if (!effective || !draft) return <><PageHeader title="Mẫu hợp đồng" /><p className="text-sm text-stone-500">Đang tải…</p></>;

  const clause = draft[active];
  const dirty = !same(draft, effective.clauses);
  const ownTemplate = !!facilityId && effective.scope === 'FACILITY';
  const patch = (next: Partial<ContractTemplateClause>) => setDraft(draft.map((c, i) => (i === active ? { ...c, ...next } : c)));
  const setLine = (kind: LineKind, i: number, v: string) => patch({ [kind]: clause[kind].map((x, k) => (k === i ? v : x)) });
  const addLine = (kind: LineKind) => patch({ [kind]: [...clause[kind], ''] });
  const removeLine = (kind: LineKind, i: number) => patch({ [kind]: clause[kind].filter((_, k) => k !== i) });

  const insertVar = (key: string) => {
    const f = focus.current;
    const token = `{{${key}}}`;
    if (!f || !document.body.contains(f.el)) { patch({ bullets: [...clause.bullets, token] }); return; }
    const at = f.el.selectionStart ?? f.el.value.length;
    const end = f.el.selectionEnd ?? at;
    const v = f.el.value.slice(0, at) + token + f.el.value.slice(end);
    if (f.kind === 'title') patch({ title: v }); else setLine(f.kind, f.index, v);
  };

  const publish = () => void run('publishContractTemplate', { facilityId: facilityId || null, clauses: draft, note: note.trim() || undefined },
    (t) => `Đã phát hành mẫu hợp đồng v${t.version}`, () => setReload((x) => x + 1));

  const lines = (kind: LineKind, label: string, hint: string) => (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-stone-700">{label}</p>
        <Button size="sm" variant="ghost" disabled={clause[kind].length >= TEMPLATE_LIMITS.linesPerClause} onClick={() => addLine(kind)}><Plus className="size-3.5" />Thêm</Button>
      </div>
      <p className="text-xs text-stone-500">{hint}</p>
      <div className="mt-2 space-y-2">
        {clause[kind].length === 0 && <p className="text-xs text-stone-400">Không có.</p>}
        {clause[kind].map((v, i) => (
          <div key={`${active}-${kind}-${i}`} className="flex gap-2">
            <textarea className={cx(inputCls, 'min-h-16 font-mono text-[13px] leading-relaxed')} rows={Math.min(8, Math.max(2, Math.ceil(v.length / 90)))} maxLength={TEMPLATE_LIMITS.lineMax}
              value={v} onChange={(e) => setLine(kind, i, e.target.value)} onFocus={(e) => { focus.current = { kind, index: i, el: e.currentTarget }; }} />
            <button type="button" aria-label="Xoá dòng" onClick={() => removeLine(kind, i)} className="grid size-9 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-600"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Mẫu hợp đồng" description="Soạn lời văn từng điều của hợp đồng thuê kho. Số tiền, mức hoàn và thông tin khách do hệ thống điền qua biến. Phát hành tạo phiên bản mới; hợp đồng đã ký giữ nguyên văn lúc ký."
        actions={
          <select className={cx(inputCls, 'w-auto min-w-56')} value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setActive(0); }}>
            <option value="">Toàn chuỗi</option>
            {facilities.map((f) => <option key={f._id} value={f._id}>Riêng {f.name}</option>)}
          </select>
        } />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-500">Đang áp dụng:</span>
        {effective.scope === 'DEFAULT' ? <Badge>Mẫu mặc định của hệ thống</Badge> : <Badge tone="green">v{effective.version} · {effective.scope === 'FACILITY' ? 'riêng chi nhánh' : 'toàn chuỗi'}</Badge>}
        {facilityId && effective.scope !== 'FACILITY' && <span className="text-stone-500">— chi nhánh này chưa có mẫu riêng; phát hành ở đây sẽ tạo mẫu riêng cho chi nhánh.</span>}
        {dirty && <Badge tone="amber">Có thay đổi chưa phát hành</Badge>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ---- soạn */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap gap-1.5">
              {draft.map((c, i) => (
                <button key={c.key} type="button" onClick={() => { setActive(i); focus.current = null; }}
                  className={cx('rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset', i === active ? 'bg-ink text-white ring-ink' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>
                  {c.title || '(chưa đặt tên)'}
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-5 p-5">
            <Field label="Tiêu đề điều khoản" hint={clause.numbered ? 'Số "Điều N" được đánh tự động.' : 'Phần mở đầu, không đánh số.'}>
              <input className={inputCls} maxLength={TEMPLATE_LIMITS.titleMax} value={clause.title} onChange={(e) => patch({ title: e.target.value })} onFocus={(e) => { focus.current = { kind: 'title', index: 0, el: e.currentTarget }; }} />
            </Field>
            {lines('paragraphs', 'Đoạn văn', 'In liền thành đoạn, không có gạch đầu dòng.')}
            {lines('bullets', 'Gạch đầu dòng', 'Mỗi ô là một gạch đầu dòng. Biến khối đặt MỘT MÌNH trong ô sẽ tách thành nhiều dòng.')}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Biến điền sẵn</h3>
            <p className="mt-1 text-xs text-stone-500">Bấm để chèn vào ô đang gõ. Biến có dấu <span className="font-semibold text-red-600">*</span> bắt buộc phải có trong mẫu. Biến khối là câu do hệ thống soạn (chứa số tiền / mức hoàn) — bạn chỉ đặt vị trí.</p>
            {(['VALUE', 'BLOCK'] as const).map((kind) => (
              <div key={kind} className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{kind === 'VALUE' ? 'Biến giá trị' : 'Biến khối'}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {CONTRACT_VARIABLES.filter((v) => v.kind === kind).map((v) => (
                    <button key={v.key} type="button" title={`${v.label}\nVí dụ: ${v.example}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.key)}
                      className={cx('rounded-md px-2 py-1 font-mono text-[11px] ring-1 ring-inset hover:bg-stone-50', kind === 'BLOCK' ? 'text-violet-800 ring-violet-200' : 'text-stone-700 ring-stone-300')}>
                      {`{{${v.key}}}`}{v.required && <span className="ml-0.5 font-sans font-semibold text-red-600">*</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <Card className="space-y-4 p-5">
            {errors.length > 0 ? (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-inset ring-red-200">
                <p className="flex items-center gap-2 font-semibold"><CircleAlert className="size-4" />Chưa phát hành được — còn {errors.length} lỗi</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200"><CircleCheck className="size-4" />Mẫu hợp lệ: đủ điều khoản và đủ biến bắt buộc.</p>
            )}
            <Field label="Nội dung thay đổi (ghi vào lịch sử)"><input className={inputCls} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Làm rõ điều khoản hủy đặt chỗ" /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => { if (window.confirm('Nạp mẫu mặc định của hệ thống vào bản nháp? Các thay đổi chưa phát hành sẽ mất.')) { setDraft(cloneDefaultClauses()); focus.current = null; } }}><RotateCcw className="size-4" />Nạp mẫu mặc định</Button>
              {ownTemplate && <Button variant="ghost" onClick={() => { if (window.confirm('Bỏ mẫu riêng của chi nhánh này và dùng lại mẫu toàn chuỗi?')) void run('retireFacilityTemplate', { facilityId }, 'Chi nhánh đã dùng lại mẫu toàn chuỗi', () => setReload((x) => x + 1)); }}>Bỏ mẫu riêng</Button>}
              <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(effective.clauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs], bullets: [...c.bullets] })))}>Hoàn tác</Button>
              <Button disabled={!dirty || errors.length > 0} onClick={publish}>Phát hành phiên bản mới</Button>
            </div>
            <p className="text-xs text-stone-500">Mẫu mới áp dụng cho các hợp đồng ký từ lúc phát hành. Hợp đồng đã ký không thay đổi.</p>
          </Card>
        </div>

        {/* ---- xem trước */}
        <div className="space-y-4">
          <Card className="xl:sticky xl:top-20">
            <CardHeader title="Xem trước" description="Hợp đồng mẫu với số liệu giả định — khách sẽ thấy đúng như thế này."
              actions={
                <div className="flex gap-1 rounded-lg bg-stone-100 p-1 text-xs font-medium">
                  {(['STANDARD', 'LARGE'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setSample(s)} className={cx('rounded-md px-2.5 py-1', sample === s ? 'bg-white shadow-sm' : 'text-stone-500')}>{s === 'STANDARD' ? 'Kho thường' : 'Kho cỡ lớn'}</button>
                  ))}
                </div>
              } />
            <article className="max-h-[70vh] space-y-4 overflow-y-auto px-5 pb-5 text-sm leading-relaxed text-stone-700">
              <h3 className="text-center text-base font-bold uppercase tracking-wide text-ink">Hợp đồng thuê kho</h3>
              {preview.map((c, i) => (
                <section key={`${i}-${c.title}`} className={cx(draft[active] && c.title.endsWith(draft[active].title) && draft[active].title ? 'rounded-lg bg-amber-50/60 p-2 ring-1 ring-amber-200' : '')}>
                  <h4 className="font-semibold text-ink">{c.title}</h4>
                  {c.paragraphs.map((p, k) => <p key={k}>{p}</p>)}
                  {c.bullets.length > 0 && <ul className="list-disc space-y-0.5 pl-5">{c.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>}
                </section>
              ))}
            </article>
          </Card>

          <Card>
            <CardHeader title="Lịch sử phiên bản" actions={<History className="size-4 text-stone-400" />} />
            <Table rows={history} rowKey={(t) => t._id} empty={<p className="px-5 py-6 text-sm text-stone-500">Chưa phát hành mẫu nào cho phạm vi này — đang dùng {facilityId ? 'mẫu toàn chuỗi hoặc mẫu mặc định' : 'mẫu mặc định của hệ thống'}.</p>} columns={[
              { key: 'v', header: 'Bản', cell: (t) => <span className="font-medium">v{t.version}</span> },
              { key: 'e', header: 'Phát hành', cell: (t) => <div><p>{fmtDateTime(t.effectiveFrom)}</p><p className="text-xs text-stone-500">{t.createdBy ? userName(db, t.createdBy) : '—'}</p></div> },
              { key: 'n', header: 'Nội dung thay đổi', cell: (t) => t.note || <span className="text-stone-400">—</span> },
              { key: 's', header: '', className: 'text-right', cell: (t) => (
                <div className="flex items-center justify-end gap-2">
                  {t.isActive ? <Badge tone="green">Đang dùng</Badge> : <Badge>Cũ</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => { setDraft(t.clauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs], bullets: [...c.bullets] }))); focus.current = null; }}>Nạp vào nháp</Button>
                </div>
              ) },
            ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
