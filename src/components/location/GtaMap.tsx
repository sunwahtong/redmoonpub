import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import 'gta-v-map';
import type {GtaVMap} from 'gta-v-map';
import L from 'leaflet';
import {ChevronDown, Copy, Crosshair, Link2, Lock, Maximize2, Move, Pencil, Plus, Search, Trash2, X} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Btn} from '../ui/Btn';
import {apiSend} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {dialog} from '../../stores/useDialogStore';
import {toast} from '../../stores/useToastStore';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';
import {BLIP_GROUP_LABEL, BLIP_GROUPS, BLIP_KINDS, BLIP_STYLES, blipMarkerHtml, blipStyle, type BlipKind} from '../../lib/blips';
// Raw text, not a stylesheet link: this gets injected into the shadow root.
import blipStyles from '../../styles/blips.css?inline';

/**
 * Tiles live under map-tiles/ (served at /assets/map). The gta-v-map component builds its URLs as
 * `<tileBaseUrl>/<folder>/{z}/{x}/{y}.<ext>` with folders styleSatelite,
 * styleAtlas and styleGrid. VITE_MAP_TILE_BASE can point elsewhere at build time.
 */
const TILE_BASE_URL = (import.meta.env.VITE_MAP_TILE_BASE || '/assets/map').replace(/\/+$/, '');
/** A tile that must exist if the tile pack was extracted correctly. */
const TILE_PROBE = `${TILE_BASE_URL}/styleAtlas/0/0/0.jpg`;

export interface Blip {
  id: string;
  x: number;
  y: number;
  kind: BlipKind;
  icon: number;
  label: string;
  description: string;
  group: string;
}

interface Props {
  blips: Blip[];
  refresh: () => void;
  /** A blip to select and fly to: a deep link, or a card on the page. Consumed once. */
  focusId?: string | null;
  onFocused?: () => void;
}

type KindFilter = 'all' | BlipKind;

const shareLink = (id: string): string => `${window.location.origin}/location?blip=${encodeURIComponent(id)}`;

/**
 * SeeCity's atlas with the house's own markers on it.
 *
 * Markers are our own Leaflet layer (the component's `markers` property
 * duplicated everything on every save). A marker or a list row selects a
 * blip: the map flies there, the marker lights up, and a card explains it
 * with a link to share. Managers place, edit, move (drag) and remove blips.
 */
