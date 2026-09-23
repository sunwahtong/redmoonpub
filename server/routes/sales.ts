/**
 * The register: sales, receipts, invoices, and the data the document
 * generator needs (house particulars, issuer and owner signatures).
 */
import crypto from 'node:crypto';
import {z} from 'zod';
import {audit, loadAccount, notifyOwners, requireRole, requireUser, roleAtLeast} from '../auth.ts';
import {bad, conflict, created, forbidden, formatPhone, iso, notFound, parse, readJson, type Router} from '../http.ts';
import {openShift} from './shifts.ts';
import {saleFromRow} from './staff.ts';
import {broadcast} from '../realtime.ts';
import type {Account, Queryable, Row, SessionUser} from '../types.ts';

const saleBody = z.object({
  items: z.array(z.object({productId: z.string().min(1), qty: z.coerce.number().int().min(1).max(999)})).min(1, 'A kosár üres.').max(60),
  paymentMethod: z.enum(['cash', 'transfer']).default('cash')
});

const issuedBody = z.object({
  kind: z.string().trim().min(1).max(40),
  reference: z.string().trim().min(1).max(80),
  countersigned: z.boolean().default(true),
  storedDocumentId: z.string().trim().max(80).optional()
});

const invoiceBody = z.object({
  saleId: z.string().min(1),
  customer: z
    .object({
      name: z.string().trim().max(120).default('Vásárló'),
      address: z.string().trim().max(200).default(''),
      taxNumber: z.string().trim().max(40).default('')
    })
    .default({name: 'Vásárló', address: '', taxNumber: ''})
});

export const documentFromRow = (row: Row) => ({
  id: row.id,
  type: row.type,
  createdAt: iso(row.created_at),
  createdById: row.created_by,
  createdByName: row.created_by_name,
  saleId: row.sale_id,
  transactionId: row.transaction_id,
  shiftId: row.shift_id,
  customer: row.customer || {},
  seller: row.seller || {},
  items: row.items || [],
  total: row.total,
  paymentMethod: row.payment_method
});

function makeDocumentId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .map((part) => part.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((part) => part[0].toUpperCase());
  if (letters.length >= 2) return letters.slice(0, 6).join('');
  const fallback = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return fallback.slice(0, 3) || 'RED';
}

async function sellerBlock(db: Queryable): Promise<{name: string; owner: string}> {
  const house = (await db.query('select name, transfer_name from public.house where id = 1')).rows[0];
  return {name: house?.name || 'Red Moon Pub', owner: house?.transfer_name || ''};
}

const lineItems = (sales: Row[]) => JSON.stringify(sales.map((sale) => ({product: sale.product_name, qty: sale.qty, unitPrice: sale.unit_price, total: sale.total})));

