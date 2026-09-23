import React, {useEffect, useMemo, useState} from 'react';
import {Check, GripVertical, Plus, Trash2, X} from 'lucide-react';
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

interface Product {
  id: string;
  name: string;
  image: string;
  price: number;
  section: string;
  active: boolean;
  category: string;
}

interface Pick {
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
  hourlyWage: number;
  transferAccount: string;
  transferName: string;
}

interface Person {
  id: string;
  name: string;
  title: string;
  note: string;
  monogram: string;
  tier: 'owner' | 'co-owner' | 'manager' | 'staff';
  sortOrder: number;
  active: boolean;
}

const TIER_OPTIONS = [
  {value: 'owner' as const, label: 'Tulajdonos', glyph: '主'},
  {value: 'co-owner' as const, label: 'Társtulajdonos', glyph: '共'},
  {value: 'manager' as const, label: 'Üzletvezető', glyph: '長'},
  {value: 'staff' as const, label: 'Csapat', glyph: '員'}
];

const SLOT_GLYPH = ['一', '二', '三'];

export const ShowcasePage: React.FC = () => {
  const {data: productData} = useLiveData<{products: Product[]}>('/api/products', {intervalMs: 0});
  const {data: pickData, refresh: refreshPicks} = useLiveData<{drinks: Pick[]}>('/api/signature-drinks', {intervalMs: 0});
  const {data: houseData, refresh: refreshHouse} = useLiveData<{house: HouseSettings; people: Person[]}>('/api/house', {intervalMs: 0});
  const {data: userData} = useLiveData<{users: AuthUser[]}>('/api/users', {intervalMs: 0});

  const products = useMemo(
    () => (productData?.products || []).filter((product) => product.active && product.category === 'drink'),
    [productData]
  );

  const [slots, setSlots] = useState<{productId: string; description: string}[]>([]);
  const [house, setHouse] = useState<HouseSettings | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [newPerson, setNewPerson] = useState<Omit<Person, 'id'> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pickData) return;
    const next = [0, 1, 2].map((index) => {
      const pick = pickData.drinks.find((entry) => entry.slot === index + 1);
      return {productId: pick?.productId || '', description: pick?.description || ''};
    });
    setSlots(next);
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
    const sure = await dialog.confirm({
      title: `Leveszed: ${person.name}?`,
      message: 'A családfáról és a főoldalról is eltűnik.',
      confirmLabel: 'LEVÉTEL',
      tone: 'danger'
    });
    if (!sure) return;
    run(async () => {
      await apiSend(`/api/house/people/${person.id}`, 'DELETE');
      refreshHouse();
    }, `${person.name} levéve.`);
  };

  const createPerson = () => {
    if (!newPerson) return;
    run(async () => {
      await apiSend('/api/house/people', 'POST', newPerson);
      setNewPerson(null);
      refreshHouse();
    }, 'Felkerült a családfára.');
  };

  const productOptions = products.map((product) => ({
    value: product.id,
    label: product.name,
    description: `${sectionLabel(product.section)} · ${formatHuf(product.price)}`
  }));

  const ownerOptions = (userData?.users || [])
    .filter((user) => user.role === 'owner' && user.active)
    .map((user) => ({value: user.id, label: user.name, description: user.hasSignature ? 'van aláírása' : 'nincs aláírása'}));

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
          lead="A főoldal három kiemelt itala, a családfa a Rólunk oldalon, és a ház adatai, amelyek minden bizonylatra rákerülnek."
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
            Ez a három ital jelenik meg a főoldalon és az itallap alján, kiemelve. Válassz italt, és írj hozzá egy mondatot —
            ez a mondat kerül a kártyára.
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
                  <Select
                    value={slot.productId}
                    options={productOptions}
                    placeholder="Válassz italt…"
                    onChange={(value) => setSlots((current) => current.map((entry, position) => (position === index ? {...entry, productId: value} : entry)))}
                  />
                  <textarea
                    value={slot.description}
                    onChange={(event) => setSlots((current) => current.map((entry, position) => (position === index ? {...entry, description: event.target.value.slice(0, 260)} : entry)))}
                    rows={2}
                    placeholder="Egy mondat a kártyára…"
                    className={`${inputClass} mt-3`}
                  />
                  {slot.productId && (
                    <button
                      type="button"
                      onClick={() => setSlots((current) => current.map((entry, position) => (position === index ? {productId: '', description: ''} : entry)))}
                      className="mt-3 text-[9px] tracking-[0.18em] text-[#777] hover:text-[color:var(--rm-red)]"
                    >
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
            A Rólunk oldal családfája és a főoldal „A tulajdonosok” szakasza innen olvas. A tulajdonosi szintek felülre kerülnek,
            az üzletvezetők alájuk. A monogram a kör közepén jelenik meg.
          </p>

          {newPerson && (
            <div className="mb-4 border border-[color:var(--rm-line-red)] bg-black/30 p-4">
              <PersonFields person={newPerson} onChange={(next) => setNewPerson(next)}/>
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

          <div className="flex flex-col gap-2.5">
            {people.map((person, index) => (
              <div key={person.id} className={`border border-white/[0.06] bg-black/20 p-4 ${person.active ? '' : 'opacity-60'}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#777]">
                    <GripVertical size={12}/> {String(index + 1).padStart(2, '0')}
                    <Badge tone={person.tier === 'owner' || person.tier === 'co-owner' ? 'red' : 'muted'}>
                      {TIER_OPTIONS.find((option) => option.value === person.tier)?.label}
                    </Badge>
                    {!person.active && <Badge tone="warn">REJTETT</Badge>}
                  </span>
                  <div className="flex items-center gap-1">
                    <Btn variant="red" className="!px-3 !py-2 !text-[8px]" onClick={() => savePerson(person)} disabled={busy}>
                      MENTÉS
                    </Btn>
                    <button type="button" onClick={() => removePerson(person)} aria-label="Levétel" className="p-1.5 text-[#777] hover:text-[color:var(--rm-red)]">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
                <PersonFields person={person} onChange={(next) => setPeople((current) => current.map((entry) => (entry.id === person.id ? {...entry, ...next} : entry)))}/>
              </div>
            ))}
          </div>
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
              <Field label="ÓRABÉR (FT)" hint="A bérelszámolás és a profil becsült bére ezzel számol.">
                <input type="number" min={0} value={house.hourlyWage} onChange={(event) => setHouse({...house, hourlyWage: Number(event.target.value) || 0})} className={inputClass}/>
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
          </form>
        )}
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
      <span className="ml-auto flex items-center gap-2 text-[#777]">
        SORREND
        <input type="number" min={0} value={person.sortOrder} onChange={(event) => onChange({...person, sortOrder: Number(event.target.value) || 0})} className="rm-input !w-16 !py-1.5 text-center"/>
      </span>
    </label>
  </div>
);
