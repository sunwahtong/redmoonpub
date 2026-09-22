/**
 * First-run data.
 *
 * Runs after migrations on every start and only fills what is empty: the
 * catalogue, the signature drink slots, the house particulars, the public
 * family tree, and — from the environment — the first owner account.
 *
 * Everything here is a starting point the owner edits from the console.
 */
import crypto from 'node:crypto';
import {config} from './config.ts';
import {hashPassword} from './auth.ts';
import {generateSignatureSvg} from '../shared/signature.ts';
import type {Db} from './types.ts';

export interface CanonicalDrink {
  id: string;
  name: string;
  section: string;
  price: number;
  stock: number;
  minStock: number;
  image: string;
}

export const CANONICAL_DRINKS: CanonicalDrink[] = [
  {id: 'p_kobaltas', name: 'Kőbaltás', section: 'beer', price: 1200, stock: 24, minStock: 8, image: 'assets/menu/drinks/kobaltas.png'},
  {id: 'p_barracho', name: 'Barracho', section: 'beer', price: 1800, stock: 24, minStock: 8, image: 'assets/menu/drinks/barracho.png'},
  {id: 'p_sornyito', name: 'Sörnyitó', section: 'accessories', price: 2400, stock: 18, minStock: 6, image: 'assets/menu/drinks/sornyito.png'},
  {id: 'p_syrah', name: 'Syrah vörösbor', section: 'wine', price: 5000, stock: 18, minStock: 6, image: 'assets/menu/drinks/syrah.png'},
  {id: 'p_two_roosters', name: 'Two Roosters rozé', section: 'wine', price: 5600, stock: 18, minStock: 6, image: 'assets/menu/drinks/two_roosters.png'},
  {id: 'p_bleuterd', name: "Bleuter'D pezsgő", section: 'wine', price: 4800, stock: 18, minStock: 6, image: 'assets/menu/drinks/bleuterd.png'},
  {id: 'p_mount_bourbon', name: 'The Mount Bourbon Whiskey', section: 'spirits', price: 11200, stock: 16, minStock: 5, image: 'assets/menu/drinks/mount_bourbon.png'},
  {id: 'p_vinewood', name: 'Vinewood Sauvignon Blanc fehérbor', section: 'wine', price: 5800, stock: 18, minStock: 6, image: 'assets/menu/drinks/vinewood.png'},
  {id: 'p_chernekov', name: 'Cherenkov Premium Vodka', section: 'spirits', price: 12600, stock: 16, minStock: 5, image: 'assets/menu/drinks/chernekov.png'},
  {id: 'p_cazafortunas', name: 'Cazafortunas Tequila', section: 'spirits', price: 12200, stock: 16, minStock: 5, image: 'assets/menu/drinks/cazafortunas.png'},
  {id: 'p_sinmisito', name: 'Sinmisito Tequila', section: 'spirits', price: 15800, stock: 14, minStock: 4, image: 'assets/menu/drinks/sinmisito.png'},
  {id: 'p_ragga', name: 'Ragga rum', section: 'spirits', price: 11200, stock: 16, minStock: 5, image: 'assets/menu/drinks/ragga.png'},
  {id: 'p_sprunk', name: 'Sprunk (dobozos)', section: 'nonalcoholic', price: 1780, stock: 30, minStock: 10, image: 'assets/menu/drinks/sprunk.png'},
  {id: 'p_ecola', name: 'E-Cola (dobozos)', section: 'nonalcoholic', price: 1780, stock: 30, minStock: 10, image: 'assets/menu/drinks/ecola.png'},
  {id: 'p_raine', name: 'Rainé ásványvíz', section: 'nonalcoholic', price: 1600, stock: 32, minStock: 10, image: 'assets/menu/drinks/raine.png'}
];

const DEFAULT_SIGNATURE_DRINKS = [
  {slot: 1, productId: 'p_sinmisito', description: 'Ha hirtelen akarod megérezni az estét.'},
  {slot: 2, productId: 'p_ragga', description: 'Az igazi kalózok ezt isszák.'},
  {slot: 3, productId: 'p_two_roosters', description: 'Könnyed, elegáns választás a Red Moon estékhez.'}
];

