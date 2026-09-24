import React, {useEffect, useMemo, useState} from 'react';
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GripVertical, Plus, Trash2, X} from 'lucide-react';
import {Btn} from '../../components/ui/Btn';
import {Select} from '../../components/ui/Select';
import {Badge, Field, inputClass, PageHeader, Panel} from '../../components/ui/console';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, assetUrl, formatHuf} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {toast} from '../../stores/useToastStore';
import {dialog} from '../../stores/useDialogStore';
import {sectionLabel} from '../../lib/sections';
import type {AuthUser} from '../../stores/useAuthStore';
import {FloorLegend, FloorMap} from '../../components/floor/FloorMap';
import {useFloorPlan} from '../../hooks/useFloorPlan';
import {normalizeFloorPlan, type FloorPlan} from '../../../shared/floorPlan.ts';

interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
  section: string;
  active: boolean;
  category: string;
}

interface DrinkPick {
  productId: string;
  name?: string;
  image?: string;
  description: string;
  slot: number;
}

interface HouseSettings {
  name: string;
  address: string;
  phone: string;
  registration: string;
  ownerUserId: string | null;
  transferAccount: string;
  transferName: string;
  featuredVideo: string;
  featuredVideoTitle: string;
  featuredVideoCaption: string;
}

type Tier = 'owner' | 'co-owner' | 'manager' | 'staff';

interface Person {
  id: string;
  name: string;
  title: string;
  note: string;
  monogram: string;
  tier: Tier;
  sortOrder: number;
  active: boolean;
}

const TIERS: {value: Tier; label: string; glyph: string; hint: string}[] = [
  {value: 'owner', label: 'Tulajdonos', glyph: '主', hint: 'A ház feje. Legfelül, egyedül vagy ketten.'},
  {value: 'co-owner', label: 'Társtulajdonos', glyph: '共', hint: 'A tulajdonos mellett, a második sorban.'},
  {value: 'manager', label: 'Manager', glyph: '長', hint: 'A műszakok vezetői.'},
  {value: 'staff', label: 'Csapat', glyph: '員', hint: 'Akik az estét csinálják.'}
];

const TIER_OPTIONS = TIERS.map((tier) => ({value: tier.value, label: tier.label, glyph: tier.glyph}));

const SLOT_GLYPH = ['一', '二', '三'];

const monogramOf = (person: Pick<Person, 'name' | 'monogram'>) => person.monogram || person.name.slice(0, 2).toUpperCase();

/* ------------------------------------------------------------------ */
/* The family tree board                                               */
/* ------------------------------------------------------------------ */

/**
 * Four lanes, one per tier. A card can be dragged into another lane or
 * before another card; the arrows do the same for touch and keyboards.
 * Every move is saved at once and reflected on the public page.
 */
