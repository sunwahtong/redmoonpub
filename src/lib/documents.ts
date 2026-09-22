import {HOUSE, PLACEHOLDER_ISSUER, ROLE_TITLE, type Person} from './house';

/**
 * Document engine.
 *
 * Builds a self-contained, print-ready document and hands it to the browser's
 * print dialog, where "Save as PDF" is the default destination on every
 * platform we care about.
 *
 * Why not a PDF library: a client-side one (jsPDF, pdfmake) adds ~300 kB to a
 * bundle already flagged as large, and forces every layout to be written as
 * absolute coordinates instead of CSS. A server-side one needs a headless
 * browser on the host, which the Vercel deployment cannot have. Printing an
 * HTML document costs nothing, renders identically, and is already the pattern
 * this codebase used for receipts.
 *
 * The trade-off, stated plainly: the visitor picks the destination in the print
 * dialog, so this is "print or save as PDF", not a silent download. If a true
 * one-click download is required later, the same `renderDocument` output can be
 * posted to a server-side renderer without touching any of the builders.
 */

export type DocumentKind =
  | 'transactions'
  | 'shift-report'
  | 'payroll'
  | 'order-audit'
  | 'inventory';

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  transactions: 'Tranzakciós kimutatás',
  'shift-report': 'Műszakzárási jegyzőkönyv',
  payroll: 'Bérelszámolási ív',
  'order-audit': 'Beszerzési audit',
  inventory: 'Készletjegyzék'
};

export const DOCUMENT_DESCRIPTION: Record<DocumentKind, string> = {
  transactions: 'Tételes eladási lista a választott időszakra, fizetési mód szerinti bontással.',
  'shift-report': 'Egy műszak nyitó és záró kasszája, bevétele és a műszakban dolgozók.',
  payroll: 'Ledolgozott órák és a kifizetendő bér dolgozónként, a választott időszakra.',
  'order-audit': 'Beszerzések becsült és tényleges értéke, az eltérésekkel és a felelősökkel.',
  inventory: 'Aktuális készlet, minimumszint és becsült kifutási idő tételenként.'
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
}

export interface Issuer extends Person {
  role: string;
}

/** Serial number for the issued copy, so two prints are distinguishable. */
function serial(kind: DocumentKind): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const prefix: Record<DocumentKind, string> = {
    transactions: 'TRX',
    'shift-report': 'MSZ',
    payroll: 'BER',
    'order-audit': 'BSZ',
    inventory: 'KSZ'
  };
  return `${HOUSE.registration}/${prefix[kind]}-${stamp}-${suffix}`;
}

/**
 * Builds the issuer block from the signed-in account.
 *
 * The login knows a name, a rank and a filed phone number; it does not know an
 * identity card number, because the house never asked for one. Until it does,
 * the placeholder supplies that one field and the document says so in the
 * footer rather than printing an invented number silently.
 */
export function issuerFromUser(user: {name?: string; role?: string; phone?: string} | null): Issuer {
  return {
    name: user?.name || PLACEHOLDER_ISSUER.name,
    idNumber: PLACEHOLDER_ISSUER.idNumber,
    phone: user?.phone || PLACEHOLDER_ISSUER.phone,
    title: ROLE_TITLE[user?.role || 'manager'] || PLACEHOLDER_ISSUER.title,
    role: user?.role || 'manager'
  };
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character] as string
  );

/**
 * Draws a signature from a name.
 *
 * Deterministic: the same name always produces the same stroke, so two copies
 * of the same document carry the same mark. Seeded from the name's characters
 * rather than a random source for exactly that reason.
 *
 * This is a visual mark on an internal document, not a legal autograph, and the
 * footer says as much.
 */
