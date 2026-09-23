/**
 * The catalogue behind the register, stock movements and supply runs.
 *
 * The house has no supplier: somebody walks to a shop, buys the stock and
 * carries it back. A supply order is therefore a job ticket with an audit
 * trail — what it should cost, what it did cost, and who ran it.
 */
import crypto from 'node:crypto';
import {z} from 'zod';
import {audit, capabilitiesOf, notify, notifyManagers, requireRole, requireUser, roleAtLeast} from '../auth.ts';
import {bad, conflict, created, forbidden, iso, notFound, parse, readJson, shortCode, type Router} from '../http.ts';
import {acceptImage, destroyMedia} from '../media.ts';
import type {Queryable, Row} from '../types.ts';

export const SECTIONS = ['beer', 'wine', 'spirits', 'nonalcoholic', 'accessories', 'other'] as const;

const productCreate = z.object({
  name: z.string().trim().min(1, 'Név kötelező.').max(120),
  category: z.enum(['drink', 'food']).default('drink'),
  section: z.enum(SECTIONS).default('other'),
  price: z.coerce.number().min(0).max(100_000_000).default(0),
  stock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  minStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  image: z.string().trim().max(600).default(''),
  imagePublicId: z.string().trim().max(200).default(''),
  subtitle: z.string().trim().max(180).default(''),
  description: z.string().trim().max(600).default('')
});

const productPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  section: z.enum(SECTIONS).optional(),
  price: z.coerce.number().min(0).max(100_000_000).optional(),
  minStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
  image: z.string().trim().max(600).optional(),
  imagePublicId: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(180).optional(),
  description: z.string().trim().max(600).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional()
});

const restockBody = z.object({
  source: z.string().trim().max(60).default('nagyker'),
  note: z.string().trim().max(300).default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.coerce.number().int().min(1, 'A mennyiség legalább 1 legyen.').max(9999),
        unitCost: z.coerce.number().min(0, 'A beszerzési ár nem lehet negatív.').max(10_000_000).default(0),
        source: z.string().trim().max(60).optional(),
        note: z.string().trim().max(300).optional()
      })
    )
    .min(1, 'A feltöltési kosár üres.')
    .max(60)
});

const orderCreate = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        qty: z.coerce.number().int().min(1, 'A mennyiség legalább 1 legyen.').max(999),
        unitCost: z.coerce.number().min(0, 'A becsült egységár nem lehet negatív.').max(10_000_000)
      })
    )
    .min(1, 'A rendelés üres.')
    .max(40),
  note: z.string().trim().max(400).default(''),
  source: z.string().trim().max(80).default('Nagyker')
});

const orderComplete = z.object({
  actualTotal: z.coerce.number().min(0, 'Az összeg nem lehet negatív.').max(1_000_000_000),
  varianceNote: z.string().trim().max(400).default('')
});

export const productFromRow = (row: Row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  section: row.section || 'other',
  price: row.price,
  stock: row.stock,
  minStock: row.min_stock,
  image: row.image || '',
  imagePublicId: row.image_public_id || '',
  subtitle: row.subtitle || '',
  description: row.description || '',
  active: row.active !== false,
  sortOrder: row.sort_order,
  updatedAt: iso(row.updated_at)
});

const restockFromRow = (row: Row) => ({
  id: row.id,
  at: iso(row.at),
  userId: row.user_id,
  user: row.user_name,
  productId: row.product_id,
  product: row.product_name,
  qty: row.qty,
  unitCost: row.unit_cost,
  totalCost: row.total_cost,
  source: row.source,
  note: row.note || '',
  orderId: row.order_id
});

