import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ArrowRight, Check, X} from 'lucide-react';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn} from '../components/ui/Btn';
import {Magnetic} from '../components/ui/Magnetic';
import {SplitReveal} from '../components/ui/SplitReveal';
import {TiltCard} from '../components/ui/TiltCard';
import {Reveal} from '../components/ui/Reveal';
import {SectionHead} from '../components/ui/SectionHead';
import {Embers} from '../components/effects/Embers';
import {apiGet, apiSend, formatDate, getVisitorToken} from '../lib/api';
import {useParallax} from '../hooks/useParallax';
import {backgroundImage} from '../lib/media';
import {playSfx} from '../lib/sfx';
import {dialog} from '../stores/useDialogStore';
import {toast} from '../stores/useToastStore';
import {
  isOpen,
  POSITIONS,
  POSITION_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  type Application,
  type CareerPosition
} from '../lib/careers';

const PHONE_PREFIX = '+38-76-';
const WHY_MAX = 900;

export const CareersPage: React.FC = () => {
  const backdropRef = useParallax<HTMLDivElement>(70);

  const [position, setPosition] = useState<CareerPosition | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [age, setAge] = useState('');
  const [availability, setAvailability] = useState('');
  const [experience, setExperience] = useState('');
  const [why, setWhy] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mine, setMine] = useState<Application[]>([]);

  const token = useMemo(() => getVisitorToken(), []);

  const loadMine = useCallback(async () => {
    try {
      const data = await apiGet<{applications: Application[]}>(
        `/api/careers/mine?token=${encodeURIComponent(token)}`
      );
      setMine(data.applications || []);
    } catch {
      /* Listing past applications is a convenience, not a prerequisite. */
    }
  }, [token]);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const phoneDigits = phone.startsWith(PHONE_PREFIX) ? phone.slice(PHONE_PREFIX.length) : '';
  const ageNumber = Number(age);
  const canSubmit =
    !!position &&
    name.trim().length >= 2 &&
    phoneDigits.length === 7 &&
    Number.isInteger(ageNumber) &&
    ageNumber >= 18 &&
    availability.trim().length >= 3 &&
    why.trim().length >= 20;

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const digits = raw.startsWith(PHONE_PREFIX) ? raw.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7) : '';
    setPhone(PHONE_PREFIX + digits);
  };

  const choose = (id: CareerPosition) => {
    setPosition(id);
    playSfx('ui_click');
    document.getElementById('jelentkezes')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit || !position) return;

    setBusy(true);
    setError('');
    try {
      const result = await apiSend<{application: Application}>('/api/careers', 'POST', {
        name: name.trim(),
        phone: phoneDigits,
        age: ageNumber,
        position,
        availability: availability.trim(),
        experience: experience.trim(),
        why: why.trim(),
        visitorToken: token
      });

      toast.success('Jelentkezés elküldve', `Azonosító: ${result.application.code}`);
      playSfx('success');
      setName('');
      setPhone(PHONE_PREFIX);
      setAge('');
      setAvailability('');
      setExperience('');
      setWhy('');
      setPosition(null);
      loadMine();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error('A jelentkezés nem ment el', message);
      playSfx('error');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (application: Application) => {
    const sure = await dialog.confirm({
      title: 'Visszavonod a jelentkezést?',
      message: `A(z) ${application.code} jelentkezés lezárul. Később újra jelentkezhetsz.`,
      confirmLabel: 'VISSZAVONÁS',
      tone: 'danger'
    });
    if (!sure) return;
    try {
      await apiSend(`/api/careers/${encodeURIComponent(application.id)}`, 'DELETE', {visitorToken: token});
      toast.info('Jelentkezés visszavonva');
      playSfx('delete');
      loadMine();
    } catch (err) {
      toast.error('Nem sikerült visszavonni', (err as Error).message);
    }
  };

  const chosen = POSITIONS.find((entry) => entry.id === position) || null;

  return (
    <main>
      {/* HERO */}
      <section className="relative flex min-h-[560px] items-end overflow-hidden border-b border-[color:var(--rm-line)] px-[8vw] pb-16 pt-[170px]">
        <div
          ref={backdropRef}
          style={backgroundImage('/assets/red-moon-cinematic.png')}
          className="pointer-events-none absolute inset-x-0 -top-20 bottom-[-80px] bg-cover bg-center opacity-[0.28]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(5,3,4,0.96),rgba(5,3,4,0.55))]"
          aria-hidden="true"
        />
        <Embers density={38}/>

        <div className="relative z-[2]">
          <div className="rm-label">RED MOON / CSATLAKOZZ</div>
          <h1 className="rm-heading rm-display-1 my-5">
            <SplitReveal text="DOLGOZZ"/>
            <br/>
            <em>
              <SplitReveal text="a házban." delay={230}/>
            </em>
          </h1>
          <p className="max-w-[580px] text-sm leading-[1.9] text-[#aaa]">
            A Red Moon nem hirdetéssel épült. A csapat egyesével állt össze — emberekből, akik akartak itt lenni.
            Ha te is ilyen vagy, itt tudsz szólni.
          </p>
        </div>
      </section>

      {/* OPEN ROLES */}
      <section className="rm-section">
        <SectionHead
          label="01 / NYITOTT POZÍCIÓK"
          title={
            <>
              Amire épp
              <br/>
              <em>embert keresünk.</em>
            </>
          }
          aside="Válassz egy pozíciót — a jelentkezési űrlap alul nyílik meg."
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {POSITIONS.map((entry, index) => {
            const active = position === entry.id;
            return (
              <Reveal key={entry.id} delay={Math.min(index, 6) * 80} className="h-full">
                <TiltCard className="h-full" max={7}>
                  <article
                    className={`rm-tier flex h-full flex-col p-7 transition-colors ${
                      active ? 'border-[color:var(--rm-red)]' : ''
                    }`}
                  >
                    <span className="rm-tier-glyph" aria-hidden="true">
                      {entry.glyph}
                    </span>

                    <div className="rm-tilt-layer relative flex h-full flex-col">
                      <div className="flex items-start justify-between gap-3">
                        <span className="rm-tier-crest" style={{color: 'var(--rm-red)'}}>
                          {entry.name}
                        </span>
                        {active && (
                          <span className="border border-[color:var(--rm-red)] px-2 py-1 text-[7px] tracking-[0.2em] text-white">
                            KIVÁLASZTVA
                          </span>
                        )}
                      </div>

                      <p className="mt-2.5 text-[11px] leading-[1.7] text-[#a09998]">{entry.tagline}</p>

                      <div className="rm-gilt my-6"/>

                      <ul className="flex flex-col gap-2.5">
                        {entry.duties.map((duty) => (
                          <li key={duty} className="flex gap-2.5 text-[10px] leading-[1.7] text-[#8d8584]">
                            <Check size={12} className="mt-[2px] shrink-0 text-[color:var(--rm-red)]"/>
                            {duty}
                          </li>
                        ))}
                      </ul>

                      <p className="mt-5 border-l border-[color:var(--rm-line-red)] pl-3 text-[10px] leading-[1.75] text-[#8d8584]">
                        {entry.looking}
                      </p>

                      <div className="mt-auto pt-7">
                        <Btn type="button" variant={active ? 'red' : 'outline'} onClick={() => choose(entry.id)}>
                          {active ? 'KIVÁLASZTVA' : 'JELENTKEZEM'} <ArrowRight size={13}/>
                        </Btn>
                      </div>
                    </div>
                  </article>
                </TiltCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* FORM + MY APPLICATIONS */}
      <section id="jelentkezes" className="border-t border-[color:var(--rm-line)] bg-[#070709] scroll-mt-20">
        <div className="rm-section">
          <div className="grid grid-cols-1 gap-[6vw] lg:grid-cols-[1fr_340px]">
            <div>
              <div className="rm-label">02 / JELENTKEZÉS</div>
              <NeonHeading as="h2" className="mb-3 mt-3.5">
                Mondd el, <em>ki vagy.</em>
              </NeonHeading>
              <p className="mb-9 max-w-xl text-[12px] leading-[1.9] text-[#9e9795]">
                Nem önéletrajzot várunk. Azt akarjuk tudni, milyen ember ülne be a pultunk mögé.
              </p>

              <form onSubmit={submit} className="border border-[color:var(--rm-line)] bg-[#09090b] p-8 md:p-11">
                <div className="mb-7">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">POZÍCIÓ</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {POSITIONS.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setPosition(entry.id)}
                        aria-pressed={position === entry.id}
                        className={`border px-4 py-2.5 text-[9px] font-bold tracking-[0.18em] transition-all ${
                          position === entry.id
                            ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.12)] text-white'
                            : 'border-white/10 text-[#8f8887] hover:border-white/30'
                        }`}
                      >
                        {entry.name}
                      </button>
                    ))}
                  </div>
                  {chosen && (
                    <p className="mt-3 text-[10px] leading-[1.7] text-[color:var(--rm-red)]">{chosen.tagline}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">KARAKTER NEVE</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">TELEFONSZÁM</span>
                    <input
                      value={phone}
                      onChange={handlePhoneChange}
                      inputMode="numeric"
                      className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">ÉLETKOR (18+)</span>
                    <input
                      value={age}
                      onChange={(event) => setAge(event.target.value.replace(/\D/g, '').slice(0, 2))}
                      inputMode="numeric"
                      className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]"
                    />
                  </label>
                </div>

                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">MIKOR ÉRSZ RÁ?</span>
                  <input
                    value={availability}
                    onChange={(event) => setAvailability(event.target.value.slice(0, 200))}
                    placeholder="Pl. hétköznap este 20:00-tól, hétvégén bármikor"
                    className="border border-white/10 bg-black/50 p-3.5 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                  />
                </label>

                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">KORÁBBI TAPASZTALAT (OPCIONÁLIS)</span>
                  <textarea
                    value={experience}
                    onChange={(event) => setExperience(event.target.value.slice(0, 600))}
                    rows={3}
                    placeholder="Hol dolgoztál eddig, mit csináltál…"
                    className="border border-white/10 bg-black/50 p-3.5 text-xs leading-[1.7] tracking-wider text-white outline-none transition-colors placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                  />
                </label>

                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-[8px] tracking-[0.25em] text-[#777]">MIÉRT A RED MOON?</span>
                  <div className="relative">
                    <textarea
                      value={why}
                      onChange={(event) => setWhy(event.target.value.slice(0, WHY_MAX))}
                      rows={5}
                      placeholder="Ez az a rész, amit tényleg elolvasunk."
                      className="w-full border border-white/10 bg-black/50 p-3.5 pb-8 text-xs leading-[1.7] tracking-wider text-white outline-none transition-colors placeholder:text-white/25 focus:border-[color:var(--rm-red)]"
                    />
                    <span className="absolute bottom-3 right-3 text-[9px] text-white/30">
                      {why.length} / {WHY_MAX}
                    </span>
                  </div>
                </label>

                {error && <p className="mt-5 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

                <div className="mt-8">
                  <Magnetic>
                    <Btn type="submit" variant="red" disabled={busy || !canSubmit}>
                      {busy ? 'KÜLDÉS…' : 'JELENTKEZÉS BEKÜLDÉSE'} <ArrowRight size={13}/>
                    </Btn>
                  </Magnetic>
                  {!canSubmit && (
                    <p className="mt-3 text-[9px] tracking-[0.15em] text-[#6f6968]">
                      POZÍCIÓ, NÉV, TELEFONSZÁM, ÉLETKOR, ELÉRHETŐSÉG ÉS INDOKLÁS KÖTELEZŐ.
                    </p>
                  )}
                </div>
              </form>
            </div>

            <aside className="flex flex-col gap-3.5">
              <Reveal>
                <div className="border border-[color:var(--rm-line)] bg-[#09090b] p-6">
                  <span className="rm-label">A JELENTKEZÉSEID</span>
                  {mine.length === 0 ? (
                    <p className="mt-3 text-[10px] leading-[1.8] text-[#777]">
                      Ide kerül a jelentkezésed, és itt látod, hol tart. Nem kell regisztrálnod.
                    </p>
                  ) : (
                    <div className="mt-4 flex flex-col gap-2.5">
                      {mine.map((application) => (
                        <div key={application.id} className="border border-white/[0.07] bg-black/40 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <strong className="font-heading text-[15px] text-white">{application.code}</strong>
                            <span
                              className={`border px-2 py-1 text-[8px] tracking-[0.18em] ${STATUS_CLASS[application.status]}`}
                            >
                              {STATUS_LABEL[application.status].toUpperCase()}
                            </span>
                          </div>
                          <p className="mt-2 text-[10px] text-[#8d8584]">
                            {POSITION_LABEL[application.position]} · {formatDate(application.at)}
                          </p>
                          {application.staffNote && (
                            <p className="mt-2 border-l border-[color:var(--rm-line-red)] pl-2.5 text-[10px] leading-[1.7] text-[#c9c2c1]">
                              {application.staffNote}
                            </p>
                          )}
                          {isOpen(application.status) && (
                            <button
                              type="button"
                              onClick={() => withdraw(application)}
                              className="mt-3 inline-flex items-center gap-1.5 text-[9px] tracking-[0.18em] text-[#777] underline-offset-4 transition-colors hover:text-[color:var(--rm-red)] hover:underline"
                            >
                              <X size={10}/> VISSZAVONÁS
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Reveal>

              <Reveal delay={90}>
                <div className="relative overflow-hidden border border-[color:var(--rm-line)] bg-[#0a0a0c] p-6">
                  <span className="rm-glyph">月</span>
                  <span className="rm-label relative">AHOGY FELVESZÜNK</span>
                  <ol className="relative mt-4 flex flex-col gap-4">
                    {[
                      ['01', 'Elolvassuk', 'Minden jelentkezést egy manager néz át. Nincs automata szűrő.'],
                      ['02', 'Behívunk', 'Ha jó az illeszkedés, telefonon keresünk és behívunk egy estére.'],
                      ['03', 'Próbaműszak', 'Egy közös műszak. Utána mindkét fél eldönti, hogy akarja-e.']
                    ].map(([no, title, body]) => (
                      <li key={no} className="flex gap-3.5">
                        <span className="font-heading text-[18px] leading-none text-[rgba(227,40,78,0.55)]">{no}</span>
                        <div>
                          <strong className="block text-[10px] tracking-[0.16em] text-white">{title}</strong>
                          <p className="mt-1.5 text-[10px] leading-[1.7] text-[#8d8584]">{body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
};