const TierBoard: React.FC<{
  people: Person[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (next: Person[]) => void;
}> = ({people, selectedId, onSelect, onMove}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<Tier | null>(null);

  const lanes = useMemo(() => {
    const byTier: Record<Tier, Person[]> = {owner: [], 'co-owner': [], manager: [], staff: []};
    for (const person of [...people].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'hu'))) byTier[person.tier].push(person);
    return byTier;
  }, [people]);

  /** Rebuilds the list with `id` placed in `tier` at `index`, renumbering everything. */
  const place = (id: string, tier: Tier, index: number) => {
    const moving = people.find((person) => person.id === id);
    if (!moving) return;
    const next: Person[] = [];
    let order = 0;
    for (const lane of TIERS) {
      const cards = lanes[lane.value].filter((person) => person.id !== id);
      if (lane.value === tier) cards.splice(Math.max(0, Math.min(index, cards.length)), 0, {...moving, tier});
      for (const card of cards) next.push({...card, tier: lane.value, sortOrder: order++});
    }
    onMove(next);
  };

  const shift = (person: Person, delta: number) => {
    const cards = lanes[person.tier];
    const index = cards.findIndex((entry) => entry.id === person.id);
    place(person.id, person.tier, index + delta);
  };

  const changeTier = (person: Person, delta: number) => {
    const position = TIERS.findIndex((tier) => tier.value === person.tier);
    const target = TIERS[Math.max(0, Math.min(TIERS.length - 1, position + delta))];
    if (target.value === person.tier) return;
    place(person.id, target.value, lanes[target.value].length);
  };

  return (
    <div className="rm-tierboard">
      {TIERS.map((tier) => (
        <div
          key={tier.value}
          className={`rm-tierlane${overLane === tier.value ? ' is-over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (overLane !== tier.value) setOverLane(tier.value);
          }}
          onDragLeave={() => setOverLane(null)}
          onDrop={(event) => {
            event.preventDefault();
            const id = dragId || event.dataTransfer.getData('text/plain');
            setOverLane(null);
            setDragId(null);
            if (id) place(id, tier.value, lanes[tier.value].length);
          }}
        >
          <div className="rm-tierlane-head">
            <span className="rm-tierlane-glyph" aria-hidden="true">
              {tier.glyph}
            </span>
            <div>
              <strong className="block text-[10px] tracking-[0.2em] text-white">{tier.label.toUpperCase()}</strong>
              <span className="text-[9px] text-[#6f6968]">{tier.hint}</span>
            </div>
            <span className="ml-auto text-[9px] text-[#5f5959]">{lanes[tier.value].length}</span>
          </div>
          <div className="rm-tierlane-cards">
            {lanes[tier.value].map((person, index) => (
              <div
                key={person.id}
                draggable
                onDragStart={(event) => {
                  setDragId(person.id);
                  event.dataTransfer.setData('text/plain', person.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverLane(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const id = dragId || event.dataTransfer.getData('text/plain');
                  setOverLane(null);
                  setDragId(null);
                  if (id && id !== person.id) place(id, tier.value, index);
                }}
                onClick={() => onSelect(selectedId === person.id ? null : person.id)}
                className={`rm-tiercard${dragId === person.id ? ' is-dragging' : ''}${selectedId === person.id ? ' is-selected' : ''}${person.active ? '' : ' is-hidden'}`}
                title="Húzd másik sorba vagy hely elé; kattints a szerkesztéshez"
              >
                <GripVertical size={12} className="text-[#5f5959]"/>
                <span className="rm-tiercard-mono">{monogramOf(person)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] text-white">{person.name}</span>
                  <span className="block truncate text-[8px] tracking-[0.12em] text-[#8d8584]">{person.title || '—'}</span>
                </span>
                <span className="ml-1 flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
                  <button type="button" className="rm-tiercard-move" onClick={() => shift(person, -1)} aria-label="Előrébb" disabled={index === 0}>
                    <ArrowLeft size={11}/>
                  </button>
                  <button type="button" className="rm-tiercard-move" onClick={() => shift(person, 1)} aria-label="Hátrébb" disabled={index === lanes[tier.value].length - 1}>
                    <ArrowRight size={11}/>
                  </button>
                  <button type="button" className="rm-tiercard-move" onClick={() => changeTier(person, -1)} aria-label="Feljebb egy szinttel" disabled={tier.value === 'owner'}>
                    <ArrowUp size={11}/>
                  </button>
                  <button type="button" className="rm-tiercard-move" onClick={() => changeTier(person, 1)} aria-label="Lejjebb egy szinttel" disabled={tier.value === 'staff'}>
                    <ArrowDown size={11}/>
                  </button>
                </span>
              </div>
            ))}
            {!lanes[tier.value].length && <span className="self-center text-[9px] tracking-[0.15em] text-[#4f4a4a]">HÚZZ IDE VALAKIT</span>}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export const ShowcasePage: React.FC = () => {
  const {data: productData} = useLiveData<{products: Product[]}>('/api/products', {intervalMs: 0});
  const {data: pickData, refresh: refreshPicks} = useLiveData<{drinks: DrinkPick[]}>('/api/signature-drinks', {intervalMs: 0});
  const {data: houseData, refresh: refreshHouse, mutate: mutateHouse} = useLiveData<{house: HouseSettings; people: Person[]}>('/api/house', {intervalMs: 0, refetchOnMutation: false});
  const {data: userData} = useLiveData<{users: AuthUser[]}>('/api/users', {intervalMs: 0});

  const products = useMemo(() => (productData?.products || []).filter((product) => product.active && product.category === 'drink'), [productData]);

  const [slots, setSlots] = useState<{productId: string; description: string}[]>([]);
  const [house, setHouse] = useState<HouseSettings | null>(null);

  /* The floor plan: one JSON document, checked here and on the server with the same code. */
  const floor = useFloorPlan(null);
  const [planText, setPlanText] = useState('');
  const [planError, setPlanError] = useState('');
  const [planPreview, setPlanPreview] = useState<FloorPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  useEffect(() => {
    if (floor.data && !planText) setPlanText(JSON.stringify(floor.data.plan, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.data]);

  const checkPlan = (): FloorPlan | null => {
    try {
      const parsed = normalizeFloorPlan(JSON.parse(planText));
      setPlanPreview(parsed);
      setPlanError('');
      return parsed;
    } catch (err) {
      setPlanPreview(null);
      setPlanError(err instanceof SyntaxError ? `Nem érvényes JSON — ${err.message}` : (err as Error).message);
      playSfx('error');
      return null;
    }
  };

  const savePlan = async () => {
    const parsed = checkPlan();
    if (!parsed || planBusy) return;
    setPlanBusy(true);
    try {
      const reply = await apiSend<{plan: FloorPlan}>('/api/house/floor-plan', 'PUT', {plan: parsed});
      setPlanText(JSON.stringify(reply.plan, null, 2));
      setPlanPreview(null);
      toast.success('Alaprajz mentve.', `${reply.plan.tables.length} asztal.`);
      playSfx('success');
      floor.refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setPlanBusy(false);
    }
  };

  const resetPlan = async () => {
    const sure = await dialog.confirm({
      title: 'Visszaállítod a beépített termet?',
      message: 'A mentett alaprajz törlődik, a beépített teszt-terem lép a helyébe. A foglalásokon lévő asztalszámok megmaradnak.',
      confirmLabel: 'VISSZAÁLLÍTÁS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      const reply = await apiSend<{plan: FloorPlan}>('/api/house/floor-plan', 'DELETE');
      setPlanText(JSON.stringify(reply.plan, null, 2));
      setPlanPreview(null);
      setPlanError('');
      toast.success('A beépített terem van érvényben.');
      floor.refresh();
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
    }
  };

  const copyPlan = async () => {
    try {
      await navigator.clipboard.writeText(planText);
      toast.success('Az alaprajz a vágólapon.');
    } catch {
      toast.error('Nem sikerült másolni');
    }
  };
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState<Omit<Person, 'id'> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pickData) return;
    setSlots(
      [0, 1, 2].map((index) => {
        const pick = pickData.drinks.find((entry) => entry.slot === index + 1);
        return {productId: pick?.productId || '', description: pick?.description || ''};
      })
    );
  }, [pickData]);

  useEffect(() => {
    if (!houseData) return;
    setHouse(houseData.house);
    setPeople(houseData.people);
  }, [houseData]);

  const run = async (action: () => Promise<unknown>, okText: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(okText);
      playSfx('success');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const savePicks = () =>
    run(async () => {
      await apiSend('/api/signature-drinks', 'PUT', {drinks: slots.filter((slot) => slot.productId)});
      refreshPicks();
    }, 'Kiemelt italok mentve. A főoldal frissült.');

  const saveHouse = (event: React.FormEvent) => {
    event.preventDefault();
    if (!house) return;
    run(async () => {
      await apiSend('/api/house', 'PATCH', house);
      refreshHouse();
    }, 'A ház adatai mentve.');
  };

  const savePerson = (person: Person) =>
    run(async () => {
      await apiSend(`/api/house/people/${person.id}`, 'PATCH', person);
      refreshHouse();
    }, `${person.name} mentve.`);

  const removePerson = async (person: Person) => {
    const sure = await dialog.confirm({title: `Leveszed: ${person.name}?`, message: 'A családfáról és a főoldalról is eltűnik.', confirmLabel: 'LEVÉTEL', tone: 'danger'});
    if (!sure) return;
    // Gone from the board at once; the server confirms.
    setPeople((current) => current.filter((entry) => entry.id !== person.id));
    setSelectedId(null);
    try {
      await apiSend(`/api/house/people/${person.id}`, 'DELETE');
      toast.success(`${person.name} levéve.`);
      playSfx('delete');
    } catch (err) {
      toast.error('Nem sikerült', (err as Error).message);
      playSfx('error');
      refreshHouse();
    }
  };

  const createPerson = () => {
    if (!newPerson) return;
    run(async () => {
      await apiSend('/api/house/people', 'POST', newPerson);
      setNewPerson(null);
      refreshHouse();
    }, 'Felkerült a családfára.');
  };

  /** A drag or an arrow: the board updates now, the order is saved right after. */
  const moved = async (next: Person[]) => {
    setPeople(next);
    mutateHouse((current) => (current ? {...current, people: next} : current));
    try {
      await apiSend('/api/house/people/order', 'PUT', next.map((person) => ({id: person.id, tier: person.tier, sortOrder: person.sortOrder})));
      playSfx('ui_click');
    } catch (err) {
      toast.error('A sorrend nem mentődött', (err as Error).message);
      refreshHouse();
    }
  };

  const selected = people.find((person) => person.id === selectedId) || null;

  const productOptions = products.map((product) => ({value: product.id, label: product.name, description: `${sectionLabel(product.section)} · ${formatHuf(product.price)}`}));

  const ownerOptions = (userData?.users || [])
    .filter((user) => user.role === 'owner' && user.active)
    .map((user) => ({value: user.id, label: user.name, description: user.hasSignature ? (user.signatureLocked ? 'végleges aláírás' : 'van aláírása') : 'nincs aláírása'}));

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / KIRAKAT"
          title={
            <>
              Amit a város <em>lát.</em>
            </>
          }
          lead="A főoldal három kiemelt itala, a családfa négy szintje a Rólunk oldalon, és a ház adatai, amelyek minden bizonylatra rákerülnek."
        />

        {/* ------------------------------------------------ SIGNATURE DRINKS */}
        <Panel
          tone="red"
          label="01 / A FŐOLDAL HÁROM ITALA"
          title="Signature italok."
          action={
            <Btn variant="red" onClick={savePicks} disabled={busy}>
              <Check size={13}/> MENTÉS
            </Btn>
          }
        >
          <p className="mb-6 max-w-xl text-[11px] leading-[1.8] text-[#8d8584]">
            Ez a három ital jelenik meg a főoldalon és az itallap alján, kiemelve. Válassz italt, és írj hozzá egy mondatot — ez a mondat kerül a kártyára.
          </p>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {slots.map((slot, index) => {
              const product = products.find((entry) => entry.id === slot.productId);
              return (
                <div key={index} className="relative overflow-hidden border border-[color:var(--rm-line)] bg-[#0a0a0c] p-5">
                  <span className="pointer-events-none absolute -right-2 -top-3 font-heading text-[70px] leading-none text-[rgba(213,31,60,0.12)]" aria-hidden="true">
                    {SLOT_GLYPH[index]}
                  </span>
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">0{index + 1} / SIGNATURE</span>
                  <div className="my-4 flex h-28 items-center justify-center">
                    {product?.image ? (
                      <img src={assetUrl(product.image)} alt="" className="max-h-28 object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.6)]"/>
                    ) : (
                      <span className="font-heading text-4xl text-[rgba(213,31,60,0.5)]">月</span>
                    )}
                  </div>
                  <Select value={slot.productId} options={productOptions} placeholder="Válassz italt…" onChange={(value) => setSlots((current) => current.map((entry, position) => (position === index ? {...entry, productId: value} : entry)))}/>
                  <textarea
                    value={slot.description}
                    onChange={(event) => setSlots((current) => current.map((entry, position) => (position === index ? {...entry, description: event.target.value.slice(0, 260)} : entry)))}
                    rows={2}
                    placeholder="Egy mondat a kártyára…"
                    className={`${inputClass} mt-3`}
                  />
                  {slot.productId && (
                    <button type="button" onClick={() => setSlots((current) => current.map((entry, position) => (position === index ? {productId: '', description: ''} : entry)))} className="mt-3 text-[9px] tracking-[0.18em] text-[#777] hover:text-[color:var(--rm-red)]">
                      ÜRÍTÉS
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* ------------------------------------------------ PEOPLE */}
        <Panel
          className="mt-3.5"
          label="02 / A CSALÁDFA"
          title="Akik a ház mögött állnak."
          action={
            !newPerson ? (
              <Btn onClick={() => setNewPerson({name: '', title: '', note: '', monogram: '', tier: 'manager', sortOrder: people.length, active: true})}>
                <Plus size={13}/> ÚJ SZEMÉLY
              </Btn>
            ) : undefined
          }
        >
          <p className="mb-5 max-w-xl text-[11px] leading-[1.8] text-[#8d8584]">
            Négy szint, fentről lefelé: tulajdonos, társtulajdonos, manager, csapat. Húzd a kártyákat másik sorba vagy egymás elé — a Rólunk oldal
            családfája azonnal követi. Kattints egy kártyára a szerkesztéshez.
          </p>

          {newPerson && (
            <div className="mb-4 border border-[color:var(--rm-line-red)] bg-black/30 p-4">
              <span className="rm-label">ÚJ SZEMÉLY</span>
              <div className="mt-3">
                <PersonFields person={newPerson} onChange={(next) => setNewPerson(next)}/>
              </div>
              <div className="mt-3 flex gap-2">
                <Btn variant="red" onClick={createPerson} disabled={busy || !newPerson.name.trim()}>
                  <Check size={12}/> FELVÉTEL
                </Btn>
                <Btn onClick={() => setNewPerson(null)}>
                  <X size={12}/> MÉGSE
                </Btn>
              </div>
            </div>
          )}

          <TierBoard people={people} selectedId={selectedId} onSelect={setSelectedId} onMove={moved}/>

          {selected && (
            <div className="mt-4 border border-[color:var(--rm-line-red)] bg-black/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#777]">
                  SZERKESZTÉS
                  <Badge tone={selected.tier === 'owner' || selected.tier === 'co-owner' ? 'red' : 'muted'}>{TIERS.find((tier) => tier.value === selected.tier)?.label}</Badge>
                  {!selected.active && <Badge tone="warn">REJTETT</Badge>}
                </span>
                <div className="flex items-center gap-1">
                  <Btn variant="red" className="!px-3 !py-2 !text-[8px]" onClick={() => savePerson(selected)} disabled={busy}>
                    MENTÉS
                  </Btn>
                  <button type="button" onClick={() => removePerson(selected)} aria-label="Levétel" className="p-1.5 text-[#777] hover:text-[color:var(--rm-red)]">
                    <Trash2 size={13}/>
                  </button>
                  <button type="button" onClick={() => setSelectedId(null)} aria-label="Bezárás" className="p-1.5 text-[#777] hover:text-white">
                    <X size={13}/>
                  </button>
                </div>
              </div>
              <PersonFields person={selected} onChange={(next) => setPeople((current) => current.map((entry) => (entry.id === selected.id ? {...entry, ...next} : entry)))}/>
            </div>
          )}
        </Panel>

        {/* ------------------------------------------------ HOUSE */}
        {house && (
          <form onSubmit={saveHouse} className="rm-card mt-3.5 p-6 md:p-7">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="rm-label">03 / A HÁZ ADATAI</span>
                <h3 className="mt-2 font-heading text-[20px] leading-tight text-white">Ami a bizonylatokra kerül.</h3>
              </div>
              <Btn type="submit" variant="red" disabled={busy}>
                <Check size={13}/> MENTÉS
              </Btn>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="A HÁZ NEVE">
                <input value={house.name} onChange={(event) => setHouse({...house, name: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="CÍM">
                <input value={house.address} onChange={(event) => setHouse({...house, address: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="TELEFON">
                <input value={house.phone} onChange={(event) => setHouse({...house, phone: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="NYILVÁNTARTÁSI SZÁM">
                <input value={house.registration} onChange={(event) => setHouse({...house, registration: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="ELLENJEGYZŐ TULAJDONOS" hint="Az ő aláírása kerül minden kimutatás jobb oldalára.">
                <Select value={house.ownerUserId || ''} options={ownerOptions} placeholder="Válassz tulajdonost…" onChange={(value) => setHouse({...house, ownerUserId: value})}/>
              </Field>
              <Field label="ÁTUTALÁSI SZÁMLASZÁM" hint="Műszakzáráskor ide kérjük a bevételt.">
                <input value={house.transferAccount} onChange={(event) => setHouse({...house, transferAccount: event.target.value})} className={inputClass}/>
              </Field>
              <Field label="SZÁMLATULAJDONOS NEVE">
                <input value={house.transferName} onChange={(event) => setHouse({...house, transferName: event.target.value})} className={inputClass}/>
              </Field>
            </div>

            <div className="mt-8 border-t border-white/[0.06] pt-6">
              <span className="rm-label">04 / A HÁZ FILMJE</span>
              <p className="mt-2 text-[10px] leading-[1.7] text-[#8d8584]">
                A főoldal tetején, a főcím alatt szól — némán, magától, ahogy a látogató odaér; egy koppintásra megnyílik hanggal. Töltsd fel a videót a YouTube-ra, és illeszd be a linkjét. Üresen hagyva a szakasz el sem jelenik.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="YOUTUBE LINK" hint="youtube.com/watch?v=… vagy youtu.be/… — az azonosító elég.">
                  <input value={house.featuredVideo} onChange={(event) => setHouse({...house, featuredVideo: event.target.value})} placeholder="https://youtu.be/…" className={inputClass}/>
                </Field>
                <Field label="CÍM">
                  <input value={house.featuredVideoTitle} onChange={(event) => setHouse({...house, featuredVideoTitle: event.target.value.slice(0, 120)})} placeholder="pl. Egy este a Red Moonban" className={inputClass}/>
                </Field>
                <Field label="EGY SOR ALÁ">
                  <input value={house.featuredVideoCaption} onChange={(event) => setHouse({...house, featuredVideoCaption: event.target.value.slice(0, 240)})} placeholder="rövid felvezető" className={inputClass}/>
                </Field>
              </div>
              {house.featuredVideo && (
                <a href={`https://www.youtube.com/watch?v=${house.featuredVideo.length === 11 ? house.featuredVideo : ''}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[9px] tracking-[0.2em] text-[#777] hover:text-white">
                  MEGNÉZEM A YOUTUBE-ON ↗
                </a>
              )}
            </div>
          </form>
        )}

        <Panel
          className="mt-3.5"
          label="05 / ALAPRAJZ"
          title="A terem, ahogy a vendég választ."
          action={
            <div className="flex flex-wrap gap-2">
              <Btn onClick={checkPlan}>ELLENŐRZÉS</Btn>
              <Btn variant="red" onClick={savePlan} disabled={planBusy}>
                MENTÉS
              </Btn>
              <Btn onClick={copyPlan}>MÁSOLÁS</Btn>
              <Btn onClick={resetPlan}>BEÉPÍTETT TEREM</Btn>
            </div>
          }
        >
          <p className="mb-4 max-w-3xl text-[10px] leading-[1.7] text-[#8d8584]">
            A foglalásnál a vendég ezen a rajzon választ asztalt, és itt látszik, mi van már elígérve. Az alaprajz egy JSON: a terem mérete, a zónák, a díszlet (pult, színpad, ajtó, falak, oszlopok) és az asztalok — alak, hely, székek száma, legkisebb társaság, House szint. Illeszd be, ellenőrizd, mentsd; az előnézet azonnal mutatja. A beépített terem csak teszt.
          </p>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <textarea
              value={planText}
              onChange={(event) => {
                setPlanText(event.target.value);
                setPlanPreview(null);
              }}
              spellCheck={false}
              className={`${inputClass} rm-floor-editor`}
              aria-label="Alaprajz JSON"
            />
            <div>
              {planError && <p className="mb-3 border-l-2 border-[color:var(--rm-red)] pl-3 text-[11px] leading-[1.6] text-[color:var(--rm-red)]">{planError}</p>}
              {(planPreview || floor.data) && <FloorMap plan={planPreview || floor.data!.plan} taken={[]} at={new Date()} slotMinutes={150}/>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <FloorLegend staff/>
                <span className="text-[8px] tracking-[0.2em] text-[#777]">{planPreview ? 'ELŐNÉZET · MÉG NINCS MENTVE' : 'A MENTETT TEREM'}</span>
              </div>
            </div>
          </div>
        </Panel>
      </section>
    </main>
  );
};

