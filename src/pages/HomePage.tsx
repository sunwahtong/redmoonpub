import React, {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight} from 'lucide-react';
import {SectionHead} from '../components/ui/SectionHead';
import {NeonHeading} from '../components/ui/NeonHeading';
import {Btn, BtnAnchor, BtnLink} from '../components/ui/Btn';
import {Reveal} from '../components/ui/Reveal';
import {TiltCard} from '../components/ui/TiltCard';
import {CountUp} from '../components/ui/CountUp';
import {Magnetic} from '../components/ui/Magnetic';
import {Embers} from '../components/effects/Embers';
import {Starfield} from '../components/effects/Starfield';
import {SignatureTitle} from '../components/hero/SignatureTitle';
import {TonightBar} from '../components/home/TonightBar';
import {CountdownUnits, EventCard} from '../components/events/EventCard';
import {LeaderCard} from '../components/about/LeaderCard';
import {useLiveData} from '../hooks/useLiveData';
import {backgroundImage} from '../lib/media';
import {useHouseStatus} from '../hooks/useHouseStatus';
import {apiSend, assetUrl, getVisitorToken} from '../lib/api';
import {MEMBERSHIP} from '../lib/content';
import {Skeleton} from '../components/ui/Skeleton';
import type {GalleryItem, PublicHouse, RedMoonEvent, Review, SignatureDrink} from '../types';

const PHONE_PREFIX = '+38-76-';
const REVIEW_MAX_CHARS = 140;
const TICKER_TEXT = 'PRÉMIUM ITALOK · VÖRÖS FÉNYEK · ZENE · ELEGANCIA · ÉJSZAKAI ÉLMÉNY ·';

