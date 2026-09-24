import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {ArrowLeft, ArrowRight, Check, X} from 'lucide-react';
import {apiSend} from '../../lib/api';
import {isConsolePath} from '../../lib/navigation';
import {playSfx} from '../../lib/sfx';
import {pendingModules, TOUR_MODULES, type TourModule} from '../../lib/tour';
import {useAuthStore, type AuthUser} from '../../stores/useAuthStore';
import {dialog, useDialogStore} from '../../stores/useDialogStore';
import {toast} from '../../stores/useToastStore';
import {useTourStore} from '../../stores/useTourStore';

/** How long a lazy page gets to render its target before the card gives up and sits centred. */
const FIND_TRIES = 28;
const FIND_EVERY_MS = 150;
const PAD = 10;
const CARD_WIDTH = 380;
const CARD_HEIGHT = 270;

/**
 * The guided tour, mounted once.
 *
 * Starts by itself the first time an account opens the console with modules
 * it has not seen, and whenever a promotion or a new job adds one. Walks
 * page by page: navigates to the step's page, waits for its target to
 * render, scrolls it into view and lights it up under a card that explains
 * it. Every finished module is recorded on the account; skipping records
 * the rest as skipped, after a warning. The profile page replays any module.
 */
export const TourHost: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const dialogsOpen = useDialogStore((state) => state.queue.length);
  const {active, modules, moduleIndex, stepIndex, replay, start, go, stop} = useTourStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const busy = useRef(false);

  const module = active ? TOUR_MODULES[modules[moduleIndex]] : null;
  const step = module ? module.steps[stepIndex] : null;

  /* First visit, or a rank that grew: bring up what is due. Waits until the
     console is open, no dialog is up and the signature studio is not in use. */
  useEffect(() => {
    if (!user || active || dialogsOpen) return;
    if (user.mustChangePassword || !user.phone) return;
    if (!isConsolePath(location.pathname) || location.hash === '#alairas') return;
    const pending = pendingModules(user);
    if (!pending.length) return;
    const key = `rm-tour:${user.id}:${pending.join(',')}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    start(pending, false);
  }, [user, active, dialogsOpen, location.pathname, location.hash, start]);

  /* Signing out ends the tour. */
  useEffect(() => {
    if (!user && active) stop();
  }, [user, active, stop]);

  /* Go where the step lives. */
  useEffect(() => {
    if (!step) return;
    setReady(false);
    setRect(null);
    if (location.pathname !== step.path) navigate(step.path);
    // The path is read once per step on purpose: a page that redirects is left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, navigate]);

  /* Find the target once the page has rendered it, then follow it. */
  useEffect(() => {
    if (!step || location.pathname !== step.path) return;
    let cancelled = false;
    let tries = 0;
    let timer = 0;
    let frame = 0;

    const find = (): Element | null => {
      if (!step.target) return null;
      const exact = document.querySelector(`[data-tour="${step.target}"]`);
      if (exact) return exact;
      return step.target === 'page' ? document.querySelector('main h1') : null;
    };

    const follow = (element: Element) => {
      if (cancelled) return;
      setRect(element.getBoundingClientRect());
      frame = window.requestAnimationFrame(() => follow(element));
    };

    const poll = () => {
      if (cancelled) return;
      const element = find();
      if (element) {
        element.scrollIntoView({block: 'center', inline: 'nearest'});
        setReady(true);
        follow(element);
        return;
      }
      tries += 1;
      if (!step.target || tries > FIND_TRIES) {
        setReady(true);
        setRect(null);
        return;
      }
      timer = window.setTimeout(poll, FIND_EVERY_MS);
    };

    timer = window.setTimeout(poll, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [step, location.pathname]);

  const record = useCallback(
    async (id: TourModule, status: 'done' | 'skipped') => {
      // A replay never marks anything skipped; finishing one counts, though.
      if (replay && status === 'skipped') return;
      try {
        const reply = await apiSend<{user: AuthUser}>('/api/profile/tour', 'POST', {module: id, status});
        if (reply.user) setUser(reply.user);
      } catch {
        /* the walk goes on; the account keeps the module pending */
      }
    },
    [replay, setUser]
  );

  const finish = useCallback(
    (done: boolean) => {
      stop();
      if (done) {
        playSfx('success');
        toast.success('Bemutató kész.', 'A profilodon bármikor újranézheted.');
      }
    },
    [stop]
  );

  const advance = useCallback(async () => {
    if (!module || busy.current) return;
    if (stepIndex + 1 < module.steps.length) {
      go(moduleIndex, stepIndex + 1);
      playSfx('ui_click');
      return;
    }
    busy.current = true;
    await record(module.id, 'done');
    busy.current = false;
    if (moduleIndex + 1 < modules.length) go(moduleIndex + 1, 0);
    else finish(true);
  }, [module, modules.length, moduleIndex, stepIndex, go, record, finish]);

  const back = useCallback(() => {
    if (!module) return;
    if (stepIndex > 0) go(moduleIndex, stepIndex - 1);
    else if (moduleIndex > 0) go(moduleIndex - 1, TOUR_MODULES[modules[moduleIndex - 1]].steps.length - 1);
    playSfx('ui_click');
  }, [module, modules, moduleIndex, stepIndex, go]);

  const skip = useCallback(async () => {
    if (!module || busy.current) return;
    const sure = await dialog.confirm({
      title: 'Kihagyod a bemutatót?',
      message: replay
        ? 'A bemutató itt megáll. A profilodon bármikor újraindíthatod.'
        : 'A hátralévő részeket nem mutatjuk meg még egyszer magától. A profilodon később bármikor újranézheted — részenként, vagy az egészet elölről.',
      confirmLabel: 'KIHAGYOM',
      cancelLabel: 'FOLYTATOM',
      tone: 'danger'
    });
    if (!sure) return;
    busy.current = true;
    for (const id of modules.slice(moduleIndex)) await record(id, 'skipped');
    busy.current = false;
    finish(false);
  }, [module, modules, moduleIndex, replay, record, finish]);

  /* Keys: → / Enter step, ← back, Esc skip. Not while a dialog has the keyboard. */
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (dialogsOpen) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        advance();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        skip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, dialogsOpen, advance, back, skip]);

  if (!active || !module || !step) return null;

  const total = module.steps.length;
  const last = stepIndex + 1 === total;
  const lastModule = moduleIndex + 1 === modules.length;
  const first = stepIndex === 0 && moduleIndex === 0;
  const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;

  /* The card sits under the light, or above it when there is no room below. */
  let cardStyle: React.CSSProperties = {left: '50%', top: '50%', transform: 'translate(-50%, -50%)'};
  if (rect) {
    const cardWidth = Math.min(CARD_WIDTH, width - 24);
    const left = Math.max(12, Math.min(rect.left - PAD, width - cardWidth - 12));
    const below = rect.bottom + PAD + 14;
    const above = rect.top - PAD - 14 - CARD_HEIGHT;
    const top = below + CARD_HEIGHT <= height - 12 ? below : above >= 12 ? above : Math.max(12, height - CARD_HEIGHT - 12);
    cardStyle = {left, top, width: cardWidth};
  }

  return (
    <div className={`rm-tour${ready ? ' is-ready' : ''}`} role="dialog" aria-modal="true" aria-label={`Bemutató: ${module.label}`}>
      {rect ? (
        <div
          className="rm-tour-spot"
          style={{left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2}}
          aria-hidden="true"
        />
      ) : (
        <div className="rm-tour-dim" aria-hidden="true"/>
      )}

      <div className="rm-tour-card" style={cardStyle}>
        <div className="rm-tour-head">
          <span className="rm-label">
            {module.label} · {stepIndex + 1}/{total}
          </span>
          {modules.length > 1 && (
            <span className="rm-tour-module">
              {moduleIndex + 1}. rész a {modules.length}-ből
            </span>
          )}
        </div>
        <h3 className="rm-tour-title">{step.title}</h3>
        <p className="rm-tour-text">{step.text}</p>
        <div className="rm-tour-bar" aria-hidden="true">
          <i style={{width: `${((stepIndex + 1) / total) * 100}%`}}/>
        </div>
        <div className="rm-tour-actions">
          <button type="button" onClick={skip} className="rm-tour-skip">
            <X size={11}/> KIHAGYOM
          </button>
          <span className="flex-1"/>
          <button type="button" onClick={back} disabled={first} className="rm-tour-btn">
            <ArrowLeft size={11}/> VISSZA
          </button>
          <button type="button" onClick={advance} className="rm-tour-btn is-red">
            {last ? (lastModule ? <>KÉSZ <Check size={11}/></> : <>KÖVETKEZŐ RÉSZ <ArrowRight size={11}/></>) : <>TOVÁBB <ArrowRight size={11}/></>}
          </button>
        </div>
      </div>
    </div>
  );
};
