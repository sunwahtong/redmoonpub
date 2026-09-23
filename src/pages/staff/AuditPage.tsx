import React, {useMemo, useState} from 'react';
import {ScrollText} from 'lucide-react';
import {Chips, PageHeader, Panel, SearchField} from '../../components/ui/console';
import {Btn} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {formatAgo, formatDate, formatTime} from '../../lib/api';

interface AuditEntry {
  id: string;
  at: string;
  user: string;
  role: string;
  action: string;
  details: string;
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Actions that change money, stock or access get a red marker. */
const SENSITIVE = /(DELETE|RESET|PASSWORD|ROLE|FINANCE|INVENTORY|SHIFT_CLOSE|USER_|FORCE_LOGOUT|BAN)/;

/** The log is read by area, not by action name. */
const AREAS: {id: string; label: string; test: RegExp}[] = [
  {id: 'all', label: 'MINDEN', test: /./},
  {id: 'session', label: 'BELÉPÉS', test: /^(LOGIN|LOGOUT|SESSION|PASSWORD|PHONE|FORCE_LOGOUT)/},
  {id: 'money', label: 'KASSZA', test: /^(SALE|RECEIPT|INVOICE|DOCUMENT|OVERALL|FINANCE)/},
  {id: 'shift', label: 'MŰSZAK', test: /^(SHIFT|PUB_|STAFF_ACTIVITY)/},
  {id: 'stock', label: 'KÉSZLET', test: /^(PRODUCT|INVENTORY|RESTOCK|ORDER)/},
  {id: 'guests', label: 'VENDÉG', test: /^(RESERVATION|APPLICATION|REVIEW)/},
  {id: 'club', label: 'KLUB', test: /^DJ_/},
  {id: 'house', label: 'HÁZ', test: /^(EVENT|HOUSE|SIGNATURE|GALLERY|MAP_BLIP|USER_)/}
];

const PAGE = 80;

export const AuditPage: React.FC = () => {
  const {data} = useLiveData<{audit: AuditEntry[]}>('/api/audit', {intervalMs: 30000, topics: ['staff', 'content', 'house']});
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [limit, setLimit] = useState(PAGE);

  const entries = useMemo(() => data?.audit || [], [data]);

  const counts = useMemo(() => Object.fromEntries(AREAS.map((entry) => [entry.id, entries.filter((row) => entry.test.test(row.action)).length])), [entries]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const test = AREAS.find((entry) => entry.id === area)?.test || /./;
    return entries.filter((entry) => test.test(entry.action) && (!needle || normalize(`${entry.user} ${entry.action} ${entry.details}`).includes(needle)));
  }, [entries, query, area]);

  /** Same day as the previous line: no new date heading. */
  const dayOf = (value: string) => formatDate(value);

  return (
    <main>
      <section className="rm-section">
        <PageHeader
          kicker="RED MOON / NAPLÓ"
          title={
            <>
              Az <em>auditnapló.</em>
            </>
          }
          lead="Minden művelet, aki csinálta, és mikor. A pirossal jelöltek pénzt, készletet vagy hozzáférést érintenek."
        />

        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SearchField value={query} onChange={setQuery} placeholder="FELHASZNÁLÓ, MŰVELET VAGY RÉSZLET…" className="lg:max-w-sm"/>
          <Chips value={area} onChange={(value) => setArea(value)} options={AREAS.map((entry) => ({id: entry.id, label: entry.label, count: counts[entry.id] || 0}))}/>
        </div>

        <Panel padded={false} label={`BEJEGYZÉSEK (${visible.length})`} action={<ScrollText size={13} className="text-[#777]"/>}>
          {!visible.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs találat.</p>}

          {visible.slice(0, limit).map((entry, index, list) => {
            const newDay = index === 0 || dayOf(entry.at) !== dayOf(list[index - 1].at);
            const sensitive = SENSITIVE.test(entry.action);
            return (
              <React.Fragment key={entry.id}>
                {newDay && (
                  <div className="sticky top-[112px] z-[1] border-b border-white/[0.06] bg-[#0a0a0c]/95 px-6 py-2 text-[8px] tracking-[0.3em] text-[#6f6968] backdrop-blur-sm">{dayOf(entry.at).toUpperCase()}</div>
                )}
                <div className={`flex gap-4 border-b border-white/[0.04] px-6 py-3 ${sensitive ? 'border-l-2 border-l-[color:var(--rm-red)]' : ''}`}>
                  <span className="w-14 shrink-0 text-[9px] tabular-nums text-[#6d5d64]" title={formatDate(entry.at)}>
                    {formatTime(entry.at)}
                    <span className="block text-[8px] text-[#4f4a4a]">{formatAgo(entry.at)}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className={`text-[10px] tracking-[0.12em] ${sensitive ? 'text-[color:var(--rm-red)]' : 'text-white'}`}>{entry.action}</strong>
                    <p className="mt-1 break-words text-[11px] leading-[1.6] text-[#8d8584]">{entry.details}</p>
                  </div>
                  <span className="w-28 shrink-0 text-right text-[9px] text-[#777]">
                    {entry.user}
                    <span className="block text-[8px] uppercase tracking-[0.15em] text-[#5f5959]">{entry.role}</span>
                  </span>
                </div>
              </React.Fragment>
            );
          })}

          {visible.length > limit && (
            <div className="flex justify-center border-t border-white/[0.06] px-6 py-4">
              <Btn onClick={() => setLimit((value) => value + PAGE)} className="!px-4 !py-2.5 !text-[8px]">
                TOVÁBBI {Math.min(PAGE, visible.length - limit)} BEJEGYZÉS
              </Btn>
            </div>
          )}
        </Panel>
      </section>
    </main>
  );
};