const DEFAULT_PEOPLE = [
  {name: 'Zhen Yu Xiao', title: 'Tulajdonos / Vezető', note: 'Cégtulajdonos · Főnök', monogram: 'XIXO', tier: 'owner', sort: 0},
  {name: 'Ruan Yu Celeste', title: 'Társtulajdonos / Üzletvezető', note: 'Társtulajdonos · Üzletvezető', monogram: 'CELI', tier: 'co-owner', sort: 1},
  {name: 'Yuna Yue Rei', title: 'Red Moon üzletvezető', note: 'Red Moon Manager', monogram: 'REI', tier: 'manager', sort: 2},
  {name: 'Red Moon Manager', title: 'Red Moon üzletvezető', note: 'Red Moon Manager · MGR', monogram: 'MGR', tier: 'manager', sort: 3}
];

const HOUSE_DEFAULTS = {
  address: 'Test Street 12.A, See City',
  phone: '+36 76 123 1234',
  registration: 'SC-RM-0001',
  transferAccount: '21541444-70524373',
  transferName: 'Zhen Yu Xiao'
};

export async function seed(db: Db): Promise<void> {
  await seedCatalogue(db);
  await seedHouse(db);
  await bootstrapOwner(db);
}

async function seedCatalogue(db: Db): Promise<void> {
  const {rows} = await db.query<{n: number}>('select count(*)::int as n from public.products');
  if (rows[0].n === 0) {
    let order = 0;
    for (const drink of CANONICAL_DRINKS) {
      await db.query(
        `insert into public.products (id, name, category, section, price, stock, min_stock, image, subtitle, sort_order)
         values ($1, $2, 'drink', $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing`,
        [drink.id, drink.name, drink.section, drink.price, drink.stock, drink.minStock, drink.image, 'Red Moon Pub · SeeCity RP', order++]
      );
    }
  }
  const picks = await db.query<{n: number}>('select count(*)::int as n from public.signature_drinks');
  if (picks.rows[0].n === 0) {
    for (const pick of DEFAULT_SIGNATURE_DRINKS) {
      await db.query(
        `insert into public.signature_drinks (slot, product_id, description)
         select $1, $2, $3 where exists (select 1 from public.products where id = $2)
         on conflict (slot) do nothing`,
        [pick.slot, pick.productId, pick.description]
      );
    }
  }
}

async function seedHouse(db: Db): Promise<void> {
  await db.query(
    `update public.house set
       address = case when address = '' then $1 else address end,
       phone = case when phone = '' then $2 else phone end,
       registration = case when registration = '' then $3 else registration end,
       transfer_account = case when transfer_account = '' then $4 else transfer_account end,
       transfer_name = case when transfer_name = '' then $5 else transfer_name end
     where id = 1`,
    [HOUSE_DEFAULTS.address, HOUSE_DEFAULTS.phone, HOUSE_DEFAULTS.registration, HOUSE_DEFAULTS.transferAccount, HOUSE_DEFAULTS.transferName]
  );
  const {rows} = await db.query<{n: number}>('select count(*)::int as n from public.house_people');
  if (rows[0].n === 0) {
    for (const person of DEFAULT_PEOPLE) {
      await db.query('insert into public.house_people (name, title, note, monogram, tier, sort_order) values ($1, $2, $3, $4, $5, $6)', [
        person.name,
        person.title,
        person.note,
        person.monogram,
        person.tier,
        person.sort
      ]);
    }
  }
}

/**
 * Creates the first owner from OWNER_USERNAME / OWNER_PASSWORD, once, while no
 * owner exists. Setting the variables later has no effect; accounts are then
 * managed in the console.
 */
async function bootstrapOwner(db: Db): Promise<void> {
  if (!config.ownerUsername || !config.ownerPassword) return;
  const owners = await db.query<{n: number}>(`select count(*)::int as n from public.staff_accounts where role = 'owner'`);
  if (owners.rows[0].n > 0) return;
  const taken = await db.query('select 1 from public.staff_accounts where lower(username) = lower($1)', [config.ownerUsername]);
  if (taken.rows.length) return;
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.staff_accounts (id, username, name, nickname, role, password_hash, signature_svg, signature_at, show_public)
     values ($1, $2, $3, $4, 'owner', $5, $6, now(), true)`,
    [id, config.ownerUsername, config.ownerName, config.ownerName.split(' ').pop() || 'Owner', hashPassword(config.ownerPassword), generateSignatureSvg(config.ownerName, id)]
  );
  await db.query('update public.house set owner_user_id = $1 where id = 1 and owner_user_id is null', [id]);
  console.log(`[seed] owner account "${config.ownerUsername}" created`);
}
