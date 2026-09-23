import type {Column, Content, TDocumentDefinitions, TableCell} from 'pdfmake/interfaces';
import {DOCUMENT_LABEL, documentFileName, issuedStamp, resolveSignatures, type DocumentContext, type DocumentPayload} from './documents';
import type {Person} from './house';
import {signatureImageData} from './signature';

/**
 * Turns a document model into a PDF the operator saves locally.
 *
 * The renderer (pdfmake) is loaded on first use: it is a megabyte the rest
 * of the site never needs. The file is encrypted with a random owner
 * password and no printing permission, so a viewer that honours PDF
 * permissions — every mainstream one does — offers no print action.
 */

const RED = '#8a0c24';
const INK = '#16161d';
const MUTED = '#6a6a74';
const RULE = '#e2e2e8';

let engine: Promise<typeof import('pdfmake/build/pdfmake')> | null = null;

async function loadEngine() {
  if (!engine) {
    engine = (async () => {
      const [{default: pdfMake}, fonts] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
      const vfs = (fonts as unknown as {default?: Record<string, string>}).default || (fonts as unknown as Record<string, string>);
      pdfMake.addVirtualFileSystem(vfs);
      return pdfMake;
    })();
  }
  return engine;
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** pdfmake needs plain XML: strip attributes the browser adds for accessibility. */
function cleanSvg(svg: string): string {
  return svg.replace(/\s(role|aria-label)="[^"]*"/g, '');
}

function signatureColumn(person: Person | null, fallbackTitle: string): Column {
  if (!person) return {text: '', width: '*'};
  const stack: Content[] = [];
  const picture = person.signatureImage || signatureImageData(person.signatureSvg);
  if (picture) stack.push({image: picture, fit: [200, 56], margin: [0, 0, 0, -2]});
  else if (person.signatureSvg) stack.push({svg: cleanSvg(person.signatureSvg), width: 200, margin: [0, 0, 0, -6]});
  else stack.push({text: '— aláírás nélkül —', color: MUTED, fontSize: 8, margin: [0, 44, 0, 4]});
  stack.push({canvas: [{type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.6, lineColor: INK}]});
  stack.push({text: person.name, bold: true, fontSize: 10, margin: [0, 4, 0, 0]});
  stack.push({text: `${person.title || fallbackTitle}${person.idNumber ? ` · Azonosító: ${person.idNumber}` : ''}`, color: MUTED, fontSize: 8});
  if (person.phone) stack.push({text: person.phone, color: MUTED, fontSize: 8});
  return {stack, width: 230};
}

export function buildPdfDefinition(payload: DocumentPayload, context: DocumentContext, reference: string): TDocumentDefinitions {
  const {house, issuer, owner} = context;

  const header: TableCell[] = payload.columns.map((column) => ({
    text: column.label.toUpperCase(),
    fontSize: 7,
    color: MUTED,
    characterSpacing: 0.6,
    alignment: column.numeric ? 'right' : 'left',
    margin: [0, 4, 0, 4]
  }));
  const body: TableCell[][] = payload.rows.length
    ? payload.rows.map((row) =>
        payload.columns.map((column) => ({
          text: String(row[column.key] ?? ''),
          fontSize: 8.5,
          alignment: column.numeric ? 'right' : 'left',
          margin: [0, 3, 0, 3]
        }))
      )
    : [[{text: 'Az időszakra nem esik adat.', colSpan: payload.columns.length, alignment: 'center', color: MUTED, margin: [0, 14, 0, 14]}, ...payload.columns.slice(1).map(() => ({}))]];

  const summary: Column = {
    table: {
      widths: ['*', 'auto'],
      body: payload.summary.map((entry) => [
        {text: entry.label, fontSize: entry.strong ? 10 : 8.5, bold: !!entry.strong, margin: [0, 3, 8, 3], border: [false, false, false, !entry.strong]},
        {text: entry.value, fontSize: entry.strong ? 11 : 8.5, bold: !!entry.strong, color: entry.strong ? RED : INK, alignment: 'right', margin: [0, 3, 0, 3], border: [false, !!entry.strong, false, !entry.strong]}
      ])
    },
    layout: {
      hLineWidth: (index, node) => (index === node.table.body.length ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (index, node) => (index > 0 && node.table.body[index - 1]?.[0] && (node.table.body[index - 1][0] as {bold?: boolean}).bold ? INK : RULE),
      paddingLeft: () => 0,
      paddingRight: () => 0
    },
    width: 190
  };

  const content: Content[] = [
    {
      columns: [
        {
          stack: [
            {text: house.name, font: 'Roboto', fontSize: 19, color: RED, characterSpacing: 1},
            {text: house.address || ' ', fontSize: 8.5, color: '#3d3d47', margin: [0, 6, 0, 0]},
            {text: `${house.phone || ''}${house.registration ? `${house.phone ? ' · ' : ''}Nyilvántartási szám: ${house.registration}` : ''}`, fontSize: 8.5, color: '#3d3d47'}
          ]
        },
        {
          stack: [
            {text: reference, fontSize: 9, alignment: 'right'},
            {text: `Kiállítva: ${issuedStamp()}`, fontSize: 8.5, color: '#3d3d47', alignment: 'right', margin: [0, 3, 0, 0]},
            {text: `Kiállító: ${issuer.name}`, fontSize: 8.5, color: '#3d3d47', alignment: 'right'}
          ],
          width: 200
        }
      ],
      margin: [0, 0, 0, 10]
    },
    {canvas: [{type: 'line', x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 1.5, lineColor: RED}], margin: [0, 0, 0, 22]},
    {text: DOCUMENT_LABEL[payload.kind], fontSize: 16, bold: true},
    {text: payload.period.toUpperCase(), fontSize: 8, color: MUTED, characterSpacing: 1.2, margin: [0, 2, 0, 0]}
  ];

  if (payload.preamble) content.push({text: payload.preamble, fontSize: 9, color: '#3d3d47', margin: [0, 12, 0, 0]});

  if (payload.parties?.length) {
    content.push({
      columns: payload.parties.map((party) => ({
        stack: [
          {text: party.label.toUpperCase(), fontSize: 7, color: MUTED, characterSpacing: 0.8, margin: [0, 0, 0, 2]},
          ...party.lines.map((line) => ({text: line, fontSize: 9, color: '#3d3d47'}))
        ]
      })),
      columnGap: 24,
      margin: [0, 14, 0, 0]
    });
  }

  content.push({
    table: {headerRows: 1, widths: payload.columns.map((column) => (column.numeric ? 'auto' : '*')), body: [header, ...body]},
    layout: {
      hLineWidth: (index) => (index === 1 ? 0.8 : 0.4),
      hLineColor: (index) => (index === 1 ? INK : RULE),
      vLineWidth: () => 0,
      fillColor: (rowIndex) => (rowIndex > 0 && rowIndex % 2 === 0 ? '#fafafc' : null),
      paddingLeft: () => 6,
      paddingRight: () => 6
    },
    margin: [0, 16, 0, 0]
  });

  content.push({columns: [{text: '', width: '*'}, summary], margin: [0, 16, 0, 0]});

  if (payload.notes?.length) {
    content.push({text: 'Megjegyzések', bold: true, fontSize: 9, margin: [0, 18, 0, 4]});
    content.push({ul: payload.notes.map((note) => ({text: note, fontSize: 8.5, color: '#3d3d47'})), margin: [0, 0, 0, 0]});
  }

  const countersign = payload.countersign !== false;
  content.push({
    columns: [signatureColumn(issuer, issuer.role === 'owner' ? 'Tulajdonos' : 'Manager'), {text: '', width: '*'}, countersign ? signatureColumn(owner, 'Tulajdonos') : {text: '', width: 230}],
    margin: [0, 34, 0, 0],
    unbreakable: true
  });

  return {
    pageSize: 'A4',
    pageMargins: [46, 50, 46, 56],
    info: {title: `${DOCUMENT_LABEL[payload.kind]} — ${reference}`, author: house.name, creator: 'Red Moon konzol'},
    defaultStyle: {font: 'Roboto', fontSize: 9, color: INK, lineHeight: 1.2},
    footer: (currentPage, pageCount) => ({
      columns: [
        {text: `${house.name} · belső használatra`, fontSize: 7.5, color: '#8a8a94'},
        {text: `${currentPage} / ${pageCount}`, fontSize: 7.5, color: '#8a8a94', alignment: 'right'}
      ],
      margin: [46, 22, 46, 0]
    }),
    // No `printing` permission: a viewer that honours PDF permissions shows no print action.
    ownerPassword: randomPassword(),
    permissions: {modifying: false, copying: true, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false},
    content
  };
}

/** Builds the PDF and hands it to the browser as a download. */
export async function downloadDocumentPdf(payload: DocumentPayload, context: DocumentContext, reference: string): Promise<void> {
  const pdfMake = await loadEngine();
  const definition = buildPdfDefinition(payload, await resolveSignatures(context), reference);
  pdfMake.createPdf(definition).download(documentFileName(payload, reference));
}