export const HomePage: React.FC = () => {
  const {data: drinkData} = useLiveData<{drinks: SignatureDrink[]}>('/api/public-signature-drinks');
  const {data: eventData} = useLiveData<{events: RedMoonEvent[]}>('/api/public-events', {intervalMs: 45000});
  const {data: reviewData, refresh: refreshReviews} = useLiveData<{
    reviews: Review[];
    average: number;
    count: number;
  }>('/api/reviews');
  const {data: houseData} = useLiveData<PublicHouse>('/api/public/house', {intervalMs: 0, topics: ['content']});
  const {data: galleryData} = useLiveData<{items: GalleryItem[]}>('/api/public/gallery', {intervalMs: 0, topics: ['content']});
  const shots = (galleryData?.items || []).slice(0, 8);
  const {data: house} = useHouseStatus(20000);
  const leaders = (houseData?.people || []).filter((person) => person.tier === 'owner' || person.tier === 'co-owner');

  const [rating, setRating] = useState(5);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{kind: 'ok' | 'error'; message: string} | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const drinks = drinkData?.drinks || [];
  const reviews = reviewData?.reviews || [];

  /**
   * `/api/public-events` returns every active event sorted ascending, past ones
   * included — taking `events[0]` would advertise an evening that already
   * happened. Only look at what is still ahead of us.
   */
  const nextEvent = useMemo(() => {
    const now = Date.now();
    const events = eventData?.events || [];
    return (
      events.find((event) => event.featured && new Date(event.startsAt).getTime() >= now) ||
      events.find((event) => new Date(event.startsAt).getTime() >= now) ||
      null
    );
  }, [eventData]);

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const digits = value.startsWith(PHONE_PREFIX)
      ? value.slice(PHONE_PREFIX.length).replace(/\D/g, '').slice(0, 7)
      : '';
    setPhone(PHONE_PREFIX + digits);
  };

  const handleReviewSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setStatus(null);

    try {
      const visitorToken = getVisitorToken();
      await apiSend(
        '/api/reviews',
        'POST',
        {name, rating, text, phone, visitorToken},
        {'X-Review-Token': visitorToken}
      );

      setStatus({kind: 'ok', message: 'Köszönjük a visszajelzést!'});
      setName('');
      setText('');
      setPhone(PHONE_PREFIX);
      setRating(5);
      refreshReviews();
    } catch (err) {
      setStatus({kind: 'error', message: (err as Error).message});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main>
      {/* 1. HERO — cinematic backdrop, fog, drifting grid, neon sky, signature mark */}
      <section className="rm-hero">
        <div className="rm-hero-media" aria-hidden="true"/>
        <div className="rm-hero-fog" aria-hidden="true"/>
        <div className="rm-hero-grid" aria-hidden="true"/>
        <Starfield/>

        <div className="rm-hero-content">
          <div className="rm-label">SEE CITY · NIGHTLIFE · 001</div>

          <SignatureTitle/>

          <p className="max-w-[570px] text-[15px] leading-[1.8] text-[#c3bdbc]">
            Egy prémium bár, ahol a város zaja elhalkul. Válogatott italok, vörös fények, karakteres zene és esték,
            amelyekből emlék lesz.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Magnetic strength={11}>
              <BtnLink to="/reservations" variant="red">
                ASZTALT FOGLALOK <span>↗</span>
              </BtnLink>
            </Magnetic>
            <BtnLink to="/menu">FELFEDEZEM ↗</BtnLink>
            <BtnAnchor href="#tonight">MA ESTE A RED MOONBAN ↓</BtnAnchor>
          </div>

          {/* The door and the next evening, right where the eye lands. */}
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
            {house && (
              <span className={`rm-door-chip ${house.open ? 'is-open' : 'is-closed'}${house.live ? ' is-live' : ''}`}>
                <span className="rm-door-dot" aria-hidden="true"/>
                {house.open ? 'MOST NYITVA' : 'MOST ZÁRVA'}
                {house.live && <span className="text-[color:var(--rm-red)]">· LIVE DJ</span>}
              </span>
            )}
            {nextEvent && (
              <Link to="/events" className="group flex flex-wrap items-center gap-4">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">
                  KÖVETKEZŐ ESTE
                  <b className="ml-2 font-heading text-[12px] tracking-wide text-white transition-colors group-hover:text-[color:var(--rm-red-bright)]">
                    {nextEvent.title}
                  </b>
                </span>
                <CountdownUnits startsAt={nextEvent.startsAt}/>
              </Link>
            )}
          </div>
        </div>

        <div className="rm-hero-scroll" aria-hidden="true">FEDEZD FEL</div>
      </section>

      {/* NEON TICKER */}
      <div className="rm-ticker" aria-label="Red Moon ticker">
        <div className="rm-ticker-line" aria-hidden="true"/>
        <div className="rm-ticker-track">
          {[0, 1].map((copy) => (
            <span key={copy} aria-hidden={copy === 1}>
              RED <b>MOON</b> · 夜 · {TICKER_TEXT}&nbsp;
            </span>
          ))}
        </div>
      </div>

      <TonightBar/>

      {/* 2. NEM CSAK EGY KOCSMA */}
      <section className="rm-section">
        <div className="grid grid-cols-1 items-center gap-[9vw] lg:grid-cols-2">
          <Reveal>
            {/* Legacy .rm17-story-art: full-bleed still, 月 watermark, corner caption */}
            <div style={backgroundImage('/assets/red-moon-cinematic.png')} className="relative min-h-[470px] overflow-hidden border border-[color:var(--rm-line)] bg-cover bg-center lg:min-h-[570px]">
              <span className="pointer-events-none absolute right-8 top-4 font-heading text-[120px] leading-none text-[rgba(213,31,60,0.35)]">
                月
              </span>
              <span className="absolute bottom-6 left-6 text-[8px] tracking-[0.25em] text-[#ddd]">
                RED MOON / AFTER DARK
              </span>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="text-left">
              <div className="rm-label">01 / A RED MOON ÉLMÉNY</div>
              <NeonHeading as="h2" className="mb-6 mt-3.5">
                Nem csak egy
                <br/>
                <em>kocsma.</em>
              </NeonHeading>

              <p className="mb-4 leading-[1.95] text-[#9e9795]">
                A Red Moon SeeCity éjszakájának elegáns menedéke. Érkezz meg, válassz egy italt, és add át magad annak a
                hangulatnak, amiért érdemes maradni.
              </p>
              <p className="leading-[1.95] text-[#9e9795]">
                Az ázsiai ihletés a részletekben él: a fényekben, a kiszolgálásban, az italokban és abban a gondosan
                felépített atmoszférában, amely összetéveszthetetlenül Red Moon.
              </p>

              <div className="rm-rule my-9"/>

              <div className="grid grid-cols-3 gap-3">
                {[
                  {value: 4, suffix: '', label: 'TAGSÁGI SZINT'},
                  {value: 24, suffix: '/7', label: 'AZ ÉJSZAKÁNAK'},
                  {value: 100, suffix: '%', label: 'SAJÁT RECEPTÚRA'}
                ].map((stat) => (
                  <div key={stat.label} className="border border-[color:var(--rm-line)] bg-[#09090b] p-[22px]">
                    <strong className="block font-heading text-[30px] text-white">
                      <CountUp to={stat.value} suffix={stat.suffix}/>
                    </strong>
                    <span className="mt-2 block text-[8px] tracking-[0.18em] text-[#777]">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 3. MA ESTE */}
      <section id="tonight" className="rm-section scroll-mt-24">
        <SectionHead
          label="02 / MA ESTE"
          title={
            <>
              Az este
              <br/>
              <em>most kezdődik.</em>
            </>
          }
          aside={<BtnLink to="/events">MINDEN EVENT ↗</BtnLink>}
        />

        {nextEvent ? (
          <EventCard event={nextEvent} phase="upcoming" featured/>
        ) : (
          <div className="flex flex-col items-start justify-between gap-6 border-y border-[#35151c] bg-gradient-to-r from-[#12070a] to-[#08080a] p-10 md:flex-row md:items-center">
            <div>
              <div className="rm-label">KÖVETKEZŐ ESTE · RED MOON</div>
              <NeonHeading as="h3" className="mt-3">
                Hamarosan új esemény.
              </NeonHeading>
              <p className="rm-lead mt-3 text-sm">Az új rendezvény automatikusan itt jelenik meg.</p>
            </div>
            <BtnLink to="/events" variant="red">
              RÉSZLETEK ↗
            </BtnLink>
          </div>
        )}
      </section>

      {/* 4. SIGNATURE ITALOK */}
      {drinks.length > 0 && (
        <section className="rm-section">
          <SectionHead
            label="03 / AZ ITALLAPRÓL"
            title={
              <>
                Signature
                <br/>
                <em>italok.</em>
              </>
            }
            aside={<BtnLink to="/menu">TELJES ITALLAP ↗</BtnLink>}
          />

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {drinks.map((drink, index) => (
              <Reveal key={drink.id} delay={index * 90} className="h-full">
                <TiltCard className="h-full" max={8}>
                  <article className="rm-card group h-full overflow-hidden p-7 text-left">
                    <span className="rm-glyph">月</span>
                    <div className="rm-tilt-layer relative z-[1] text-[8px] tracking-[0.2em] text-[#777]">
                      0{drink.slot} / SIGNATURE
                    </div>

                    <div className="rm-tilt-layer relative my-6 flex h-44 items-center justify-center">
                      <div
                        className="absolute h-28 w-28 rounded-full bg-[rgba(213,31,60,0.28)] blur-2xl transition-transform duration-500 group-hover:scale-125"
                        aria-hidden="true"
                      />
                      {drink.image && (
                        <img
                          src={assetUrl(drink.image)}
                          alt={drink.name}
                          loading="lazy"
                          className="z-10 max-h-40 object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:scale-105"
                        />
                      )}
                    </div>

                    <div className="rm-tilt-layer relative z-[1]">
                      <span className="text-[8px] tracking-[0.2em] text-[color:var(--rm-red)]">RED MOON SELECTION</span>
                      <h4 className="mb-2 mt-2 font-heading text-[26px] leading-none text-white">{drink.name}</h4>
                      <p className="text-[11px] leading-[1.7] text-[#938b8b]">{drink.description}</p>
                    </div>
                  </article>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </section>
      )}

      {/* 5. RED MOON KÖZÖSSÉG */}
      <section className="border-y border-[color:var(--rm-line)] bg-[#070709]">
        <div className="rm-section">
          <SectionHead
            label="04 / A HÁZ"
            title={
              <>
                Red Moon
                <br/>
                <em>közösség.</em>
              </>
            }
            aside={<BtnLink to="/vip">A TELJES HOUSE ↗</BtnLink>}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MEMBERSHIP.map((tier, index) => (
              <Reveal key={tier.id} delay={index * 80} className="h-full">
                <TiltCard className="h-full" max={6}>
                  <article data-tier={tier.id} className="rm-tier h-full min-h-[210px] p-7 text-left">
                    <span className="rm-tier-glyph" aria-hidden="true">
                      {tier.glyph}
                    </span>
                    <div className="rm-tilt-layer relative">
                      <span className="text-[8px] tracking-[0.2em] text-[#777]">{tier.no}</span>
                      <span className="rm-tier-crest mb-3 mt-2 block">{tier.name}</span>
                      <p className="text-[10px] leading-[1.8] text-[#827b7a]">{tier.tagline}</p>
                    </div>
                  </article>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* 5b. KÉT AJTÓ — the page's two conversions, side by side */}
      <section className="relative overflow-hidden border-b border-[color:var(--rm-line)]">
        <Embers density={44}/>
        <div className="relative z-[2] grid grid-cols-1 lg:grid-cols-2">
          {[
            {
              to: '/reservations',
              kicker: 'VENDÉGKÉNT',
              glyph: '席',
              title: <>Az asztalod <em>vár.</em></>,
              body: 'Korlátozott számú asztal, minden estére. Foglalj percek alatt — regisztráció nélkül.',
              action: 'FOGLALÁS INDÍTÁSA',
              primary: true
            },
            {
              to: '/careers',
              kicker: 'A PULT MÖGÖTT',
              glyph: '募',
              title: <>Dolgozz <em>a házban.</em></>,
              body: 'A csapat egyesével állt össze. Ha szeretnél része lenni az estének, itt tudsz szólni.',
              action: 'NYITOTT POZÍCIÓK',
              primary: false
            }
          ].map((door) => (
            <Link
              key={door.to}
              to={door.to}
              className="group relative flex flex-col justify-between gap-10 overflow-hidden border-b border-[color:var(--rm-line)] px-[8vw] py-[clamp(58px,6vw,92px)] transition-colors hover:bg-[rgba(227,40,78,0.04)] lg:border-b-0 lg:border-r lg:px-[5vw] lg:last:border-r-0"
            >
              <span
                className="pointer-events-none absolute -right-4 -top-6 font-heading text-[150px] leading-none text-[rgba(227,40,78,0.06)] transition-transform duration-700 group-hover:scale-110"
                aria-hidden="true"
              >
                {door.glyph}
              </span>

              <div className="relative">
                <div className="rm-label">RED MOON / {door.kicker}</div>
                <NeonHeading as="h2" size={2} className="mb-4 mt-3.5">
                  {door.title}
                </NeonHeading>
                <p className="max-w-md text-[12px] leading-[1.9] text-[#9e9795]">{door.body}</p>
              </div>

              <span
                className={`relative inline-flex w-fit items-center gap-4 border px-5 py-3.5 text-[9px] font-bold tracking-[0.2em] transition-all ${
                  door.primary
                    ? 'border-[color:var(--rm-red)] bg-[color:var(--rm-red)] text-white group-hover:shadow-[0_14px_40px_rgba(213,31,60,0.35)]'
                    : 'border-white/15 text-white group-hover:border-[color:var(--rm-red)]'
                }`}
              >
                {door.action}
                <ArrowRight size={13} className="transition-transform duration-300 group-hover:translate-x-1"/>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 6. A TULAJDONOSOK */}
      <section className="rm-section">
        <SectionHead
          label="05 / A TULAJDONOSOK"
          title={
            <>
              Akik a Red Moon
              <br/>
              <em>mögött állnak.</em>
            </>
          }
          aside={<BtnLink to="/about">A TELJES CSALÁDFA ↗</BtnLink>}
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {!houseData && <Skeleton className="h-[360px]" count={2}/>}
          {leaders.map((person) => (
            <LeaderCard key={person.id} person={person}/>
          ))}
          {houseData && !leaders.length && (
            <p className="text-[11px] text-[#8d8584]">A ház vezetői hamarosan.</p>
          )}
        </div>
      </section>

      {/* 7. VÉLEMÉNYEK */}
      {shots.length > 0 && (
        <section className="border-t border-[color:var(--rm-line)] bg-[#070709]">
          <div className="rm-section !py-[clamp(48px,6vw,80px)]">
            <SectionHead
              label="06 / PILLANATOK"
              title={
                <>
                  Ahogy az esték
                  <br/>
                  <em>megtörténtek.</em>
                </>
              }
              aside={<BtnLink to="/gallery">A TELJES GALÉRIA ↗</BtnLink>}
            />
            <div className="rm-strip">
              {shots.map((shot) => (
                <Link key={shot.id} to="/gallery" className="rm-strip-tile group">
                  <img src={assetUrl(shot.src)} alt={shot.title} loading="lazy" decoding="async"/>
                  <span>{shot.title}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="rm-section">
        <SectionHead
          label="07 / RED MOON ÉLMÉNYEK"
          title={
            <>
              Amit rólunk
              <br/>
              <em>mondtok.</em>
            </>
          }
          aside={
            reviews.length
              ? `${reviews.length} vélemény · átlag ★ ${(reviewData?.average ?? 0).toFixed(1)}`
              : 'Még nincs vélemény — legyél te az első.'
          }
        />

        {reviews.length > 0 && (
          <div className="mb-14 grid grid-cols-1 gap-3 md:grid-cols-2">
            {reviews.slice(0, 4).map((review, index) => (
              <Reveal key={review.id} delay={index * 70} className="h-full">
                <article className="rm-card h-full p-6 text-left">
                  <div className="mb-3 flex items-center justify-between">
                    <strong className="font-heading text-[17px] text-white">{review.name}</strong>
                    <span className="text-[color:var(--rm-red)]" aria-label={`${review.rating} csillag`}>
                      {'★'.repeat(review.rating)}
                      <span className="text-white/15">{'★'.repeat(5 - review.rating)}</span>
                    </span>
                  </div>
                  <p className="text-[11px] leading-[1.8] text-[#a4949c]">{review.text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        )}

        <div className="mx-auto max-w-[760px] border border-[color:var(--rm-line)] bg-[#09090b] p-8 text-center md:p-12">
          <div className="rm-label">RED MOON / ÉLMÉNYEK</div>
          <NeonHeading as="h3" className="mb-3 mt-3">
            Oszd meg velünk az <em>élményed.</em>
          </NeonHeading>
          <p className="mx-auto mb-9 max-w-md text-[11px] leading-[1.8] text-[#8e7e86]">
            A Red Moon minden este a részletekről szól. Mondd el, milyen élménnyel távoztál tőlünk.
          </p>

          <form onSubmit={handleReviewSubmit} className="mx-auto flex max-w-xl flex-col gap-5">
            <div className="mb-2 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  aria-label={`${star} csillag`}
                  aria-pressed={star === rating}
                  className={`flex h-9 w-9 items-center justify-center border text-sm transition-all ${
                    star <= rating
                      ? 'border-[color:var(--rm-red)] bg-[rgba(227,40,78,0.18)] text-[color:var(--rm-red)] shadow-[0_0_14px_rgba(227,40,78,0.4)]'
                      : 'border-white/10 text-white/30'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="text"
                placeholder="NÉV"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={80}
                className="border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-white/30 focus:border-[color:var(--rm-red)]"
              />
              <input
                type="text"
                value={phone}
                onChange={handlePhoneChange}
                placeholder="TELEFONSZÁM"
                inputMode="numeric"
                className="border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-white/30 focus:border-[color:var(--rm-red)]"
              />
            </div>

            <div className="relative">
              <textarea
                placeholder="VÉLEMÉNY"
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, REVIEW_MAX_CHARS))}
                required
                rows={3}
                className="w-full border border-white/10 bg-black/50 p-3 pb-8 text-xs tracking-wider text-white outline-none transition-colors placeholder:text-white/30 focus:border-[color:var(--rm-red)]"
              />
              <span className="absolute bottom-3 right-3 text-[9px] text-white/30">
                {text.length} / {REVIEW_MAX_CHARS} KARAKTER
              </span>
            </div>

            <Btn type="submit" variant="red" disabled={submitting} className="mx-auto">
              {submitting ? 'KÜLDÉS…' : 'VÉLEMÉNY BEKÜLDÉSE'} <span>↗</span>
            </Btn>

            {status && (
              <p role="status" className={`text-xs ${status.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
                {status.message}
              </p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
};