export function signaturePath(name: string, width = 260, height = 70): string {
  let seed = 0;
  for (let i = 0; i < name.length; i += 1) seed = (seed * 31 + name.charCodeAt(i)) >>> 0;

  const random = () => {
    // xorshift: cheap, repeatable, and good enough to vary a curve.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0xffffffff;
  };

  const points = Math.max(5, Math.min(9, name.replace(/\s/g, '').length));
  const step = (width - 30) / points;
  const midline = height * 0.62;

  let path = `M 14 ${midline.toFixed(1)}`;
  for (let i = 0; i < points; i += 1) {
    const x = 14 + step * (i + 1);
    const peak = midline - (0.25 + random() * 0.7) * (height * 0.5);
    const dip = midline + (random() * 0.3) * (height * 0.35);
    const controlX = x - step * 0.5;
    path += ` C ${(controlX - step * 0.25).toFixed(1)} ${peak.toFixed(1)},`;
    path += ` ${(controlX + step * 0.25).toFixed(1)} ${dip.toFixed(1)},`;
    path += ` ${x.toFixed(1)} ${(midline - random() * 6).toFixed(1)}`;
  }
  // Closing flourish, the way a hand runs off the end of a name.
  path += ` c ${(step * 0.6).toFixed(1)} ${(-height * 0.3).toFixed(1)} ${(step * 0.2).toFixed(1)} ${(height * 0.35).toFixed(1)} ${(-step * 0.9).toFixed(1)} ${(height * 0.1).toFixed(1)}`;
  return path;
}