export const orderFromRow = (row: Row, items: Row[] = []) => ({
  id: row.id as string,
  code: row.code as string,
  at: iso(row.at),
  createdById: row.created_by,
  createdByName: row.created_by_name,
  items: items.map((item) => ({productId: item.product_id as string, product: item.product_name as string, qty: item.qty as number, unitCost: item.unit_cost as number, lineEstimate: item.line_estimate as number})),
  estimatedTotal: row.estimated_total as number,
  source: row.source as string,
  note: row.note || '',
  status: row.status as string,
  claimedById: row.claimed_by,
  claimedByName: row.claimed_by_name,
  claimedAt: iso(row.claimed_at),
  startedAt: iso(row.started_at),
  completedById: row.completed_by,
  completedByName: row.completed_by_name,
  completedAt: iso(row.completed_at),
  actualTotal: row.actual_total,
  variance: row.variance,
  varianceNote: row.variance_note || ''
});

export type Order = ReturnType<typeof orderFromRow>;

export async function listOrders(db: Queryable, limit = 300): Promise<Order[]> {
  const {rows} = await db.query('select * from public.supply_orders order by at desc limit $1', [limit]);
  const ids = rows.map((row) => row.id);
  const items = ids.length ? (await db.query('select * from public.supply_order_items where order_id = any($1)', [ids])).rows : [];
  return rows.map((row) => orderFromRow(row, items.filter((item) => item.order_id === row.id)));
}

async function loadOrder(db: Queryable, id: string): Promise<Order | null> {
  const {rows} = await db.query('select * from public.supply_orders where id = $1', [id]);
  if (!rows[0]) return null;
  const items = (await db.query('select * from public.supply_order_items where order_id = $1', [id])).rows;
  return orderFromRow(rows[0], items);
}

async function recordExpense(db: Queryable, entry: {kind: string; ref?: string; amount: number; byId?: string; byName?: string; note?: string}): Promise<void> {
  await db.query('insert into public.expenses (kind, ref, amount, by_user, by_name, note) values ($1, $2, $3, $4, $5, $6)', [
    entry.kind,
    entry.ref || '',
    Math.round(Number(entry.amount) || 0),
    entry.byId || null,
    entry.byName || '',
    entry.note || ''
  ]);
}

