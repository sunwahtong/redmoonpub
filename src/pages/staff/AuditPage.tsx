import React, {useMemo, useState} from 'react';
import {ScrollText, Search} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {useLiveData} from '../../hooks/useLiveData';
import {formatDate, formatTime} from '../../lib/api';

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
const SENSITIVE = /(DELETE|RESET|PASSWORD|ROLE|FINANCE|INVENTORY|SHIFT_CLOSE|USER_)/;

export const AuditPage: React.FC = () => {
  const {data} = useLiveData<{audit: AuditEntry[]}>('/api/audit', {intervalMs: 30000});
  const [query, setQuery] = useState('');

  const entries = useMemo(() => data?.audit || [], [data]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return entries;
    return entries.filter((entry) =>
      normalize(`${entry.user} ${entry.action} ${entry.details}`).includes(needle)
    );
  }, [entries, query]);

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / NAPLÓ</div>
        <NeonHeading as="h1" size={2} className="mb-8 mt-3.5">
          Az <em>auditnapló.</em>
        </NeonHeading>

        <label className="relative mb-6 flex w-full items-center sm:max-w-sm">
          <Search size={14} className="absolute left-4 text-[#6d5d64]"/>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="FELHASZNÁLÓ, MŰVELET VAGY RÉSZLET…"
            className="w-full border border-[color:var(--rm-line)] bg-black/50 py-3 pl-10 pr-4 text-[10px] tracking-[0.15em] text-white outline-none focus:border-[color:var(--rm-red)]"
          />
        </label>

        <div className="rm-card p-0">
          <div className="flex items-center justify-between border-b border-[color:var(--rm-line)] px-6 py-4">
            <span className="rm-label">BEJEGYZÉSEK ({visible.length})</span>
            <ScrollText size={13} className="text-[#777]"/>
          </div>

          {!visible.length && <p className="px-6 py-6 text-[11px] text-[#8d8584]">Nincs találat.</p>}

          <div className="max-h-[70vh] overflow-y-auto">
            {visible.map((entry) => (
              <div key={entry.id} className="flex gap-4 border-b border-white/[0.04] px-6 py-3">
                <span className="w-24 shrink-0 text-[9px] tabular-nums text-[#6d5d64]">
                  {formatDate(entry.at).slice(0, 12)}
                  <span className="block">{formatTime(entry.at)}</span>
                </span>

                <div className="min-w-0 flex-1">
                  <strong
                    className={`text-[10px] tracking-[0.12em] ${
                      SENSITIVE.test(entry.action) ? 'text-[color:var(--rm-red)]' : 'text-white'
                    }`}
                  >
                    {entry.action}
                  </strong>
                  <p className="mt-1 break-words text-[11px] leading-[1.6] text-[#8d8584]">{entry.details}</p>
                </div>

                <span className="w-28 shrink-0 text-right text-[9px] text-[#777]">
                  {entry.user}
                  <span className="block text-[8px] uppercase">{entry.role}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