function signatureSvg(name: string): string {
  return `<svg class="sig" viewBox="0 0 260 70" width="260" height="70" role="img" aria-label="${escapeHtml(name)} aláírása">
    <path d="${signaturePath(name)}" fill="none" stroke="#12121a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const formatter = new Intl.DateTimeFormat('hu-HU', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

/**
 * Renders the finished document as a standalone HTML page.
 *
 * Printed on white with black text on purpose: the site's identity is a dark
 * room, but a document is read on paper and in a file, and a near-black page
 * either drains a cartridge or prints as an unreadable grey slab. The house
 * mark keeps the red.
 */
export function renderDocument(payload: DocumentPayload, issuer: Issuer): string {
  const issuedAt = formatter.format(new Date());
  const reference = serial(payload.kind);

  const head = payload.columns
    .map((column) => `<th${column.numeric ? ' class="num"' : ''}>${escapeHtml(column.label)}</th>`)
    .join('');

  const body = payload.rows.length
    ? payload.rows
        .map(
          (row) =>
            `<tr>${payload.columns
              .map((column) => `<td${column.numeric ? ' class="num"' : ''}>${escapeHtml(row[column.key])}</td>`)
              .join('')}</tr>`
        )
        .join('')
    : `<tr><td class="empty" colspan="${payload.columns.length}">Az időszakra nem esik adat.</td></tr>`;

  const summary = payload.summary
    .map(
      (entry) =>
        `<div class="sum-row${entry.strong ? ' strong' : ''}"><span>${escapeHtml(entry.label)}</span><b>${escapeHtml(entry.value)}</b></div>`
    )
    .join('');

  const notes = (payload.notes || []).map((note) => `<li>${escapeHtml(note)}</li>`).join('');

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>${escapeHtml(DOCUMENT_LABEL[payload.kind])} — ${escapeHtml(reference)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 11px;
    line-height: 1.65;
    color: #16161d;
    background: #fff;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }

  header.letterhead {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
    padding-bottom: 14px; border-bottom: 2px solid #8a0c24;
  }
  .mark { font-family: Georgia, "Times New Roman", serif; }
  .mark .name { font-size: 25px; letter-spacing: .06em; color: #8a0c24; }
  .mark .parent { font-size: 9px; letter-spacing: .32em; color: #6a6a74; text-transform: uppercase; margin-top: 3px; }
  .mark .lines { margin-top: 9px; font-size: 10px; color: #3d3d47; }
  .meta { text-align: right; font-size: 10px; color: #3d3d47; min-width: 190px; }
  .meta .ref { font-family: "Consolas", monospace; font-size: 11px; color: #16161d; }

  h1 { font-family: Georgia, serif; font-size: 19px; margin: 26px 0 2px; letter-spacing: .01em; }
  .period { font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: #6a6a74; }
  .preamble { margin-top: 14px; font-size: 10.5px; color: #3d3d47; }

  table { width: 100%; border-collapse: collapse; margin-top: 18px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #e2e2e8; text-align: left; vertical-align: top; }
  th {
    font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase;
    color: #6a6a74; border-bottom: 1px solid #16161d; white-space: nowrap;
  }
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
  .sig { display: block; }
  .sig-line { border-top: 1px solid #16161d; padding-top: 6px; margin-top: -6px; }
  .sig-name { font-size: 11.5px; font-weight: 600; }
  .sig-meta { font-size: 9.5px; color: #6a6a74; }

  footer {
    margin-top: 26px; padding-top: 10px; border-top: 1px solid #e2e2e8;
    font-size: 8.5px; color: #8a8a94; display: flex; justify-content: space-between; gap: 20px;
  }

  /* Anything with this class exists only to be clicked, never printed. */
  @media print { .no-print { display: none !important; } }
  /* Bottom right, not top right: the top right corner is the letterhead's
     reference block, and the toolbar covered it. */
  .no-print {
    position: fixed; right: 18px; bottom: 18px; display: flex; gap: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
  }
  .no-print button {
    font: inherit; font-size: 11px; padding: 9px 16px; cursor: pointer;
    border: 1px solid #8a0c24; background: #8a0c24; color: #fff;
  }
  .no-print button.ghost { background: #fff; color: #8a0c24; }
</style>
</head>
<body>
<div class="no-print">
  <button type="button" onclick="window.print()">Nyomtatás / PDF mentése</button>
  <button type="button" class="ghost" onclick="window.close()">Bezárás</button>
</div>

<div class="sheet">
  <header class="letterhead">
    <div class="mark">
      <div class="name">${escapeHtml(HOUSE.name)}</div>
      <div class="parent">${escapeHtml(HOUSE.parent)}</div>
      <div class="lines">
        ${escapeHtml(HOUSE.address)}<br>
        ${escapeHtml(HOUSE.phone)} · Nyilvántartási szám: ${escapeHtml(HOUSE.registration)}
      </div>
    </div>
    <div class="meta">
      <div class="ref">${escapeHtml(reference)}</div>
      <div>Kiállítva: ${escapeHtml(issuedAt)}</div>
      <div>Kiállító: ${escapeHtml(issuer.name)}</div>
    </div>
  </header>

  <h1>${escapeHtml(DOCUMENT_LABEL[payload.kind])}</h1>
  <div class="period">${escapeHtml(payload.period)}</div>
  ${payload.preamble ? `<p class="preamble">${escapeHtml(payload.preamble)}</p>` : ''}

  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>

  <div class="summary">${summary}</div>

  ${notes ? `<div class="notes"><b>Megjegyzések</b><ul>${notes}</ul></div>` : ''}

  <div class="signatures">
    <div class="sig-block">
      ${signatureSvg(issuer.name)}
      <div class="sig-line">
        <div class="sig-name">${escapeHtml(issuer.name)}</div>
        <div class="sig-meta">${escapeHtml(issuer.title)} · Azonosító: ${escapeHtml(issuer.idNumber)}</div>
        <div class="sig-meta">${escapeHtml(issuer.phone)}</div>
      </div>
    </div>
    <div class="sig-block">
      ${signatureSvg(HOUSE.owner.name)}
      <div class="sig-line">
        <div class="sig-name">${escapeHtml(HOUSE.owner.name)}</div>
        <div class="sig-meta">${escapeHtml(HOUSE.owner.title)} · Azonosító: ${escapeHtml(HOUSE.owner.idNumber)}</div>
        <div class="sig-meta">${escapeHtml(HOUSE.owner.phone)}</div>
      </div>
    </div>
  </div>

  <footer>
    <span>${escapeHtml(HOUSE.name)} · ${escapeHtml(HOUSE.parent)} · belső használatra</span>
    <span>A dokumentum a kiállítás pillanatának adataival készült.</span>
  </footer>
</div>
</body>
</html>`;
}

/**
 * Opens the rendered document in its own window.
 *
 * Returns false when the browser blocked the popup, so the caller can tell the
 * user why nothing happened instead of leaving them clicking a dead button.
 */
export function openDocument(payload: DocumentPayload, issuer: Issuer): boolean {
  const html = renderDocument(payload, issuer);
  const target = window.open('', '_blank', 'width=980,height=1200');
  if (!target) return false;
  target.document.open();
  target.document.write(html);
  target.document.close();
  return true;
}
