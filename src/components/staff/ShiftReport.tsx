import React, {useEffect, useState} from 'react';
import {Check, Copy} from 'lucide-react';
import {Btn} from '../ui/Btn';
import {CountUp} from '../ui/CountUp';
import {Embers} from '../effects/Embers';
import {useLiveEvent} from '../../hooks/useLiveData';
import {formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {useAuthStore} from '../../stores/useAuthStore';
import {toast} from '../../stores/useToastStore';
import {useShiftReportStore, type ShiftReport} from '../../stores/useShiftReportStore';

/** A push from a closing names the people it concerns; theirs is fetched. */
const Watcher: React.FC<{userId: string}> = ({userId}) => {
  useLiveEvent('staff', (event, payload) => {
    if (event !== 'shift-closed') return;
    const ids = Array.isArray(payload.userIds) ? (payload.userIds as string[]) : [];
    if (ids.includes(userId)) useShiftReportStore.getState().check();
  });
  return null;
};

const Card: React.FC<{report: ShiftReport; rest: number}> = ({report, rest}) => {
  const done = useShiftReportStore((state) => state.done);
  const snooze = useShiftReportStore((state) => state.snooze);
  const [busy, setBusy] = useState(false);
  const first = report.userName.trim().split(/\s+/)[0] || report.userName;
  const nothing = report.amount <= 0;

  useEffect(() => {
    playSfx('cash_close');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [report.id]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} a vágólapon.`);
      playSfx('ui_click');
    } catch {
      toast.error('Nem sikerült másolni', text);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    await done(report.id);
    setBusy(false);
    playSfx('success');
  };

  return (
    <div className="rm-closing" role="dialog" aria-modal="true" aria-label={`Műszakzárás · ${report.shiftId}`}>
      <div className="rm-closing-backdrop" aria-hidden="true"/>
      <div className="rm-closing-aurora" aria-hidden="true"/>
      <Embers density={30} className="rm-closing-embers"/>

      <div className="rm-closing-card" key={report.id}>
        <span className="rm-closing-corner tl" aria-hidden="true"/>
        <span className="rm-closing-corner br" aria-hidden="true"/>

        <div className="rm-closing-seal" aria-hidden="true">
          <i className="rm-closing-seal-ring"/>
          <span>月</span>
        </div>

        <span className="rm-label rm-closing-line" style={{'--i': 1} as React.CSSProperties}>
          MŰSZAK LEZÁRVA · {report.shiftId}
        </span>
        <h2 className="rm-closing-title rm-closing-line" style={{'--i': 2} as React.CSSProperties}>
          Köszönjük, <em>{first}.</em>
        </h2>
        <p className="rm-closing-meta rm-closing-line" style={{'--i': 3} as React.CSSProperties}>
          Zárás: {report.closingLabel} · {formatTime(report.closedAt)}
          {report.closedByName ? ` · zárta: ${report.closedByName}` : ''}
        </p>

        <div className="rm-closing-amount rm-closing-line" style={{'--i': 4} as React.CSSProperties}>
          <span className="rm-label">TE ENNYIT ADTÁL EL</span>
          <strong>{nothing ? formatHuf(0) : <CountUp to={report.amount} suffix=" Ft" duration={2200}/>}</strong>
          <span className="rm-closing-sub">
            {report.salesCount} eladás · {report.items} tétel
          </span>
        </div>

        <div className="rm-gilt rm-closing-line" style={{'--i': 5} as React.CSSProperties}/>

        <div className="rm-closing-transfer rm-closing-line" style={{'--i': 6} as React.CSSProperties}>
          <span className="rm-label">{nothing ? 'NINCS UTALNIVALÓD' : 'UTALD A HÁZNAK'}</span>
          {nothing ? (
            <p className="rm-closing-hint">Ebben a műszakban nem adtál el semmit, így nincs mit utalnod. Ezt csak a rend kedvéért kapod.</p>
          ) : (
            <>
              <dl className="rm-closing-rows">
                <div>
                  <dt>SZÁMLASZÁM</dt>
                  <dd>
                    <b>{report.transfer.account}</b>
                    <button type="button" onClick={() => copy(report.transfer.account, 'A számlaszám')} aria-label="Számlaszám másolása">
                      <Copy size={11}/>
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>TULAJDONOS</dt>
                  <dd>
                    <b>{report.transfer.owner}</b>
                  </dd>
                </div>
                <div>
                  <dt>KÖZLEMÉNY</dt>
                  <dd>
                    <b className="rm-closing-memo">{report.transfer.memo}</b>
                    <button type="button" onClick={() => copy(report.transfer.memo, 'A közlemény')} aria-label="Közlemény másolása">
                      <Copy size={11}/>
                    </button>
                  </dd>
                </div>
              </dl>
              <p className="rm-closing-hint">A közleményt pontosan így írd be — ebből látjuk, kitől és melyik műszakból érkezett a pénz.</p>
            </>
          )}
        </div>

        <div className="rm-closing-actions rm-closing-line" style={{'--i': 7} as React.CSSProperties}>
          {!nothing && (
            <Btn variant="red" onClick={() => copy(report.transfer.memo, 'A közlemény')}>
              <Copy size={12}/> KÖZLEMÉNY MÁSOLÁSA
            </Btn>
          )}
          <Btn onClick={finish} disabled={busy}>
            <Check size={12}/> MEGNÉZTEM
          </Btn>
          <button type="button" onClick={snooze} className="rm-closing-later">
            KÉSŐBB
          </button>
        </div>

        {rest > 0 && <span className="rm-closing-more">+{rest} további zárás vár rád</span>}
      </div>
    </div>
  );
};

/**
 * The closing report, mounted once. Whoever closes a shift sees theirs at
 * once; everyone else who worked it sees it the moment they are on the
 * site — now if they are, next time if not — and a badge in the console
 * keeps pointing at it until they have opened it.
 */
export const ShiftReportHost: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id || null;
  const queue = useShiftReportStore((state) => state.queue);
  const snoozed = useShiftReportStore((state) => state.snoozed);
  const check = useShiftReportStore((state) => state.check);
  const clear = useShiftReportStore((state) => state.clear);

  useEffect(() => {
    if (userId) check();
    else clear();
  }, [userId, check, clear]);

  /* A tab that was asleep asks again when it wakes. */
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userId, check]);

  if (!userId) return null;
  return (
    <>
      <Watcher userId={userId}/>
      {queue[0] && !snoozed && <Card report={queue[0]} rest={queue.length - 1}/>}
    </>
  );
};