export function registerSalesRoutes(router: Router): void {
  router.get('/api/sales', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select s.*, p.section from public.sales s left join public.products p on p.id = s.product_id order by s.at desc limit 500');
    return {sales: rows.map((row) => ({...saleFromRow(row), section: row.section || 'other'}))};
  });

  router.post('/api/sales', async ({db, req, user}) => {
    const me = requireUser({user});
    const shift = await openShift(db);
    if (!shift) throw conflict('Eladás előtt nyisd meg a kasszát / műszakot.');
    if (!shift.memberIds.includes(me.id) && !roleAtLeast(me.role, 'owner')) throw forbidden('Csak az aktuális műszak tagjai értékesíthetnek.');
    const body = parse(saleBody, await readJson(req));

    // Merge duplicate lines so the stock check sees the real quantity.
    const wanted = new Map<string, number>();
    for (const line of body.items) wanted.set(line.productId, (wanted.get(line.productId) || 0) + line.qty);

    const result = await db.tx(async (tx) => {
      const products = (await tx.query('select * from public.products where id = any($1) for update', [[...wanted.keys()]])).rows;
      const checked: {product: Row; qty: number}[] = [];
      for (const [productId, qty] of wanted) {
        const product = products.find((entry) => entry.id === productId);
        if (!product || !product.active) throw bad('A kosár egyik terméke már nem elérhető.');
        if (product.stock < qty) throw bad(`Nincs elég készlet. ${product.name}: jelenleg ${product.stock} db van.`);
        checked.push({product, qty});
      }

      const shiftRow = (await tx.query('select cart_counters from public.shifts where id = $1 for update', [shift.id])).rows[0];
      const cartCounters: Record<string, number> = {...(shiftRow.cart_counters || {})};
      const next = (Number(cartCounters[me.id]) || 0) + 1;
      cartCounters[me.id] = next;
      const cartId = `${initials(me.name)}${String(next).padStart(2, '0')}`;
      const transactionId = crypto.randomUUID();
      const at = new Date();
      const receiptId = makeDocumentId('REC');
      const seller = await sellerBlock(tx);

      const sales: Row[] = [];
      for (const {product, qty} of checked) {
        const total = product.price * qty;
        await tx.query('update public.products set stock = stock - $2 where id = $1', [product.id, qty]);
        const inserted = await tx.query(
          `insert into public.sales (transaction_id, cart_id, at, shift_id, user_id, user_name, product_id, product_name, category, qty, unit_price, total, payment_method, receipt_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
          [transactionId, cartId, at, shift.id, me.id, me.name, product.id, product.name, product.category, qty, product.price, total, body.paymentMethod, receiptId]
        );
        sales.push(inserted.rows[0]);
      }
      const total = sales.reduce((sum, sale) => sum + sale.total, 0);
      await tx.query(
        `insert into public.documents (id, type, created_at, created_by, created_by_name, sale_id, transaction_id, shift_id, customer, seller, items, total, payment_method)
         values ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [receiptId, at, me.id, me.name, sales[0].id, transactionId, shift.id, JSON.stringify({name: 'Vásárló', address: '', taxNumber: ''}), JSON.stringify(seller), lineItems(sales), total, body.paymentMethod]
      );
      await tx.query('update public.shifts set cart_counters = $2 where id = $1', [shift.id, JSON.stringify(cartCounters)]);
      return {sales, total, transactionId, cartId, receiptId};
    });

    await audit(db, me, 'SALE', `${result.sales.map((sale) => `${sale.product_name} × ${sale.qty}`).join(' + ')} · ${result.total} Ft · ${body.paymentMethod} · műszak ${shift.id}`);
    await broadcast('content', 'sale', {shiftId: shift.id});
    return created({
      sales: result.sales.map(saleFromRow),
      total: result.total,
      transactionId: result.transactionId,
      cartId: result.cartId,
      receiptId: result.receiptId,
      shift: await openShift(db)
    });
  });

  /** Deleting one line deletes the whole cart: a cart is one transaction. */
  const deleteTransaction = async (db: Queryable & {tx: (fn: (client: Queryable) => Promise<void>) => Promise<void>}, user: SessionUser, sales: Row[], label: string) => {
    const documentIds = [...new Set(sales.map((sale) => sale.receipt_id).filter(Boolean))];
    const restored: {productId: string; product: string; qty: number}[] = [];
    await db.tx(async (tx) => {
      for (const sale of sales) {
        await tx.query('update public.products set stock = stock + $2 where id = $1', [sale.product_id, sale.qty]);
        restored.push({productId: sale.product_id, product: sale.product_name, qty: sale.qty});
      }
      if (documentIds.length) await tx.query(`delete from public.documents where id = any($1) and type = 'receipt'`, [documentIds]);
      await tx.query('delete from public.sales where id = any($1)', [sales.map((sale) => sale.id)]);
    });
    const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    await audit(db, user, 'SALE_CART_DELETE', `${label} · ${sales.length} tétel · ${total} Ft · kosár törölve · készlet visszaállítva · nyugta törölve`);
    return {ok: true, deletedSales: sales.length, deletedTotal: total, restoredStock: restored, deletedReceipts: documentIds.length, invoicePreserved: sales.some((sale) => sale.invoice_id)};
  };

  router.delete('/api/sales/cart/:cartId', async ({db, user, params}) => {
    const me = requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.sales where cart_id = $1', [params.cartId]);
    if (!rows.length) throw notFound('Az eladási kosár nem található.');
    // A cart id repeats across shifts; the newest transaction is the intended one.
    const latest = rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0].transaction_id;
    const sales = rows.filter((row) => row.transaction_id === latest);
    return {...(await deleteTransaction(db, me, sales, params.cartId)), deletedCartId: params.cartId};
  });

  router.delete('/api/sales/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.sales where id = $1', [params.id]);
    if (!rows[0]) throw notFound('Az eladás nem található');
    const sales = (await db.query('select * from public.sales where transaction_id = $1', [rows[0].transaction_id])).rows;
    return {...(await deleteTransaction(db, me, sales, rows[0].cart_id || rows[0].id)), deletedSaleId: params.id};
  });

  /* ---------------- receipts & invoices ---------------- */

  router.post('/api/receipts', async ({db, req, user}) => {
    const me = requireUser({user});
    const body = await readJson(req);
    const {rows} = await db.query('select * from public.sales where id = $1', [String(body.saleId || '')]);
    const sale = rows[0];
    if (!sale) throw notFound('Az eladás nem található');
    if (sale.receipt_id) {
      const existing = await db.query('select * from public.documents where id = $1', [sale.receipt_id]);
      if (existing.rows[0]) return {document: documentFromRow(existing.rows[0])};
    }
    const transactionSales = (await db.query('select * from public.sales where transaction_id = $1', [sale.transaction_id])).rows;
    const id = makeDocumentId('REC');
    const total = transactionSales.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
    const seller = await sellerBlock(db);
    const inserted = await db.query(
      `insert into public.documents (id, type, created_by, created_by_name, sale_id, transaction_id, shift_id, customer, seller, items, total, payment_method)
       values ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [id, me.id, me.name, sale.id, sale.transaction_id, sale.shift_id, JSON.stringify({name: 'Vásárló', address: '', taxNumber: ''}), JSON.stringify(seller), lineItems(transactionSales), total, sale.payment_method]
    );
    await db.query('update public.sales set receipt_id = $2 where transaction_id = $1', [sale.transaction_id, id]);
    await audit(db, me, 'RECEIPT_CREATE', `${id} · ${total} Ft`);
    return created({document: documentFromRow(inserted.rows[0])});
  });

  router.post('/api/documents', async ({db, req, user}) => {
    const me = requireUser({user});
    const body = parse(invoiceBody, await readJson(req));
    const {rows} = await db.query('select * from public.sales where id = $1', [body.saleId]);
    const sale = rows[0];
    if (!sale) throw notFound('Az eladás nem található');
    const transactionSales = (await db.query('select * from public.sales where transaction_id = $1', [sale.transaction_id])).rows;
    const existingId = transactionSales.map((entry) => entry.invoice_id).find(Boolean);
    if (existingId) {
      const existing = await db.query('select * from public.documents where id = $1', [existingId]);
      if (existing.rows[0]) return {document: documentFromRow(existing.rows[0]), alreadyExists: true};
    }
    const byTransaction = await db.query(`select * from public.documents where type = 'invoice' and transaction_id = $1`, [sale.transaction_id]);
    if (byTransaction.rows[0]) {
      await db.query('update public.sales set invoice_id = $2 where transaction_id = $1', [sale.transaction_id, byTransaction.rows[0].id]);
      return {document: documentFromRow(byTransaction.rows[0]), alreadyExists: true};
    }
    const id = makeDocumentId('INV');
    const total = transactionSales.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
    const seller = await sellerBlock(db);
    const inserted = await db.query(
      `insert into public.documents (id, type, created_by, created_by_name, sale_id, transaction_id, shift_id, customer, seller, items, total, payment_method)
       values ($1, 'invoice', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [id, me.id, me.name, sale.id, sale.transaction_id, sale.shift_id, JSON.stringify(body.customer), JSON.stringify(seller), lineItems(transactionSales), total, sale.payment_method]
    );
    await db.query('update public.sales set invoice_id = $2 where transaction_id = $1', [sale.transaction_id, id]);
    await audit(db, me, 'INVOICE_CREATE', `${id} · ${transactionSales.map((entry) => entry.product_name).join(', ')} · ${total} Ft`);
    await notifyOwners(db, 'Új számla készült', `${me.name} számlát készített: ${id} · ${transactionSales.length} tétel · ${total} Ft`, {documentId: id, saleId: sale.id, createdBy: me.name});
    return created({document: documentFromRow(inserted.rows[0])});
  });

  router.get('/api/documents', async ({db, user}) => {
    requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.documents order by created_at desc limit 500');
    return {documents: rows.map(documentFromRow)};
  });

  router.delete('/api/documents/:id', async ({db, user, params}) => {
    requireUser({user});
    const {rows} = await db.query('select * from public.documents where id = $1', [params.id]);
    const doc = rows[0];
    if (!doc) throw notFound('A dokumentum nem található');
    const me = requireRole({user}, doc.type === 'receipt' ? 'manager' : 'owner');
    await db.tx(async (tx) => {
      if (doc.type === 'receipt') await tx.query('update public.sales set receipt_id = null where receipt_id = $1', [doc.id]);
      else await tx.query('update public.sales set invoice_id = null where invoice_id = $1', [doc.id]);
      await tx.query('delete from public.documents where id = $1', [doc.id]);
    });
    await audit(db, me, doc.type === 'receipt' ? 'RECEIPT_DELETE' : 'INVOICE_DELETE', `${doc.id} · ${doc.total} Ft`);
    return {ok: true, deletedId: doc.id};
  });

  /**
   * What a generated document needs beyond its own data: the house letterhead,
   * the signed-in issuer with their signature, and the owner's countersign.
   */
  router.get('/api/documents/context', async ({db, user}) => {
    const me = requireRole({user}, 'manager');
    const house = (await db.query('select * from public.house where id = 1')).rows[0];
    const issuer = (await loadAccount(db, me.id))!;
    let owner = house.owner_user_id ? await loadAccount(db, house.owner_user_id) : null;
    if (!owner) {
      const {rows} = await db.query<{id: string}>(`select id from public.staff_accounts where role = 'owner' and active order by created_at asc limit 1`);
      owner = rows[0] ? await loadAccount(db, rows[0].id) : null;
    }
    const person = (account: Account | null, fallbackTitle: string) =>
      account
        ? {
            id: account.id,
            name: account.name,
            title: account.title || fallbackTitle,
            role: account.role,
            idNumber: account.idNumber || '',
            phone: formatPhone(account.phone || ''),
            signatureUrl: account.signatureUrl || null
          }
        : null;
    return {
      house: {name: house.name, address: house.address, phone: house.phone, registration: house.registration},
      issuer: person(issuer, issuer.role === 'owner' ? 'Tulajdonos' : 'Manager'),
      owner: person(owner, 'Tulajdonos')
    };
  });

  /**
   * The browser reports every PDF it produced. The record is the house's
   * register of issued documents, and the moment a signature becomes final:
   * whoever signed can no longer change theirs.
   */
  router.post('/api/documents/issued', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(issuedBody, await readJson(req));
    const house = (await db.query('select owner_user_id from public.house where id = 1')).rows[0];
    let owner = house?.owner_user_id ? await loadAccount(db, house.owner_user_id) : null;
    if (!owner) {
      const {rows} = await db.query<{id: string}>(`select id from public.staff_accounts where role = 'owner' and active order by created_at asc limit 1`);
      owner = rows[0] ? await loadAccount(db, rows[0].id) : null;
    }
    const countersigner = body.countersigned && owner ? owner : null;
    await db.query(
      `insert into public.issued_documents (kind, reference, issuer_id, issuer_name, countersigner_id, countersigner_name, stored_document_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [body.kind, body.reference, me.id, me.name, countersigner?.id || null, countersigner?.name || '', body.storedDocumentId || null]
    );
    const lock = [me.id, ...(countersigner ? [countersigner.id] : [])];
    const {rowCount} = await db.query(
      `update public.staff_accounts set signature_locked_at = now(), signature_decided = true where id = any($1) and signature_locked_at is null and signature_url <> ''`,
      [lock]
    );
    await audit(db, me, 'DOCUMENT_ISSUED', `${body.kind} · ${body.reference}${countersigner ? ` · ellenjegyzi ${countersigner.name}` : ''}`);
    return {ok: true, newlyLocked: rowCount};
  });
}