export function registerInventoryRoutes(router: Router): void {
  /* ---------------- products ---------------- */

  router.get('/api/products', async ({db, user}) => {
    requireUser({user});
    const {rows} = await db.query('select * from public.products order by sort_order, name');
    return {products: rows.map(productFromRow)};
  });

  router.post('/api/products', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(productCreate, await readJson(req));
    acceptImage(body.image, body.imagePublicId, 'product');
    const id = `p_${crypto.randomBytes(6).toString('hex')}`;
    const order = (await db.query<{n: number}>('select coalesce(max(sort_order), 0)::int + 1 as n from public.products')).rows[0].n;
    const {rows} = await db.query(
      `insert into public.products (id, name, category, section, price, stock, min_stock, image, image_public_id, subtitle, description, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [id, body.name, body.category, body.section, Math.round(body.price), body.stock, body.minStock, body.image, body.image ? body.imagePublicId : '', body.subtitle, body.description, order]
    );
    await audit(db, me, 'PRODUCT_CREATE', body.name);
    return created({product: productFromRow(rows[0])});
  });

  router.patch('/api/products/:id', async ({db, req, user, params}) => {
    const me = requireRole({user}, 'manager');
    const existing = (await db.query('select * from public.products where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('Termék nem található');
    const body = parse(productPatch, await readJson(req));
    if ((body.price !== undefined || body.subtitle !== undefined) && !roleAtLeast(me.role, 'owner')) {
      throw forbidden('Az eladási árat és az alcímet csak OWNER módosíthatja.');
    }
    const fields: string[] = [];
    const values: unknown[] = [params.id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.section !== undefined) set('section', body.section);
    if (body.price !== undefined) set('price', Math.round(body.price));
    if (body.minStock !== undefined) set('min_stock', body.minStock);
    if (body.active !== undefined) set('active', body.active);
    const imagePublicId = body.image ? body.imagePublicId || '' : '';
    if (body.image !== undefined) {
      acceptImage(body.image, imagePublicId, 'product');
      set('image', body.image);
      set('image_public_id', imagePublicId);
    }
    if (body.subtitle !== undefined) set('subtitle', body.subtitle);
    if (body.description !== undefined) set('description', body.description);
    if (body.sortOrder !== undefined) set('sort_order', body.sortOrder);
    if (!fields.length) return {product: productFromRow(existing)};
    const {rows} = await db.query(`update public.products set ${fields.join(', ')} where id = $1 returning *`, values);
    // The replaced picture leaves the store with the reference.
    if (body.image !== undefined && existing.image_public_id && existing.image_public_id !== imagePublicId) await destroyMedia(existing.image_public_id, 'image');
    await audit(db, me, 'PRODUCT_UPDATE', `${rows[0].name}${body.price !== undefined ? ` · ár ${existing.price} → ${rows[0].price}` : ''}${body.active !== undefined ? (body.active ? ' · aktív' : ' · inaktív') : ''}`);
    return {product: productFromRow(rows[0])};
  });

  router.delete('/api/products/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const existing = (await db.query('select * from public.products where id = $1', [params.id])).rows[0];
    if (!existing) throw notFound('Termék nem található');
    const {rows} = await db.query('update public.products set active = false where id = $1 returning *', [params.id]);
    await audit(db, me, 'PRODUCT_DELETE', `${existing.name} · katalógusból eltávolítva`);
    return {ok: true, product: productFromRow(rows[0])};
  });

  /* ---------------- stock ---------------- */

  router.post('/api/inventory/adjust', async ({db, req, user}) => {
    const me = requireRole({user}, 'owner');
    const body = await readJson(req);
    const stock = Math.floor(Number(body.stock));
    const product = (await db.query('select * from public.products where id = $1', [String(body.productId || '')])).rows[0];
    if (!product || !Number.isInteger(stock) || stock < 0) throw bad('Érvénytelen készletadat');
    const {rows} = await db.query('update public.products set stock = $2 where id = $1 returning *', [product.id, stock]);
    await audit(db, me, 'INVENTORY_OPENING_SET', `${product.name}: ${product.stock} → ${stock} · nyitókészlet beállítva`);
    return {product: productFromRow(rows[0]), openingStock: true};
  });

  router.get('/api/restock/logs', async ({db, user}) => {
    requireRole({user}, 'manager');
    const {rows} = await db.query('select * from public.restock_logs order by at desc limit 500');
    return {logs: rows.map(restockFromRow)};
  });

  router.delete('/api/restock/logs/:id', async ({db, user, params}) => {
    const me = requireRole({user}, 'owner');
    const {rows} = await db.query('delete from public.restock_logs where id = $1 returning *', [params.id]);
    if (!rows[0]) throw notFound('A feltöltési naplóbejegyzés nem található');
    await audit(db, me, 'RESTOCK_LOG_DELETE', `${rows[0].product_name} · +${rows[0].qty} db · ${rows[0].user_name}`);
    return {ok: true, deletedRestockLogId: params.id};
  });

  router.post('/api/restock', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(restockBody, await readJson(req));
    const merged = new Map<string, {qty: number; unitCost: number; source: string; note: string}>();
    for (const item of body.items) {
      const current = merged.get(item.productId) || {qty: 0, unitCost: item.unitCost, source: item.source || body.source, note: item.note || body.note};
      current.qty += item.qty;
      merged.set(item.productId, current);
    }
    const logs: Row[] = [];
    const products: Row[] = [];
    await db.tx(async (tx) => {
      for (const [productId, item] of merged) {
        const product = (await tx.query('select * from public.products where id = $1 and active for update', [productId])).rows[0];
        if (!product) throw notFound('A feltöltendő termék nem található vagy már nem aktív.');
        const updated = await tx.query('update public.products set stock = stock + $2 where id = $1 returning *', [productId, item.qty]);
        const log = await tx.query(
          `insert into public.restock_logs (user_id, user_name, product_id, product_name, qty, unit_cost, total_cost, source, note)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
          [me.id, me.name, product.id, product.name, item.qty, Math.round(item.unitCost), Math.round(item.unitCost * item.qty), item.source, item.note]
        );
        logs.push(log.rows[0]);
        products.push(updated.rows[0]);
        await tx.query('insert into public.expenses (kind, ref, amount, by_user, by_name, note) values ($1, $2, $3, $4, $5, $6)', [
          'restock',
          product.name,
          Math.round(item.unitCost * item.qty),
          me.id,
          me.name,
          `${item.qty} db · ${item.source}`
        ]);
      }
    });
    for (const log of logs) {
      await notifyManagers(db, 'Készletfeltöltés', `${me.name}: ${log.product_name} +${log.qty} db · ${Number(log.total_cost).toLocaleString('hu-HU')} Ft`, {restockId: log.id});
    }
    await audit(db, me, 'RESTOCK', logs.map((log) => `${log.product_name}: +${log.qty} db · ${log.total_cost} Ft`).join(' | '));
    return created({products: products.map(productFromRow), logs: logs.map(restockFromRow)});
  });

  /* ---------------- supply orders ---------------- */

  router.get('/api/orders', async ({db, user}) => {
    const me = requireUser({user});
    const capabilities = capabilitiesOf(me);
    return {orders: await listOrders(db), canCreate: capabilities.manager, canRun: capabilities.runOrders};
  });

  router.post('/api/orders', async ({db, req, user}) => {
    const me = requireRole({user}, 'manager');
    const body = parse(orderCreate, await readJson(req));
    const merged = new Map<string, {productId: string; qty: number; unitCost: number}>();
    for (const line of body.items) {
      const current = merged.get(line.productId);
      if (current) current.qty += line.qty;
      else merged.set(line.productId, {...line});
    }
    const products = (await db.query<{id: string; name: string}>('select id, name from public.products where active and id = any($1)', [[...merged.keys()]])).rows;
    for (const productId of merged.keys()) {
      if (!products.find((product) => product.id === productId)) throw notFound(`Ismeretlen termék: ${productId}`);
    }
    const estimated = [...merged.values()].reduce((sum, line) => sum + line.qty * line.unitCost, 0);
    let code = shortCode('RM-B');
    let orderId = '';
    await db.tx(async (tx) => {
      // Codes are short; retry on the rare collision.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const taken = await tx.query('select 1 from public.supply_orders where code = $1', [code]);
        if (!taken.rows.length) break;
        code = shortCode('RM-B');
      }
      const inserted = await tx.query<{id: string}>(
        `insert into public.supply_orders (code, created_by, created_by_name, estimated_total, source, note) values ($1, $2, $3, $4, $5, $6) returning id`,
        [code, me.id, me.name, Math.round(estimated), body.source, body.note]
      );
      orderId = inserted.rows[0].id;
      for (const [productId, line] of merged) {
        const product = products.find((entry) => entry.id === productId)!;
        await tx.query(`insert into public.supply_order_items (order_id, product_id, product_name, qty, unit_cost, line_estimate) values ($1, $2, $3, $4, $5, $6)`, [
          orderId,
          productId,
          product.name,
          line.qty,
          Math.round(line.unitCost),
          Math.round(line.qty * line.unitCost)
        ]);
      }
    });
    const order = (await loadOrder(db, orderId))!;
    await audit(db, me, 'ORDER_CREATE', `${order.code} · ${order.items.length} tétel · becsült ${order.estimatedTotal} Ft`);
    await notify(db, ['manager', 'owner'], 'Új beszerzés', `${order.code} · ${order.items.length} tétel · becsült ${order.estimatedTotal} Ft`, {orderId: order.id});
    return created({order});
  });

  router.post('/api/orders/:id/claim', async ({db, user, params}) => {
    const me = requireUser({user});
    if (!capabilitiesOf(me).runOrders) throw forbidden('Beszerzést biztonsági vagy üzletvezetői jogosultsággal lehet elvállalni.');
    const order = await loadOrder(db, params.id);
    if (!order) throw notFound('A beszerzés nem található.');
    if (order.status !== 'open') throw conflict('Ezt a beszerzést már elvállalták.');
    await db.query(`update public.supply_orders set status = 'claimed', claimed_by = $2, claimed_by_name = $3, claimed_at = now() where id = $1`, [order.id, me.id, me.name]);
    await audit(db, me, 'ORDER_CLAIM', order.code);
    return {order: await loadOrder(db, order.id)};
  });

  router.post('/api/orders/:id/start', async ({db, user, params}) => {
    const me = requireUser({user});
    const order = await loadOrder(db, params.id);
    if (!order) throw notFound('A beszerzés nem található.');
    if (order.claimedById !== me.id && !roleAtLeast(me.role, 'manager')) throw forbidden('Csak az veheti fel, aki elvállalta.');
    if (order.status !== 'claimed') throw conflict('Ez a beszerzés nincs elvállalt állapotban.');
    await db.query(`update public.supply_orders set status = 'progress', started_at = now() where id = $1`, [order.id]);
    await audit(db, me, 'ORDER_START', order.code);
    return {order: await loadOrder(db, order.id)};
  });

  router.post('/api/orders/:id/complete', async ({db, req, user, params}) => {
    const me = requireUser({user});
    const order = await loadOrder(db, params.id);
    if (!order) throw notFound('A beszerzés nem található.');
    if (order.claimedById !== me.id && !roleAtLeast(me.role, 'manager')) throw forbidden('Csak az zárhatja le, aki elvállalta.');
    if (!['claimed', 'progress'].includes(order.status)) throw conflict('Ez a beszerzés már lezárult.');
    const body = parse(orderComplete, await readJson(req));
    const actual = Math.round(body.actualTotal);
    const variance = actual - order.estimatedTotal;
    await db.tx(async (tx) => {
      // Stock only moves now, when the goods are physically in the store room.
      for (const line of order.items) {
        const product = (await tx.query('select id, name from public.products where id = $1', [line.productId])).rows[0];
        if (!product) continue;
        await tx.query('update public.products set stock = stock + $2 where id = $1', [product.id, line.qty]);
        await tx.query(
          `insert into public.restock_logs (user_id, user_name, product_id, product_name, qty, unit_cost, total_cost, source, note, order_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [me.id, me.name, product.id, product.name, line.qty, line.unitCost, line.lineEstimate, order.source || 'Beszerzés', `${order.code} beszerzés`, order.id]
        );
      }
      await tx.query(
        `update public.supply_orders set status = 'completed', completed_by = $2, completed_by_name = $3, completed_at = now(),
           actual_total = $4, variance = $5, variance_note = $6 where id = $1`,
        [order.id, me.id, me.name, actual, variance, body.varianceNote]
      );
    });
    await recordExpense(db, {kind: 'order', ref: order.code, amount: actual, byId: me.id, byName: me.name, note: `${order.items.length} tétel · becsült ${order.estimatedTotal} Ft`});
    await audit(db, me, 'ORDER_COMPLETE', `${order.code} · becsült ${order.estimatedTotal} Ft · tényleges ${actual} Ft · eltérés ${variance} Ft`);
    if (Math.abs(variance) > 0) {
      await notify(db, ['manager', 'owner'], 'Beszerzési eltérés', `${order.code} · ${variance > 0 ? '+' : ''}${variance} Ft · ${me.name}`, {orderId: order.id});
    }
    return {order: await loadOrder(db, order.id)};
  });

  router.post('/api/orders/:id/cancel', async ({db, user, params}) => {
    const me = requireRole({user}, 'manager');
    const order = await loadOrder(db, params.id);
    if (!order) throw notFound('A beszerzés nem található.');
    if (order.status === 'completed') throw conflict('Lezárt beszerzést nem lehet visszavonni.');
    await db.query(`update public.supply_orders set status = 'cancelled' where id = $1`, [order.id]);
    await audit(db, me, 'ORDER_CANCEL', order.code);
    return {order: await loadOrder(db, order.id)};
  });
}
