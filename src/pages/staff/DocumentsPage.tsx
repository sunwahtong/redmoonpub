import React, {useMemo, useState} from 'react';
import {Eye, FileDown, FileText, ReceiptText, Trash2, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Select} from '../../components/ui/Select';
import {Badge, Chips, Field, PageHeader, Panel, SearchField} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatDate, formatHuf, formatTime} from '../../lib/api';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';
import {playSfx} from '../../lib/sfx';
import {
  DOCUMENT_DESCRIPTION,
  DOCUMENT_LABEL,
  renderDocumentHtml,
  serial,
  type DocumentContext,
  type DocumentKind,
  type DocumentPayload
} from '../../lib/documents';
import {downloadDocumentPdf} from '../../lib/documentPdf';
import {
  buildInventory,
  buildOrderAudit,
  buildPayroll,
  buildShiftReport,
  buildStoredDocument,
  buildTransactions,
  DOCUMENT_REQUIREMENTS,
  PERIOD_LABEL,
  type Period,
  type SaleRow,
  type ShiftRow,
  type StockRow,
  type StoredDocument
} from '../../lib/documentBuilders';
import type {SupplyOrder} from '../../lib/orders';

const KINDS: DocumentKind[] = ['transactions', 'shift-report', 'payroll', 'order-audit', 'inventory'];
const PERIODS: Period[] = ['today', 'week', 'month', 'all'];

/** Kanji mark per document type, matching the card treatment elsewhere. */
const KIND_GLYPH: Record<DocumentKind, string> = {
  transactions: '取',
  'shift-report': '番',
  payroll: '給',
  'order-audit': '査',
  inventory: '庫',
  receipt: '票',
  invoice: '請'
};