export const GtaMap: React.FC<Props> = ({blips, refresh, focusId = null, onFocused}) => {
  const elementRef = useRef<GtaVMap | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());

  const user = useAuthStore((state) => state.user);
  const canEdit = roleAtLeast(user?.role, 'manager');

  const [placing, setPlacing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{x: number; y: number} | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<BlipKind>('custom');
  const [group, setGroup] = useState('Red Moon');
  const [error, setError] = useState<string | null>(null);
  const [tilesMissing, setTilesMissing] = useState(false);
  const [zoomLocked, setZoomLocked] = useState(true);
  const [mapReady, setMapReady] = useState(false);

  /* Ref mirrors so map event handlers always see the latest values. */
  const blipsRef = useRef(blips);
  blipsRef.current = blips;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const movingRef = useRef(movingId);
  movingRef.current = movingId;

  const selected = useMemo(() => blips.find((blip) => blip.id === selectedId) || null, [blips, selectedId]);
  const hq = useMemo(() => blips.find((blip) => blip.kind === 'hq') || null, [blips]);

  const counts = useMemo(() => {
    const map = new Map<BlipKind, number>();
    for (const blip of blips) map.set(blip.kind, (map.get(blip.kind) || 0) + 1);
    return map;
  }, [blips]);

  /** The list: filtered by kind and text, grouped by the blip's own group name. */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = blips.filter((blip) => (kindFilter === 'all' || blip.kind === kindFilter) && (!q || `${blip.label} ${blip.description} ${blip.group} ${blipStyle(blip.kind).label}`.toLowerCase().includes(q)));
    const byGroup = new Map<string, Blip[]>();
    for (const blip of shown) {
      const key = blip.group || 'Red Moon';
      byGroup.set(key, [...(byGroup.get(key) || []), blip]);
    }
    return [...byGroup.entries()].sort(([a], [b]) => (a === 'Red Moon' ? -1 : b === 'Red Moon' ? 1 : a.localeCompare(b, 'hu')));
  }, [blips, kindFilter, query]);

  useEffect(() => {
    let cancelled = false;
    fetch(TILE_PROBE, {method: 'HEAD'})
      .then((res) => !cancelled && setTilesMissing(!res.ok))
      .catch(() => !cancelled && setTilesMissing(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const flyTo = useCallback((blip: Blip) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([blip.y, blip.x], Math.max(map.getZoom(), 4), {duration: 0.8});
  }, []);

  const select = useCallback(
    (blip: Blip | null, fly = true) => {
      setSelectedId(blip ? blip.id : null);
      if (blip && fly) flyTo(blip);
      if (blip) {
        setPanelOpen(false);
        playSfx('ui_click');
      }
    },
    [flyTo]
  );

  const openEditor = useCallback((blip: Blip) => {
    setEditingId(blip.id);
    setDraft({x: blip.x, y: blip.y});
    setLabel(blip.label);
    setDescription(blip.description || '');
    setKind(blip.kind || 'custom');
    setGroup(blip.group || 'Red Moon');
    setError(null);
    playSfx('open');
  }, []);

  /* Grab the Leaflet instance and take over marker rendering. */
  const handleReady = useCallback((event: Event) => {
    const map = (event as CustomEvent<{map: L.Map}>).detail.map;
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    // Document stylesheets stop at the shadow boundary, so the marker CSS has
    // to be placed inside the component's own root.
    const root = elementRef.current?.shadowRoot;
    if (root && !root.querySelector('style[data-rm-blips]')) {
      const style = document.createElement('style');
      style.setAttribute('data-rm-blips', '');
      style.textContent = blipStyles;
      root.appendChild(style);
    }

    // A Leaflet map inside a scrolling page swallows the wheel and traps the
    // page, so wheel zoom only turns on once the map is clicked.
    map.scrollWheelZoom.disable();

    /* Listening on the container rather than through `map.on('click')`:
       Leaflet's synthetic click does not reach us reliably from inside the
       component's shadow root, so the position is converted by hand. */
    const container = map.getContainer();

    container.addEventListener('click', (domEvent: MouseEvent) => {
      map.scrollWheelZoom.enable();
      setZoomLocked(false);

      const target = domEvent.target as Element | null;
      // Ignore clicks that belong to Leaflet's own chrome or to a marker.
      if (target?.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-popup')) return;

      if (!placingRef.current) {
        setSelectedId(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const point = L.point(domEvent.clientX - rect.left, domEvent.clientY - rect.top);
      const latlng = map.containerPointToLatLng(point);

      // The component's CRS maps game X to longitude and game Y to latitude.
      setDraft({x: latlng.lng, y: latlng.lat});
      setPlacing(false);
      playSfx('open');
    });

    container.addEventListener('mouseleave', () => {
      map.scrollWheelZoom.disable();
      setZoomLocked(true);
    });

    setMapReady(true);
  }, []);

  /* Bound from a ref callback rather than an effect: Lit dispatches `map-ready`
     from its first update, which lands before React runs effects. */
  const attachElement = useCallback(
    (node: GtaVMap | null) => {
      elementRef.current = node;
      if (!node || (node as unknown as {__rmBound?: boolean}).__rmBound) return;
      (node as unknown as {__rmBound?: boolean}).__rmBound = true;
      node.addEventListener('map-ready', handleReady);
    },
    [handleReady]
  );

  /* A dragged marker lands: save the new spot, or snap back. */
  const moved = useCallback(
    async (id: string, latlng: L.LatLng) => {
      try {
        await apiSend(`/api/map-blips/${id}`, 'PATCH', {x: latlng.lng, y: latlng.lat});
        toast.success('Jelölő áthelyezve.');
        playSfx('success');
      } catch (err) {
        toast.error('Nem sikerült áthelyezni', (err as Error).message);
        playSfx('error');
      } finally {
        setMovingId(null);
        refresh();
      }
    },
    [refresh]
  );

  /* Reconcile markers against the blip list: update in place, add what is new,
     remove what is gone. Never a blanket re-add, so nothing can duplicate. */
  useEffect(() => {
    const layer = layerRef.current;
    if (!mapReady || !layer) return;

    const seen = new Set<string>();

    for (const blip of blips) {
      seen.add(blip.id);
      const style = blipStyle(blip.kind);
      const isSelected = blip.id === selectedId;
      const size = style.major ? 46 : 34;
      const icon = L.divIcon({
        className: 'rm-blip-icon',
        html: blipMarkerHtml(blip.kind, blip.label, isSelected),
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const existing = markersRef.current.get(blip.id);
      if (existing) {
        if (movingRef.current !== blip.id) existing.setLatLng([blip.y, blip.x]);
        existing.setIcon(icon);
        existing.setZIndexOffset(isSelected ? 1000 : 0);
        continue;
      }

      const marker = L.marker([blip.y, blip.x], {icon, riseOnHover: true, title: blip.label});
      marker.on('click', () => {
        const current = blipsRef.current.find((entry) => entry.id === blip.id);
        if (current) select(current, false);
      });
      marker.on('dragend', () => moved(blip.id, marker.getLatLng()));
      marker.addTo(layer);
      markersRef.current.set(blip.id, marker);
    }

    for (const [id, marker] of markersRef.current) {
      if (seen.has(id)) continue;
      layer.removeLayer(marker);
      markersRef.current.delete(id);
    }
  }, [blips, mapReady, selectedId, select, moved]);

  /* Move mode: exactly one marker drags at a time. */
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const handler = (marker as L.Marker & {dragging?: L.Handler}).dragging;
      if (!handler) continue;
      if (id === movingId) handler.enable();
      else handler.disable();
    }
  }, [movingId, blips]);

  /* Drop every marker when the component unmounts. */
  useEffect(
    () => () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      layerRef.current?.remove();
    },
    []
  );

  /* Deep link or a card on the page asked for a blip. */
  useEffect(() => {
    if (!focusId || !mapReady) return;
    const target = blips.find((blip) => blip.id === focusId);
    if (!target) return;
    select(target);
    shellRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
    onFocused?.();
  }, [focusId, blips, mapReady, select, onFocused]);

  /* A blip that disappears under us is deselected. */
  useEffect(() => {
    if (selectedId && !blips.some((blip) => blip.id === selectedId)) setSelectedId(null);
  }, [blips, selectedId]);

  const closeDraft = useCallback(() => {
    setEditingId(null);
    setDraft(null);
    setLabel('');
    setDescription('');
    setKind('custom');
    setGroup('Red Moon');
    setError(null);
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    try {
      if (editingId) {
        await apiSend(`/api/map-blips/${editingId}`, 'PATCH', {label, description, kind, group});
      } else {
        const reply = await apiSend<{blip: Blip}>('/api/map-blips', 'POST', {...draft, label, description, kind, group});
        setSelectedId(reply.blip.id);
      }
      playSfx('success');
      closeDraft();
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const remove = async (blip: Blip) => {
    const sure = await dialog.confirm({title: 'Törlöd a jelölőt?', message: `${blip.label} eltűnik a térképről.`, confirmLabel: 'TÖRLÉS', tone: 'danger'});
    if (!sure) return;
    try {
      await apiSend(`/api/map-blips/${blip.id}`, 'DELETE');
      playSfx('delete');
      if (selectedId === blip.id) setSelectedId(null);
      refresh();
    } catch (err) {
      toast.error('Nem sikerült törölni', (err as Error).message);
      playSfx('error');
    }
  };

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} a vágólapon.`);
      playSfx('ui_click');
    } catch {
      toast.error('Nem sikerült másolni', text);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await shellRef.current?.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* the browser may refuse */
    }
  };

  const kindOptions: KindFilter[] = ['all', ...BLIP_KINDS.filter((entry) => counts.has(entry))];

  return (
    <div ref={shellRef} id="terkep" className="rm-map relative h-[72vh] max-h-[860px] min-h-[480px] w-full border-y border-[color:var(--rm-line)] bg-[#050304]">
      {/* @ts-expect-error -- custom element, properties are set through the ref */}
      <gta-v-map ref={attachElement} leafletCssUrl="/assets/leaflet.css" tileBaseUrl={TILE_BASE_URL} defaultStyle="atlas" disableClustering showLayerControl/>

      {zoomLocked && !selected && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-2 border border-[color:var(--rm-line)] bg-black/80 px-4 py-2 text-[9px] tracking-[0.2em] text-[#8f8887] backdrop-blur-md">
          <Lock size={11} className="text-[color:var(--rm-red)]"/>
          KATTINTS A TÉRKÉPRE A NAGYÍTÁSHOZ
        </div>
      )}

      {placing && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[650] flex -translate-x-1/2 items-center gap-2 border border-[color:var(--rm-line-red)] bg-black/85 px-4 py-2 text-[9px] tracking-[0.2em] text-white backdrop-blur-md">
          <Crosshair size={11} className="text-[color:var(--rm-red)]"/>
          KATTINTS A TÉRKÉPRE, AHOVA A JELÖLŐ KERÜL
        </div>
      )}

      {movingId && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-[650] flex -translate-x-1/2 items-center gap-2 border border-[color:var(--rm-line-red)] bg-black/85 px-4 py-2 text-[9px] tracking-[0.2em] text-white backdrop-blur-md">
          <Move size={11} className="text-[color:var(--rm-red)]"/>
          HÚZD A JELÖLŐT AZ ÚJ HELYÉRE
        </div>
      )}

      {/* Top-right tools, left of the layer control the map renders there. */}
      <div className="absolute right-[68px] top-4 z-[600] flex gap-2">
        {hq && (
          <button type="button" onClick={() => select(hq)} className="rm-map-tool" title="A Red Moon">
            <span className="text-[13px] leading-none text-[color:var(--rm-red)]" aria-hidden="true">月</span>
            <span className="hidden sm:inline">A RED MOON</span>
          </button>
        )}
        <button type="button" onClick={toggleFullscreen} aria-label="Teljes képernyő" className="rm-map-tool">
          <Maximize2 size={14}/>
        </button>
      </div>

      {tilesMissing && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-8">
          <div className="pointer-events-auto max-w-md border border-[#35151c] bg-[#09090b]/95 p-7 text-center backdrop-blur-md">
            <span className="rm-label">TÉRKÉP / HIÁNYZÓ CSEMPÉK</span>
            <h3 className="mt-3 font-heading text-[22px] text-white">A térképcsempék hiányoznak.</h3>
            <p className="mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
              Másold a styleSatelite, styleAtlas és styleGrid mappákat ide: <code className="text-white">map-tiles/</code>, vagy állítsd be a <code className="text-white">VITE_MAP_TILE_BASE</code> változót a tárhely URL-jére.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ THE PANEL */}
      <div className="rm-map-panel absolute left-4 top-4 z-[600] flex w-[min(292px,calc(100%-2rem))] flex-col border border-[color:var(--rm-line)] bg-[#09090b]/95 backdrop-blur-md">
        <button type="button" onClick={() => setPanelOpen((value) => !value)} aria-expanded={panelOpen} aria-controls="rm-blip-panel" className="flex w-full items-center justify-between border-b border-[color:var(--rm-line)] px-4 py-3 text-left sm:pointer-events-none">
          <span className="rm-label">JELÖLŐK</span>
          <span className="flex items-center gap-2 text-[9px] text-[#777]">
            {blips.length}
            <ChevronDown size={12} aria-hidden="true" className={`transition-transform sm:hidden ${panelOpen ? 'rotate-180' : ''}`}/>
          </span>
        </button>

        <div id="rm-blip-panel" className={`${panelOpen ? 'flex' : 'hidden sm:flex'} min-h-0 flex-col`}>
          <label className="relative flex items-center border-b border-[color:var(--rm-line)]">
            <Search size={12} className="pointer-events-none absolute left-4 text-[#6d5d64]"/>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="KERESÉS A JELÖLŐK KÖZT…" className="w-full bg-transparent py-2.5 pl-10 pr-4 text-[10px] tracking-[0.12em] text-white outline-none placeholder:text-[#5c5556]"/>
          </label>

          {kindOptions.length > 2 && (
            <div className="rm-map-chips flex gap-1.5 overflow-x-auto border-b border-[color:var(--rm-line)] px-3 py-2">
              {kindOptions.map((option) => {
                const active = kindFilter === option;
                const style = option === 'all' ? null : BLIP_STYLES[option];
                return (
                  <button key={option} type="button" onClick={() => setKindFilter(active && option !== 'all' ? 'all' : option)} aria-pressed={active} className={`rm-map-chip${active ? ' is-active' : ''}`} style={style ? ({'--chip': style.color} as React.CSSProperties) : undefined}>
                    {style ? (
                      <span className="rm-map-chip-dot" aria-hidden="true">
                        {style.glyph}
                      </span>
                    ) : null}
                    {option === 'all' ? 'MIND' : style?.label.toUpperCase()}
                    <span className="text-[#6d5d64]">{option === 'all' ? blips.length : counts.get(option) || 0}</span>
                  </button>
                );
              })}
            </div>
          )}

          {canEdit ? (
            <div className="border-b border-[color:var(--rm-line)] p-3">
              <Btn
                variant={placing ? 'red' : 'outline'}
                onClick={() => {
                  setPlacing((value) => !value);
                  setMovingId(null);
                }}
                className="w-full justify-center"
              >
                {placing ? (
                  <>
                    <X size={13}/> MÉGSE
                  </>
                ) : (
                  <>
                    <Plus size={13}/> ÚJ JELÖLŐ
                  </>
                )}
              </Btn>
            </div>
          ) : (
            !user && (
              <div className="border-b border-[color:var(--rm-line)] px-4 py-3 text-[9px] leading-[1.7] text-[#777]">
                Jelölőt a ház managerei helyeznek el.{' '}
                <Link to="/staff-login" className="text-[color:var(--rm-red)] hover:text-white">
                  Staff belépés ↗
                </Link>
              </div>
            )
          )}

          <div className="rm-map-list max-h-[34vh] overflow-y-auto">
            {!groups.length && <p className="px-4 py-4 text-[10px] text-[#777]">{blips.length ? 'Nincs ilyen jelölő.' : 'Még nincs jelölő a térképen.'}</p>}
            {groups.map(([groupName, entries]) => (
              <div key={groupName}>
                <div className="sticky top-0 z-[1] flex items-center justify-between bg-[#0b0b0d] px-4 py-1.5 text-[7px] tracking-[0.25em] text-[#6f6968]">
                  {groupName.toUpperCase()}
                  <span>{entries.length}</span>
                </div>
                {entries.map((blip) => {
                  const style = blipStyle(blip.kind);
                  const active = blip.id === selectedId;
                  return (
                    <button key={blip.id} type="button" onClick={() => select(blip)} aria-pressed={active} className={`rm-map-row${active ? ' is-active' : ''}`}>
                      <span className="rm-map-row-dot" style={{background: style.color}} aria-hidden="true">
                        {style.glyph}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[10.5px] text-white">{blip.label}</span>
                        <span className="block truncate text-[8px] tracking-[0.15em] text-[#6f6968]">{style.label.toUpperCase()}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <button type="button" onClick={() => setLegendOpen((value) => !value)} aria-expanded={legendOpen} className="flex items-center justify-between border-t border-[color:var(--rm-line)] px-4 py-2.5 text-[8px] tracking-[0.25em] text-[#777] hover:text-white">
            JELMAGYARÁZAT
            <ChevronDown size={11} className={`transition-transform ${legendOpen ? 'rotate-180' : ''}`}/>
          </button>
          {legendOpen && (
            <div className="max-h-[26vh] overflow-y-auto border-t border-[color:var(--rm-line)] px-4 py-3">
              {BLIP_GROUPS.map((groupId) => (
                <div key={groupId} className="mb-3 last:mb-0">
                  <span className="block text-[7px] tracking-[0.25em] text-[#6f6968]">{BLIP_GROUP_LABEL[groupId]}</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {BLIP_KINDS.filter((entry) => BLIP_STYLES[entry].group === groupId).map((entry) => {
                      const style = BLIP_STYLES[entry];
                      return (
                        <span key={entry} className="flex items-center gap-2 text-[9px] text-[#c9c2c1]">
                          <span className="rm-map-row-dot !h-4 !w-4 !text-[8px]" style={{background: style.color}} aria-hidden="true">
                            {style.glyph}
                          </span>
                          {style.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ THE SELECTED BLIP */}
      {selected && (
        <div className="rm-map-detail absolute bottom-4 left-4 z-[620] w-[min(360px,calc(100%-2rem))] border bg-[#09090b]/95 backdrop-blur-md" style={{borderColor: `${blipStyle(selected.kind).color}66`}}>
          <div className="flex items-start gap-3 p-4">
            <span className="rm-map-row-dot !h-9 !w-9 !text-[15px]" style={{background: blipStyle(selected.kind).color}} aria-hidden="true">
              {blipStyle(selected.kind).glyph}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block text-[7px] tracking-[0.25em]" style={{color: blipStyle(selected.kind).color}}>
                {blipStyle(selected.kind).label.toUpperCase()} · {(selected.group || 'Red Moon').toUpperCase()}
              </span>
              <strong className="mt-1 block font-heading text-[18px] leading-tight text-white">{selected.label}</strong>
              {selected.description && <p className="mt-1.5 text-[10.5px] leading-[1.7] text-[#a09998]">{selected.description}</p>}
              <span className="mt-2 block text-[8px] tracking-[0.15em] text-[#6f6968]">
                X {Math.round(selected.x)} · Y {Math.round(selected.y)}
              </span>
            </div>
            <button type="button" onClick={() => select(null)} aria-label="Bezárás" className="text-[#777] hover:text-white">
              <X size={14}/>
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-[color:var(--rm-line)] p-2.5">
            <button type="button" onClick={() => copyText(shareLink(selected.id), 'A link')} className="rm-map-action" title="Link a jelölőre">
              <Link2 size={11}/> LINK
            </button>
            <button type="button" onClick={() => copyText(`${Math.round(selected.x)}, ${Math.round(selected.y)}`, 'A koordináta')} className="rm-map-action" title="Koordináta másolása">
              <Copy size={11}/> KOORDINÁTA
            </button>
            <button type="button" onClick={() => flyTo(selected)} className="rm-map-action" title="Középre">
              <Crosshair size={11}/> KÖZÉPRE
            </button>
            {canEdit && (
              <>
                <span className="flex-1"/>
                <button type="button" onClick={() => openEditor(selected)} className="rm-map-action" title="Szerkesztés">
                  <Pencil size={11}/>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlacing(false);
                    setMovingId((value) => (value === selected.id ? null : selected.id));
                    playSfx('ui_click');
                  }}
                  aria-pressed={movingId === selected.id}
                  className={`rm-map-action${movingId === selected.id ? ' is-active' : ''}`}
                  title="Áthelyezés húzással"
                >
                  <Move size={11}/>
                </button>
                <button type="button" onClick={() => remove(selected)} className="rm-map-action is-danger" title="Törlés">
                  <Trash2 size={11}/>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------ THE EDITOR */}
      {draft && (
        <div className="absolute inset-0 z-[700] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <form onSubmit={save} className="max-h-full w-full max-w-md overflow-y-auto border border-[color:var(--rm-line)] bg-[#09090b] p-7">
            <span className="rm-label">{editingId ? 'JELÖLŐ SZERKESZTÉSE' : 'ÚJ JELÖLŐ'}</span>
            <h3 className="mb-1 mt-2 font-heading text-[22px] text-white">{editingId ? 'Jelölő szerkesztése' : 'Jelölő elhelyezése'}</h3>
            <p className="mb-5 text-[9px] tracking-wider text-[#777]">
              X {Math.round(draft.x)} · Y {Math.round(draft.y)}
              {editingId ? ' · a helyét a kártyán az áthelyezéssel változtatod' : ''}
            </p>

            <label className="mb-3 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">NÉV</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} className="rm-input"/>
            </label>

            <label className="mb-4 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">LEÍRÁS</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={400} className="rm-input"/>
            </label>

            <span className="mb-2 block text-[8px] tracking-[0.25em] text-[#777]">TÍPUS</span>
            {BLIP_GROUPS.map((groupId) => (
              <div key={groupId} className="mb-3">
                <span className="mb-1.5 block text-[7px] tracking-[0.25em] text-[#6f6968]">{BLIP_GROUP_LABEL[groupId]}</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {BLIP_KINDS.filter((entry) => BLIP_STYLES[entry].group === groupId).map((option) => {
                    const style = BLIP_STYLES[option];
                    const active = kind === option;
                    return (
                      <button key={option} type="button" onClick={() => setKind(option)} aria-pressed={active} title={style.hint} className={`flex flex-col items-center gap-1 border p-1.5 transition-all ${active ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)]' : 'border-white/10 hover:border-white/30'}`}>
                        <span className="grid h-6 w-6 place-items-center rounded-full text-[11px]" style={{background: style.color, color: '#0a0507'}}>
                          {style.glyph}
                        </span>
                        <span className="text-[7px] tracking-wider text-[#8f8887]">{style.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <label className="mb-5 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">CSOPORT</span>
              <input value={group} onChange={(event) => setGroup(event.target.value)} maxLength={60} placeholder="Red Moon" className="rm-input"/>
              <span className="text-[8px] leading-[1.6] text-[#6f6968]">A lista ezek szerint rendeződik: pl. Red Moon, Parkolás, A környék.</span>
            </label>

            {error && <p className="mb-3 text-[11px] text-[color:var(--rm-red)]">{error}</p>}

            <div className="flex gap-3">
              <Btn type="submit" variant="red" className="flex-1 justify-center">
                MENTÉS
              </Btn>
              <Btn type="button" onClick={closeDraft} className="justify-center">
                MÉGSE
              </Btn>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
