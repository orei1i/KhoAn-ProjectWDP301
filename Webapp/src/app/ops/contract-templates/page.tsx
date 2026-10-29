'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Braces, CircleAlert, CircleCheck, Eye, FileText, History, Info, List, ListOrdered, PenLine, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import type { ContractTemplate, ContractTemplateClause } from '@ssm/shared';
import { CONTRACT_VARIABLES, SAMPLE_CONTRACT_INPUTS, TEMPLATE_LIMITS, buildContractClauses, cloneDefaultClauses, validateContractTemplate } from '@ssm/shared';
import { api } from '@/shared/api/client';
import { useStore } from '@/shared/store/store';
import { userName } from '@/shared/lib/domain';
import { fmtDateTime } from '@/shared/lib/format';
import { Badge, Button, Card, EmptyState, Field, IconTile, InfoTip, PageHeader, Skeleton, Table, cx, inputCls } from '@/shared/ui';
import { Callout, Chip, Count, PanelHeader, Segmented } from '@/features/staff-ui';

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

  if (error) return <><PageHeader title="Mẫu hợp đồng" /><Callout tone="red" icon={<CircleAlert />} title="Không tải được mẫu hợp đồng">{error}</Callout></>;
  if (!effective || !draft) return <><PageHeader title="Mẫu hợp đồng" /><div className="grid gap-6 xl:grid-cols-2" role="status" aria-label="Đang tải…"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></>;

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
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
          {kind === 'paragraphs' ? <AlignLeft className="size-4 text-stone-400" aria-hidden /> : <List className="size-4 text-stone-400" aria-hidden />}
          {label}<Count n={clause[kind].length} /><InfoTip align="start">{hint}</InfoTip>
        </p>
        <Button size="sm" variant="ghost" disabled={clause[kind].length >= TEMPLATE_LIMITS.linesPerClause} onClick={() => addLine(kind)}><Plus className="size-3.5" />Thêm</Button>
      </div>
      <div className="mt-2 space-y-2">
        {clause[kind].length === 0 && <p className="rounded-lg border border-dashed border-stone-200 px-3 py-2 text-xs text-stone-400">Không có.</p>}
        {clause[kind].map((v, i) => (
          <div key={`${active}-${kind}-${i}`} className="flex gap-2">
            <span className="mt-2.5 grid size-5 shrink-0 place-items-center rounded-full bg-stone-100 text-[10px] font-semibold tabular-nums text-stone-500" aria-hidden>{i + 1}</span>
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
      <PageHeader title="Mẫu hợp đồng" description="Hợp đồng đã ký giữ nguyên văn lúc ký."
        actions={
          <select className={cx(inputCls, 'w-auto min-w-56')} aria-label="Phạm vi mẫu" value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setActive(0); }}>
            <option value="">Toàn chuỗi</option>
            {facilities.map((f) => <option key={f._id} value={f._id}>Riêng {f.name}</option>)}
          </select>
        } />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm shadow-card ring-1 ring-stone-200">
        <IconTile icon={<FileText className="size-4" />} size="sm" tone={effective.scope === 'DEFAULT' ? 'gray' : 'green'} />
        <span className="text-stone-500">Đang áp dụng:</span>
        {effective.scope === 'DEFAULT' ? <Badge>Mẫu mặc định của hệ thống</Badge> : <Badge tone="green" dot>v{effective.version} · {effective.scope === 'FACILITY' ? 'riêng chi nhánh' : 'toàn chuỗi'}</Badge>}
        {facilityId && effective.scope !== 'FACILITY' && <Chip icon={<Info />} tone="blue">Phát hành sẽ tạo mẫu riêng cho chi nhánh</Chip>}
        {dirty && <Badge tone="amber" dot>Có thay đổi chưa phát hành</Badge>}
        <span className="ml-auto">
          {errors.length > 0 ? <Chip icon={<CircleAlert />} tone="red">{errors.length} lỗi</Chip> : <Chip icon={<CircleCheck />} tone="green">Hợp lệ</Chip>}
        </span>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ---- soạn */}
        <div className="min-w-0 space-y-4">
          <Card>
            <PanelHeader icon={<ListOrdered className="size-4" />} title="Điều khoản" count={draft.length}
              tip="Không thêm / xoá / đổi thứ tự điều; các câu chứa số tiền và mức hoàn là biến khối do hệ thống soạn. Chấm vàng: điều đã sửa." />
            <div className="flex flex-wrap gap-1.5 p-4">
              {draft.map((c, i) => {
                const edited = !!effective.clauses[i] && !same([c], [effective.clauses[i]]);
                return (
                  <button key={c.key} type="button" onClick={() => { setActive(i); focus.current = null; }} aria-pressed={i === active}
                    className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors', i === active ? 'bg-ink text-white ring-ink' : 'text-stone-600 ring-stone-300 hover:bg-stone-50')}>
                    {edited && <span className="size-1.5 rounded-full bg-amber-500" aria-label="đã sửa" />}
                    {c.title || '(chưa đặt tên)'}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <PanelHeader icon={<PenLine className="size-4" />} title={clause.title || '(chưa đặt tên)'} />
            <div className="space-y-5 p-4 sm:p-5">
              <Field label="Tiêu đề điều khoản" tip={clause.numbered ? 'Số "Điều N" được đánh tự động.' : 'Phần mở đầu, không đánh số.'}>
                <input className={inputCls} maxLength={TEMPLATE_LIMITS.titleMax} value={clause.title} onChange={(e) => patch({ title: e.target.value })} onFocus={(e) => { focus.current = { kind: 'title', index: 0, el: e.currentTarget }; }} />
              </Field>
              {lines('paragraphs', 'Đoạn văn', 'In liền thành đoạn, không có gạch đầu dòng.')}
              {lines('bullets', 'Gạch đầu dòng', 'Mỗi ô là một gạch đầu dòng.')}
            </div>
          </Card>

          <Card>
            <PanelHeader icon={<Braces className="size-4" />} tone="violet" title="Biến điền sẵn" tip="Bấm để chèn vào đúng chỗ con trỏ của ô đang gõ. Biến có dấu * là bắt buộc." />
            <div className="space-y-4 p-4 sm:p-5">
              {(['VALUE', 'BLOCK'] as const).map((kind) => (
                <div key={kind}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{kind === 'VALUE' ? 'Biến giá trị' : 'Biến khối'}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CONTRACT_VARIABLES.filter((v) => v.kind === kind).map((v) => (
                      <button key={v.key} type="button" title={`${v.label}\nVí dụ: ${v.example}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.key)}
                        className={cx('rounded-md px-2 py-1 font-mono text-[11px] ring-1 ring-inset hover:bg-stone-50', kind === 'BLOCK' ? 'bg-violet-50/50 text-violet-800 ring-violet-200' : 'text-stone-700 ring-stone-300')}>
                        {`{{${v.key}}}`}{v.required && <span className="ml-0.5 font-sans font-semibold text-red-600">*</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <PanelHeader icon={<Send className="size-4" />} title="Phát hành" tip="Mẫu mới chỉ áp cho lần ký sau." />
            <div className="space-y-4 p-4 sm:p-5">
              {errors.length > 0 ? (
                <Callout tone="red" icon={<CircleAlert />} title={`Chưa phát hành được — còn ${errors.length} lỗi`}>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </Callout>
              ) : (
                <Callout tone="green" icon={<CircleCheck />} title="Mẫu hợp lệ: đủ điều khoản và đủ biến bắt buộc." />
              )}
              <Field label="Nội dung thay đổi (ghi vào lịch sử)"><input className={inputCls} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Làm rõ điều khoản hủy đặt chỗ" /></Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => { if (window.confirm('Nạp mẫu mặc định của hệ thống vào bản nháp? Các thay đổi chưa phát hành sẽ mất.')) { setDraft(cloneDefaultClauses()); focus.current = null; } }}><RotateCcw className="size-4" />Nạp mẫu mặc định</Button>
                {ownTemplate && <Button variant="ghost" onClick={() => { if (window.confirm('Bỏ mẫu riêng của chi nhánh này và dùng lại mẫu toàn chuỗi?')) void run('retireFacilityTemplate', { facilityId }, 'Chi nhánh đã dùng lại mẫu toàn chuỗi', () => setReload((x) => x + 1)); }}>Bỏ mẫu riêng</Button>}
                <Button variant="secondary" disabled={!dirty} onClick={() => setDraft(effective.clauses.map((c) => ({ ...c, paragraphs: [...c.paragraphs], bullets: [...c.bullets] })))}>Hoàn tác</Button>
                <Button disabled={!dirty || errors.length > 0} onClick={publish}><Send className="size-4" />Phát hành phiên bản mới</Button>
              </div>
            </div>
          </Card>
        </div>

        {/* ---- xem trước */}
        <div className="min-w-0 space-y-4">
          <Card className="xl:sticky xl:top-20">
            <PanelHeader icon={<Eye className="size-4" />} tone="blue" title="Xem trước" tip="Số liệu giả định. Điều đang sửa được tô vàng."
              action={
                <Segmented<Sample> label="Hợp đồng mẫu" value={sample} onChange={setSample}
                  options={[{ value: 'STANDARD', label: 'Kho thường' }, { value: 'LARGE', label: 'Kho cỡ lớn' }]} />
              } />
            <article className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5 text-sm leading-relaxed text-stone-700">
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
            <PanelHeader icon={<History className="size-4" />} tone="gray" title="Lịch sử phiên bản" count={history.length} />
            <Table rows={history} rowKey={(t) => t._id}
              empty={<EmptyState compact icon={<History className="size-5" />} title="Chưa phát hành mẫu nào cho phạm vi này" description={`Đang dùng ${facilityId ? 'mẫu toàn chuỗi hoặc mẫu mặc định' : 'mẫu mặc định của hệ thống'}.`} />}
              columns={[
                { key: 'v', header: 'Bản', cell: (t) => <span className="font-semibold">v{t.version}</span> },
                { key: 'e', header: 'Phát hành', cell: (t) => <div><p className="whitespace-nowrap">{fmtDateTime(t.effectiveFrom)}</p><p className="text-xs text-stone-500">{t.createdBy ? userName(db, t.createdBy) : '—'}</p></div> },
                { key: 'n', header: 'Nội dung thay đổi', cell: (t) => t.note || <span className="text-stone-400">—</span> },
                { key: 's', header: '', className: 'text-right', cell: (t) => (
                  <div className="flex items-center justify-end gap-2">
                    {t.isActive ? <Badge tone="green" dot>Đang dùng</Badge> : <Badge>Cũ</Badge>}
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
