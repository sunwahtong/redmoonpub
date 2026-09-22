import React, {useState} from 'react';
import {DoorClosed, DoorOpen, UserPlus, Users} from 'lucide-react';
import {NeonHeading} from '../../components/ui/NeonHeading';
import {Btn, BtnLink} from '../../components/ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend, formatHuf, formatTime} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {useAuthStore} from '../../stores/useAuthStore';

interface Shift {
  id: string;
  status: 'open' | 'closed';
  startedAt: string;
  startedByName: string;
  startedById: string;
  members: string[];
  memberIds: string[];
  openingCash: number;
  revenue?: number;
  salesCount?: number;
  items?: number;
}

interface Member {
  id: string;
  name: string;
  nickname: string;
  role: string;
}

export const ShiftPage: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const {data: current, refresh} = useLiveData<{shift: Shift | null}>('/api/shifts/current', {intervalMs: 15000});
  const {data: memberData} = useLiveData<{users: Member[]}>('/api/shifts/available-members', {intervalMs: 0});

  const shift = current?.shift || null;
  const members = memberData?.users || [];

  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<{kind: 'ok' | 'error'; text: string} | null>(null);

  const run = async (action: () => Promise<unknown>, okText: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({kind: 'ok', text: okText});
      playSfx('success');
      refresh();
    } catch (err) {
      setMessage({kind: 'error', text: (err as Error).message});
      playSfx('error');
    }
  };

  const openShift = (event: React.FormEvent) => {
    event.preventDefault();
    run(
      () =>
        apiSend('/api/shifts/open', 'POST', {
          openingCash: Number(openingCash) || 0,
          memberIds: picked,
          notes
        }),
      'Műszak megnyitva.'
    );
  };

  const closeShift = (event: React.FormEvent) => {
    event.preventDefault();
    run(async () => {
      await apiSend('/api/shifts/close', 'POST', {closingCash: Number(closingCash), notes});
      setClosingCash('');
      setNotes('');
    }, 'Műszak lezárva.');
  };

  const addMember = (userId: string) =>
    run(() => apiSend('/api/shifts/members', 'POST', {userId}), 'Tag hozzáadva.');

  const field =
    'w-full border border-white/10 bg-black/50 p-3 text-xs tracking-wider text-white outline-none transition-colors focus:border-[color:var(--rm-red)]';

  const inShift = !!shift && !!user && shift.memberIds?.includes(user.id);

  return (
    <main>
      <section className="rm-section">
        <div className="rm-label">RED MOON / MŰSZAK</div>
        <NeonHeading as="h1" size={2} className="mb-10 mt-3.5">
          {shift ? (
            <>
              Nyitott <em>műszak.</em>
            </>
          ) : (
            <>
              Nincs nyitott <em>műszak.</em>
            </>
          )}
        </NeonHeading>

        {message && (
          <p className={`mb-6 text-[11px] ${message.kind === 'ok' ? 'text-emerald-400' : 'text-[color:var(--rm-red)]'}`}>
            {message.text}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {shift ? (
            <>
              <div className="rm-card p-7">
                <span className="rm-label">AKTUÁLIS</span>
                <h2 className="mb-5 mt-2 font-heading text-[22px] text-white">{shift.id}</h2>

                <dl className="flex flex-col gap-3 text-[11px]">
                  {[
                    ['Nyitotta', shift.startedByName],
                    ['Nyitás', formatTime(shift.startedAt)],
                    ['Kezdő kassza', formatHuf(shift.openingCash)],
                    ['Eladások', String(shift.salesCount ?? 0)],
                    ['Bevétel', formatHuf(shift.revenue ?? 0)]
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between border-b border-white/[0.04] pb-2">
                      <dt className="text-[#777]">{label}</dt>
                      <dd className="text-white">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-6">
                  <span className="flex items-center gap-2 text-[8px] tracking-[0.25em] text-[#777]">
                    <Users size={11}/> TAGOK
                  </span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {shift.members.map((member) => (
                      <span key={member} className="border border-white/10 px-3 py-1.5 text-[10px] text-white">
                        {member}
                      </span>
                    ))}
                  </div>
                </div>

                {inShift && (
                  <div className="mt-6">
                    <BtnLink to="/staff/register" variant="red">
                      KASSZA MEGNYITÁSA ↗
                    </BtnLink>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3.5">
                <form onSubmit={closeShift} className="rm-card flex flex-col gap-3.5 p-7">
                  <span className="rm-label">ZÁRÁS</span>
                  <h2 className="mb-1 font-heading text-[22px] text-white">Műszak lezárása</h2>
                  <p className="mb-2 text-[10px] leading-[1.7] text-[#8d8584]">
                    Csak a műszak indítója, üzletvezető vagy tulajdonos zárhat.
                  </p>

                  <label className="flex flex-col gap-2">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">ZÁRÓ KASSZA (FT)</span>
                    <input
                      type="number"
                      min={0}
                      value={closingCash}
                      onChange={(event) => setClosingCash(event.target.value)}
                      required
                      className={field}
                    />
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-[8px] tracking-[0.25em] text-[#777]">MEGJEGYZÉS</span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={2}
                      className={field}
                    />
                  </label>

                  <Btn type="submit" variant="red" className="mt-2 justify-center">
                    <DoorClosed size={13}/> MŰSZAK ZÁRÁSA
                  </Btn>
                </form>

                <div className="rm-card p-7">
                  <span className="rm-label">TAG HOZZÁADÁSA</span>
                  <div className="mt-4 flex flex-col gap-2">
                    {members
                      .filter((member) => !shift.memberIds?.includes(member.id))
                      .map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => addMember(member.id)}
                          className="flex items-center justify-between border border-white/[0.06] px-4 py-2.5 text-left text-[11px] text-white transition-colors hover:border-[color:var(--rm-red)]"
                        >
                          <span>
                            {member.name}
                            <span className="ml-2 text-[9px] text-[#777]">{member.role}</span>
                          </span>
                          <UserPlus size={12} className="text-[color:var(--rm-red)]"/>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={openShift} className="rm-card flex flex-col gap-3.5 p-7 lg:col-span-2">
              <span className="rm-label">NYITÁS</span>
              <h2 className="mb-1 font-heading text-[22px] text-white">Műszak nyitása</h2>

              <label className="flex flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">KEZDŐ KASSZA (FT)</span>
                <input
                  type="number"
                  min={0}
                  value={openingCash}
                  onChange={(event) => setOpeningCash(event.target.value)}
                  required
                  className={field}
                />
              </label>

              <span className="mt-2 text-[8px] tracking-[0.25em] text-[#777]">MŰSZAK TAGJAI</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {members.map((member) => {
                  const active = picked.includes(member.id) || member.id === user?.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      disabled={member.id === user?.id}
                      onClick={() =>
                        setPicked((current) =>
                          current.includes(member.id)
                            ? current.filter((id) => id !== member.id)
                            : [...current, member.id]
                        )
                      }
                      className={`flex items-center justify-between border px-4 py-2.5 text-left text-[11px] transition-all ${
                        active
                          ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)] text-white'
                          : 'border-white/10 text-[#8f8887] hover:border-white/30 hover:text-white'
                      }`}
                    >
                      <span>{member.name}</span>
                      <span className="text-[9px] text-[#777]">
                        {member.id === user?.id ? 'TE' : member.role}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label className="mt-2 flex flex-col gap-2">
                <span className="text-[8px] tracking-[0.25em] text-[#777]">MEGJEGYZÉS</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className={field}
                />
              </label>

              <Btn type="submit" variant="red" className="mt-2 justify-center">
                <DoorOpen size={13}/> MŰSZAK NYITÁSA
              </Btn>
            </form>
          )}
        </div>
      </section>
    </main>
  );
};