const PersonFields: React.FC<{person: Omit<Person, 'id'>; onChange: (next: Omit<Person, 'id'>) => void}> = ({person, onChange}) => (
  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
    <Field label="NÉV">
      <input value={person.name} onChange={(event) => onChange({...person, name: event.target.value})} className={inputClass}/>
    </Field>
    <Field label="TITULUS">
      <input value={person.title} onChange={(event) => onChange({...person, title: event.target.value})} placeholder="pl. Tulajdonos / Vezető" className={inputClass}/>
    </Field>
    <Field label="MEGJEGYZÉS">
      <input value={person.note} onChange={(event) => onChange({...person, note: event.target.value})} placeholder="pl. Cégtulajdonos · Főnök" className={inputClass}/>
    </Field>
    <div className="grid grid-cols-[1fr_1fr] gap-3">
      <Field label="MONOGRAM">
        <input value={person.monogram} onChange={(event) => onChange({...person, monogram: event.target.value.toUpperCase().slice(0, 6)})} className={inputClass}/>
      </Field>
      <Field label="SZINT">
        <Select value={person.tier} options={TIER_OPTIONS} onChange={(value) => onChange({...person, tier: value})}/>
      </Field>
    </div>
    <label className="flex items-center gap-3 text-[10px] text-[#c9c2c1] xl:col-span-4">
      <button type="button" role="switch" aria-checked={person.active} onClick={() => onChange({...person, active: !person.active})} className="rm-switch"/>
      Látható a nyilvános oldalon
    </label>
  </div>
);
