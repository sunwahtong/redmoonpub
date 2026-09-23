import {assetUrl} from './api';
import type {Business, Person} from './house';

/**
 * Document model.
 *
 * A document is a small, layout-free description: a kind, a period, columns,
 * rows, a summary and notes. Two renderers read it — `renderDocumentHtml`
 * for the in-app preview and `documentPdf.ts` for the file the operator
 * saves. Neither knows anything about the business; the builders do.
 */

export type DocumentKind =
  | 'transactions'
  | 'shift-report'
  | 'payroll'
  | 'order-audit'
  | 'inventory'
  | 'receipt'
  | 'invoice';

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  transactions: 'Tranzakciós kimutatás',
  'shift-report': 'Műszakzárási jegyzőkönyv',
  payroll: 'Munkaidő-kimutatás',
  'order-audit': 'Beszerzési audit',
  inventory: 'Készletjegyzék',
  receipt: 'Nyugta',
  invoice: 'Számla'
};

export const DOCUMENT_DESCRIPTION: Record<DocumentKind, string> = {
  transactions: 'Tételes eladási lista a választott időszakra, fizetési mód szerinti bontással.',
  'shift-report': 'Egy műszak nyitó és záró kasszája, bevétele és a műszakban dolgozók.',
  payroll: 'Ledolgozott órák, műszakok és hozott bevétel dolgozónként, a választott időszakra.',
  'order-audit': 'Beszerzések becsült és tényleges értéke, az eltérésekkel és a felelősökkel.',
  inventory: 'Aktuális készlet, minimumszint és becsült kifutási idő tételenként.',
  receipt: 'A kasszában rögzített eladás nyugtája.',
  invoice: 'Vevő nevére kiállított számla egy eladásról.'
};

const PREFIX: Record<DocumentKind, string> = {
  transactions: 'TRX',
  'shift-report': 'MSZ',
  payroll: 'MID',
  'order-audit': 'BSZ',
  inventory: 'KSZ',
  receipt: 'REC',
  invoice: 'INV'
};

export interface DocumentColumn {
  key: string;
  label: string;
  /** Right-aligned and tabular. Use for anything countable. */
  numeric?: boolean;
}

export interface DocumentSummaryEntry {
  label: string;
  value: string;
  /** Rendered heavier — the one number the reader is looking for. */
  strong?: boolean;
}

export interface DocumentPayload {
  kind: DocumentKind;
  /** Human period, e.g. "2026. szeptember 22." or "2026. 38. hét". */
  period: string;
  columns: DocumentColumn[];
  rows: Record<string, string | number>[];
  summary: DocumentSummaryEntry[];
  /** Optional paragraph printed above the table. */
  preamble?: string;
  /** Optional lines printed under the table, before the signature block. */
  notes?: string[];
  /** Fixed reference for stored documents (receipts, invoices). */
  reference?: string;
  /** Optional two-column block of particulars under the title (customer, seller). */
  parties?: {label: string; lines: string[]}[];
  /** Whether the owner's countersignature belongs on it. Receipts carry only the issuer. */
  countersign?: boolean;
}

export interface Issuer extends Person {
  role: string;
}

/** Everything a rendered document needs besides its own data. */
export interface DocumentContext {
  house: Business;
  issuer: Issuer;
  owner: Person | null;
}

/**
 * Fetches each signer's stored signature so a document can embed it: SVG
 * text for a drawn or generated one, a data URL for an uploaded picture. A
 * signature that cannot be fetched simply leaves its line empty.
 */
export async function resolveSignatures(context: DocumentContext): Promise<DocumentContext> {
  const load = async <T extends Person | null>(person: T): Promise<T> => {
    if (!person || !person.signatureUrl || person.signatureSvg || person.signatureImage) return person;
    try {
      const response = await fetch(assetUrl(person.signatureUrl));
      if (!response.ok) return person;
      if ((response.headers.get('content-type') || '').includes('svg')) return {...person, signatureSvg: await response.text()};
      const blob = await response.blob();
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return {...person, signatureImage: image};
    } catch {
      return person;
    }
  };
  return {...context, issuer: await load(context.issuer), owner: await load(context.owner)};
}

/** Serial number for an issued copy, so two copies are distinguishable. */
export function serial(kind: DocumentKind, registration: string): string {
  const now = new Date();
  const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${registration || 'RM'}/${PREFIX[kind]}-${stamp}-${suffix}`;
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character] as string);

const formatter = new Intl.DateTimeFormat('hu-HU', {year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'});

export const issuedStamp = (): string => formatter.format(new Date());

/** The file name a saved document gets. */
export function documentFileName(payload: DocumentPayload, reference: string): string {
  const base = `${DOCUMENT_LABEL[payload.kind]}-${reference}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '_');
  return `${base}.pdf`;
}

/**
 * Renders the preview: white paper, black ink, the house mark in red.
 *
 * This is a look, not a print job. The sheet is shown inside a sandboxed
 * frame in the console; printing from it is disabled by the stylesheet, and
 * the toolbar's only action is saving the PDF.
 */