const TYPE_LABEL: Record<string, string> = {receipt: 'NYUGTA', invoice: 'SZÁMLA'};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const DocumentsPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isOwner = roleAtLeast(user?.role, 'owner');

  const {data: context} = useLiveData<DocumentContext>('/api/documents/context', {intervalMs: 0});
  const {data, refresh} = useLiveData<{documents: StoredDocument[]}>('/api/documents', {intervalMs: 30000});
  const {data: saleData} = useLiveData<{sales: SaleRow[]}>('/api/sales', {intervalMs: 0});
  const {data: shiftData} = useLiveData<{shifts: ShiftRow[]}>('/api/shifts', {intervalMs: 0});
  const {data: orderData} = useLiveData<{orders: SupplyOrder[]}>('/api/orders', {intervalMs: 0});
  const {data: storageData} = useLiveData<{products: StockRow[]}>('/api/analytics/storage', {intervalMs: 0});

  const [kind, setKind] = useState<DocumentKind>('transactions');
  const [period, setPeriod] = useState<Period>('week');
  const [shiftId, setShiftId] = useState('');
  const [preview, setPreview] = useState<{html: string; payload: DocumentPayload; reference: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const sales = useMemo(() => saleData?.sales || [], [saleData]);
  const shifts = useMemo(() => shiftData?.shifts || [], [shiftData]);
  const orders = useMemo(() => orderData?.orders || [], [orderData]);
  const stock = useMemo(() => storageData?.products || [], [storageData]);
  const closedShifts = useMemo(() => shifts.filter((shift) => shift.status === 'closed'), [shifts]);

  /** How many records the chosen document would actually print. */
  const available = useMemo(() => {
    switch (kind) {
      case 'transactions':
        return sales.length;
      case 'shift-report':
      case 'payroll':
        return closedShifts.length;
      case 'order-audit':
        return orders.filter((order) => order.status === 'completed').length;
      case 'inventory':
        return stock.length;
      default:
        return 0;
    }
  }, [kind, sales, closedShifts, orders, stock]);

  const buildCurrent = (): DocumentPayload | null => {
    if (kind === 'shift-report') {
      const shift = closedShifts.find((entry) => entry.id === shiftId) || closedShifts[0];
      if (!shift) {
        toast.error('Nincs lezárt műszak', 'Zárj le egy műszakot, mielőtt jegyzőkönyvet készítesz.');
        return null;
      }
      return buildShiftReport(shift);
    }
    if (kind === 'transactions') return buildTransactions(sales, period);
    if (kind === 'payroll') return buildPayroll(closedShifts, period, context?.house.hourlyWage || 0);
    if (kind === 'order-audit') return buildOrderAudit(orders, period);
    return buildInventory(stock);
  };

  const referenceFor = (payload: DocumentPayload) => payload.reference || serial(payload.kind, context?.house.registration || 'RM');

  const download = async (payload: DocumentPayload | null) => {
    if (!payload || !context || busy) return;
    setBusy(true);
    try {
      const reference = referenceFor(payload);
      await downloadDocumentPdf(payload, context, reference);
      toast.success('PDF elmentve', `${DOCUMENT_LABEL[payload.kind]} · ${reference}`);
      playSfx('success');
    } catch (err) {
      toast.error('A PDF nem készült el', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const openPreview = (payload: DocumentPayload | null) => {
    if (!payload || !context) return;
    const reference = referenceFor(payload);
    setPreview({html: renderDocumentHtml(payload, context, reference), payload, reference});
    playSfx('open');
  };

  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | 'receipt' | 'invoice'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const documents = useMemo(() => data?.documents || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return documents.filter((document) => {
      if (type !== 'all' && document.type !== type) return false;
      if (!needle) return true;
      return normalize(`${document.id} ${document.createdByName} ${document.shiftId} ${document.customer?.name || ''}`).includes(needle);
    });
  }, [documents, query, type]);

  const open = visible.find((document) => document.id === openId) || null;

  const remove = async (document: StoredDocument) => {
    const sure = await dialog.confirm({
      title: `Törlöd: ${document.id}?`,
      message: document.type === 'invoice' ? 'A számla végleg törlődik. Az eladás megmarad, később új számla kérhető.' : 'A nyugta végleg törlődik. Az eladás megmarad.',
      confirmLabel: 'TÖRLÉS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend(`/api/documents/${encodeURIComponent(document.id)}`, 'DELETE');
      toast.success('Bizonylat törölve');
      playSfx('delete');
      setOpenId(null);
      refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    }
  };

  const shiftOptions = closedShifts.map((shift) => ({
    value: shift.id,
    label: `${shift.id} · ${formatDate(shift.startedAt)}`,
    description: `${formatHuf(Number(shift.revenue) || 0)} · ${shift.closedByName || shift.startedByName || ''}`
  }));

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / BIZONYLATOK"
          title={
            <>
              Nyugták és <em>kimutatások.</em>
            </>
          }
          lead="A ház kiállított bizonylatai, és a hivatalos kimutatások, amelyeket innen készítesz. Minden dokumentum a ház fejlécével és a kiállító aláírásával, PDF-ben, a saját gépedre kerül."
        />

        {/* ------------------------------------------------ GENERATOR */}
        <Panel tone="red" className="mb-14 md:!p-10">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <span className="rm-label">DOKUMENTUM KÉSZÍTÉSE</span>
              <h2 className="mt-2 font-heading text-[26px] leading-none text-white">Hivatalos kimutatás.</h2>
              <p className="mt-3 max-w-lg text-[11px] leading-[1.8] text-[#8d8584]">
                Válaszd ki a típust és az időszakot. Az előnézetben megnézed, a letöltéssel elmented — a fájl nem nyomtatható,
                a ház belső irata marad.
              </p>
            </div>
            <div className="text-right text-[10px] leading-[1.8] text-[#6f6968]">
              <strong className="block font-heading text-[14px] text-white">{context?.house.name || 'Red Moon Pub'}</strong>
              {context?.house.address}
              <br/>
              {context?.house.registration ? `Nyilvántartási szám: ${context.house.registration}` : ''}
            </div>
          </div>

          <div className="rm-gilt my-8"/>

          <span className="text-[8px] tracking-[0.25em] text-[#777]">TÍPUS</span>
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className={`group relative overflow-hidden border p-5 text-left transition-all ${
                  kind === option ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.08)]' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <span className="pointer-events-none absolute -right-2 -top-3 font-heading text-[54px] leading-none text-[rgba(227,40,78,0.13)] transition-transform duration-500 group-hover:scale-110" aria-hidden="true">
                  {KIND_GLYPH[option]}
                </span>
                <span className="relative block text-[10px] font-bold tracking-[0.14em] text-white">{DOCUMENT_LABEL[option]}</span>
                <span className="relative mt-2 block text-[10px] leading-[1.6] text-[#8d8584]">{DOCUMENT_DESCRIPTION[option]}</span>
              </button>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap items-end gap-6">
            {kind === 'shift-report' ? (
              <Field label="MŰSZAK" className="min-w-[280px] flex-1">
                <Select value={shiftId || closedShifts[0]?.id || ''} options={shiftOptions} placeholder="Nincs lezárt műszak" onChange={setShiftId} searchable/>
              </Field>
            ) : kind === 'inventory' ? (
              <p className="text-[10px] text-[#8d8584]">A készletjegyzék mindig az aktuális állapotot tartalmazza, időszak nélkül.</p>
            ) : (
              <div>
                <span className="text-[8px] tracking-[0.25em] text-[#777]">IDŐSZAK</span>
                <Chips className="mt-3" value={period} onChange={setPeriod} options={PERIODS.map((option) => ({id: option, label: PERIOD_LABEL[option].toUpperCase()}))}/>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.06] pt-6">
            <div className="flex items-center gap-4">
              {context?.issuer.signatureSvg && (
                <div className="hidden w-32 sm:block">
                  <div className="rm-signature-card !p-1" dangerouslySetInnerHTML={{__html: context.issuer.signatureSvg}}/>
                </div>
              )}
              <div className="text-[10px] leading-[1.7] text-[#8d8584]">
                Kiállító: <b className="text-white">{context?.issuer.name || user?.name}</b> · {context?.issuer.title}
                {context?.owner && (
                  <>
                    <br/>
                    Ellenjegyzi: <b className="text-white">{context.owner.name}</b>
                  </>
                )}
                <br/>
                <span className="text-[#6f6968]">
                  {available ? `${available} ${DOCUMENT_REQUIREMENTS[kind]} érhető el` : `Nincs ${DOCUMENT_REQUIREMENTS[kind]} a rendszerben`}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Btn onClick={() => openPreview(buildCurrent())} disabled={!available || !context}>
                <Eye size={13}/> ELŐNÉZET
              </Btn>
              <Btn variant="red" onClick={() => download(buildCurrent())} disabled={!available || !context || busy}>
                <FileDown size={13}/> {busy ? 'KÉSZÜL…' : 'PDF LETÖLTÉSE'}
              </Btn>
            </div>
          </div>
        </Panel>

        {/* ------------------------------------------------ STORED DOCUMENTS */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchField value={query} onChange={setQuery} placeholder="AZONOSÍTÓ, KIÁLLÍTÓ, VEVŐ VAGY MŰSZAK…" className="sm:max-w-xs"/>
          <Chips
            value={type}
            onChange={setType}
            options={[
              {id: 'all', label: 'ÖSSZES', count: documents.length},
              {id: 'receipt', label: 'NYUGTA', count: documents.filter((document) => document.type === 'receipt').length},
              {id: 'invoice', label: 'SZÁMLA', count: documents.filter((document) => document.type === 'invoice').length}
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
          <Panel padded={false} label={`BIZONYLATOK (${visible.length})`} className="lg:col-span-2">
            {!visible.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs bizonylat. Nyugta a kasszában, eladás után készül.</p>}
            <div className="max-h-[560px] overflow-y-auto">
              {visible.map((document) => (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => setOpenId(document.id)}
                  className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-6 py-3 text-left transition-colors hover:bg-white/[0.02] ${openId === document.id ? 'bg-[rgba(213,31,60,0.08)]' : ''}`}
                >
                  {document.type === 'invoice' ? <FileText size={13} className="shrink-0 text-[color:var(--rm-red)]"/> : <ReceiptText size={13} className="shrink-0 text-[#777]"/>}
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[11px] text-white">{document.id}</strong>
                    <span className="text-[9px] text-[#777]">
                      {formatDate(document.createdAt)} {formatTime(document.createdAt)} · {document.createdByName}
                      {document.type === 'invoice' && document.customer?.name ? ` · ${document.customer.name}` : ''}
                    </span>
                  </div>
                  <span className="shrink-0 font-heading text-[14px] text-[color:var(--rm-red)]">{formatHuf(document.total)}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel label="RÉSZLETEK" className="h-fit">
            {!open ? (
              <p className="text-[11px] text-[#8d8584]">Válassz egy bizonylatot a listából.</p>
            ) : (
              <>
                <h2 className="mb-1 font-heading text-[20px] text-white">{open.id}</h2>
                <Badge tone={open.type === 'invoice' ? 'red' : 'muted'}>{TYPE_LABEL[open.type] || open.type}</Badge>

                <div className="mt-5 flex flex-col gap-1.5">
                  {open.items.map((item, index) => (
                    <div key={`${item.product}-${index}`} className="flex justify-between text-[10px]">
                      <span className="truncate pr-2 text-white">
                        {item.qty} × {item.product}
                      </span>
                      <span className="shrink-0 text-[#8d8584]">{formatHuf(item.total)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
                  <span className="text-[9px] tracking-[0.2em] text-[#777]">VÉGÖSSZEG</span>
                  <strong className="font-heading text-[20px] text-white">{formatHuf(open.total)}</strong>
                </div>

                <dl className="mt-4 flex flex-col gap-1.5 text-[10px] text-[#8d8584]">
                  <div className="flex justify-between">
                    <dt>Fizetés</dt>
                    <dd className="text-white">{open.paymentMethod === 'cash' ? 'Készpénz' : 'Átutalás'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Műszak</dt>
                    <dd className="text-white">{open.shiftId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Kiállította</dt>
                    <dd className="text-white">{open.createdByName}</dd>
                  </div>
                  {open.type === 'invoice' && (
                    <div className="flex justify-between">
                      <dt>Vevő</dt>
                      <dd className="text-right text-white">{open.customer?.name || 'Vásárló'}</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-6 flex flex-col gap-2">
                  <Btn variant="red" onClick={() => download(buildStoredDocument(open))} disabled={busy || !context} className="w-full justify-center">
                    <FileDown size={13}/> PDF LETÖLTÉSE
                  </Btn>
                  <Btn onClick={() => openPreview(buildStoredDocument(open))} disabled={!context} className="w-full justify-center">
                    <Eye size={13}/> ELŐNÉZET
                  </Btn>
                  {(open.type === 'receipt' || isOwner) && (
                    <button type="button" onClick={() => remove(open)} className="mt-2 inline-flex items-center justify-center gap-2 text-[9px] tracking-[0.18em] text-[#777] hover:text-[color:var(--rm-red)]">
                      <Trash2 size={11}/> TÖRLÉS
                    </button>
                  )}
                </div>
              </>
            )}
          </Panel>
        </div>
      </section>

      {/* ------------------------------------------------ PREVIEW */}
      {preview && (
        <div className="fixed inset-0 z-[1500] flex flex-col bg-black/85 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4 border-b border-[color:var(--rm-line)] bg-[#09090b] px-5 py-3">
            <div className="min-w-0">
              <span className="rm-label">ELŐNÉZET</span>
              <h3 className="truncate font-heading text-[16px] text-white">
                {DOCUMENT_LABEL[preview.payload.kind]} · {preview.reference}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="red" onClick={() => download(preview.payload)} disabled={busy}>
                <FileDown size={13}/> PDF LETÖLTÉSE
              </Btn>
              <button type="button" onClick={() => setPreview(null)} aria-label="Bezárás" className="p-2 text-[#8f8887] hover:text-white">
                <X size={18}/>
              </button>
            </div>
          </div>
          <iframe title="Dokumentum előnézet" srcDoc={preview.html} sandbox="" className="h-full w-full flex-1 border-0 bg-[#e9e6e1]"/>
        </div>
      )}
    </main>
  );
};