export function renderDocumentHtml(payload: DocumentPayload, context: DocumentContext, reference: string): string {
  const {house, issuer, owner} = context;
  const head = payload.columns.map((column) => `<th${column.numeric ? ' class="num"' : ''}>${escapeHtml(column.label)}</th>`).join('');
  const body = payload.rows.length
    ? payload.rows
        .map((row) => `<tr>${payload.columns.map((column) => `<td${column.numeric ? ' class="num"' : ''}>${escapeHtml(row[column.key])}</td>`).join('')}</tr>`)
        .join('')
    : `<tr><td class="empty" colspan="${payload.columns.length}">Az időszakra nem esik adat.</td></tr>`;
  const summary = payload.summary
    .map((entry) => `<div class="sum-row${entry.strong ? ' strong' : ''}"><span>${escapeHtml(entry.label)}</span><b>${escapeHtml(entry.value)}</b></div>`)
    .join('');
  const notes = (payload.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join('');
  const parties = (payload.parties || [])
    .map((party) => `<div class="party"><span>${escapeHtml(party.label)}</span>${party.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`)
    .join('');

  const signatureBlock = (person: Person | null, fallbackTitle: string) =>
    person
      ? `<div class="sig-block">
      <div class="sig">${person.signatureSvg || (person.signatureImage ? `<img src="${person.signatureImage}" alt=""/>` : '<div class="sig-empty">— aláírás nélkül —</div>')}</div>
      <div class="sig-line">
        <div class="sig-name">${escapeHtml(person.name)}</div>
        <div class="sig-meta">${escapeHtml(person.title || fallbackTitle)}${person.idNumber ? ` · Azonosító: ${escapeHtml(person.idNumber)}` : ''}</div>
        ${person.phone ? `<div class="sig-meta">${escapeHtml(person.phone)}</div>` : ''}
      </div>
    </div>`
      : '';

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>${escapeHtml(DOCUMENT_LABEL[payload.kind])} — ${escapeHtml(reference)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; font-size: 11px; line-height: 1.65; color: #16161d; background: #e9e6e1; }
  .sheet { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 18mm 16mm; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.25); }
  header.letterhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #8a0c24; }
  .mark { font-family: Georgia, "Times New Roman", serif; }
  .mark .name { font-size: 25px; letter-spacing: .06em; color: #8a0c24; }
  .mark .lines { margin-top: 9px; font-size: 10px; color: #3d3d47; }
  .meta { text-align: right; font-size: 10px; color: #3d3d47; min-width: 190px; }
  .meta .ref { font-family: Consolas, monospace; font-size: 11px; color: #16161d; }
  h1 { font-family: Georgia, serif; font-size: 19px; margin: 26px 0 2px; letter-spacing: .01em; }
  .period { font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #6a6a74; }
  .preamble { margin-top: 14px; font-size: 10.5px; color: #3d3d47; }
  .parties { display: flex; gap: 32px; margin-top: 16px; }
  .party { flex: 1; font-size: 10.5px; color: #3d3d47; }
  .party span { display: block; font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; color: #6a6a74; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #e2e2e8; text-align: left; vertical-align: top; }
  th { font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; color: #6a6a74; border-bottom: 1px solid #16161d; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.empty { text-align: center; color: #8a8a94; padding: 22px 8px; }
  tbody tr:nth-child(even) { background: #fafafc; }
  .summary { margin-top: 20px; margin-left: auto; width: 62mm; }
  .sum-row { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; border-bottom: 1px solid #ececf1; }
  .sum-row.strong { border-top: 1px solid #16161d; border-bottom: none; margin-top: 4px; padding-top: 8px; font-size: 13px; }
  .sum-row.strong b { color: #8a0c24; }
  .notes { margin-top: 22px; font-size: 10px; color: #3d3d47; }
  .notes ul { margin: 6px 0 0; padding-left: 16px; }
  .signatures { margin-top: 30px; display: flex; justify-content: space-between; gap: 40px; }
  .sig-block { flex: 1; max-width: 78mm; }
  .sig svg, .sig img { display: block; width: 100%; height: auto; max-height: 70px; object-fit: contain; object-position: left bottom; }
  .sig-empty { height: 60px; display: flex; align-items: flex-end; font-size: 9px; color: #8a8a94; }
  .sig-line { border-top: 1px solid #16161d; padding-top: 6px; margin-top: -4px; }
  .sig-name { font-size: 11.5px; font-weight: 600; }
  .sig-meta { font-size: 9.5px; color: #6a6a74; }
  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e2e8; font-size: 8.5px; color: #8a8a94; display: flex; justify-content: space-between; gap: 20px; }
  @media print { body { display: none !important; } }
</style>
</head>
<body>
<div class="sheet">
  <header class="letterhead">
    <div class="mark">
      <div class="name">${escapeHtml(house.name)}</div>
      <div class="lines">
        ${escapeHtml(house.address)}<br>
        ${escapeHtml(house.phone)}${house.registration ? ` · Nyilvántartási szám: ${escapeHtml(house.registration)}` : ''}
      </div>
    </div>
    <div class="meta">
      <div class="ref">${escapeHtml(reference)}</div>
      <div>Kiállítva: ${escapeHtml(issuedStamp())}</div>
      <div>Kiállító: ${escapeHtml(issuer.name)}</div>
    </div>
  </header>

  <h1>${escapeHtml(DOCUMENT_LABEL[payload.kind])}</h1>
  <div class="period">${escapeHtml(payload.period)}</div>
  ${payload.preamble ? `<p class="preamble">${escapeHtml(payload.preamble)}</p>` : ''}
  ${parties ? `<div class="parties">${parties}</div>` : ''}

  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>

  <div class="summary">${summary}</div>

  ${notes ? `<div class="notes"><b>Megjegyzések</b><ul>${notes}</ul></div>` : ''}

  <div class="signatures">
    ${signatureBlock(issuer, issuer.role === 'owner' ? 'Tulajdonos' : 'Manager')}
    ${payload.countersign === false ? '' : signatureBlock(owner, 'Tulajdonos')}
  </div>

  <footer>
    <span>${escapeHtml(house.name)} · belső használatra</span>
    <span>A dokumentum a kiállítás pillanatának adataival készült.</span>
  </footer>
</div>
</body>
</html>`;
}
