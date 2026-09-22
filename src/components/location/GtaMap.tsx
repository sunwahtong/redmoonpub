import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import 'gta-v-map';
import type {GtaVMap} from 'gta-v-map';
import L from 'leaflet';
import {ChevronDown, Lock, Maximize2, Pencil, Plus, Trash2, X} from 'lucide-react';
import {Link, useSearchParams} from 'react-router-dom';
import {Btn} from '../ui/Btn';
import {useLiveData} from '../../hooks/useLiveData';
import {apiSend} from '../../lib/api';
import {playSfx} from '../../lib/sfx';
import {useAuthStore, roleAtLeast} from '../../stores/useAuthStore';
import {BLIP_KINDS, BLIP_STYLES, blipMarkerHtml, blipStyle, escapeHtml, type BlipKind} from '../../lib/blips';
// Raw text, not a stylesheet link: this gets injected into the shadow root.
import blipStyles from '../../styles/blips.css?inline';

/**
 * Tiles live under public/assets/map. The gta-v-map component builds its URLs as
 * `<tileBaseUrl>/<folder>/{z}/{x}/{y}.<ext>` with folders styleSatelite,
 * styleAtlas and styleGrid.
 *
 * The tile pack is 438 MB across 4102 files. That is fine on a VPS, where it is
 * served from disk next to the app, but it is far too much to ship through a
 * Vercel deployment. Setting VITE_MAP_TILE_BASE at build time points the map at
 * a public object storage bucket (Supabase Storage) instead, and the pack is
 * then left out of the deployment entirely — see scripts/upload-tiles.mjs.
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

export const GtaMap: React.FC = () => {
  const elementRef = useRef<GtaVMap | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  /** Our own marker layer, keyed by blip id. */
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());

  const {data, refresh} = useLiveData<{blips: Blip[]}>('/api/public-map-blips', {intervalMs: 60000});
  const user = useAuthStore((state) => state.user);
  const canEdit = roleAtLeast(user?.role, 'manager');
  const [searchParams, setSearchParams] = useSearchParams();

  const [placing, setPlacing] = useState(false);
  /* Closed by default on a phone. The `sm:block` class keeps it open on wide
     screens whatever this holds, so the initial value only matters on mobile. */
  const [panelOpen, setPanelOpen] = useState(false);
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

  const blips = useMemo(() => data?.blips || [], [data]);
  /** Ref mirror so map event handlers always see the latest list. */
  const blipsRef = useRef(blips);
  blipsRef.current = blips;
  const placingRef = useRef(placing);
  placingRef.current = placing;

  useEffect(() => {
    let cancelled = false;
    fetch(TILE_PROBE, {method: 'HEAD'})
      .then((res) => !cancelled && setTilesMissing(!res.ok))
      .catch(() => !cancelled && setTilesMissing(true));
    return () => {
      cancelled = true;
    };
  }, []);

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

  /* Grab the Leaflet instance and take over marker rendering.
     The library's own `markers` property is not used: its `_syncMarkers()` adds
     every marker twice (once from the property, once from its internal entry
     list), which is what made existing blips duplicate near their originals
     whenever a new one was saved. Owning the layer also lets markers be
     animated DOM nodes instead of static sprite images. */
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

      if (!placingRef.current) return;
      const target = domEvent.target as Element | null;
      // Ignore clicks that belong to Leaflet's own chrome or to a marker.
      if (target?.closest('.leaflet-control, .leaflet-marker-icon, .leaflet-popup')) return;

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
     from its first update, which lands before React runs effects. Attaching at
     commit time is early enough to catch it. */
  const attachElement = useCallback(
    (node: GtaVMap | null) => {
      elementRef.current = node;
      if (!node || (node as unknown as {__rmBound?: boolean}).__rmBound) return;
      (node as unknown as {__rmBound?: boolean}).__rmBound = true;
      node.addEventListener('map-ready', handleReady);
    },
    [handleReady]
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
      const icon = L.divIcon({
        className: 'rm-blip-icon',
        html: blipMarkerHtml(blip.kind, blip.label),
        iconSize: [style.major ? 46 : 34, style.major ? 46 : 34],
        iconAnchor: [style.major ? 23 : 17, style.major ? 23 : 17]
      });

      const popup = `<div class="rm-blip-popup"><span>${escapeHtml(style.label)}</span><strong>${escapeHtml(
        blip.label
      )}</strong>${blip.description ? `<p>${escapeHtml(blip.description)}</p>` : ''}</div>`;

      const existing = markersRef.current.get(blip.id);
      if (existing) {
        existing.setLatLng([blip.y, blip.x]);
        existing.setIcon(icon);
        existing.setPopupContent(popup);
        continue;
      }

      const marker = L.marker([blip.y, blip.x], {icon, riseOnHover: true}).bindPopup(popup);
      marker.on('click', () => playSfx('ui_click'));
      marker.addTo(layer);
      markersRef.current.set(blip.id, marker);
    }

    for (const [id, marker] of markersRef.current) {
      if (seen.has(id)) continue;
      layer.removeLayer(marker);
      markersRef.current.delete(id);
    }
  }, [blips, mapReady]);

  /* Drop every marker when the component unmounts. */
  useEffect(
    () => () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      layerRef.current?.remove();
    },
    []
  );

  const flyTo = useCallback((blip: Blip) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo([blip.y, blip.x], Math.max(map.getZoom(), 4), {duration: 0.8});
    markersRef.current.get(blip.id)?.openPopup();
  }, []);

  /* Deep link support: /location?blip=<id> flies straight to a marker, so a
     location can be shared in chat. The parameter is consumed once. */
  useEffect(() => {
    const wanted = searchParams.get('blip');
    if (!wanted || !mapReady) return;
    const target = blips.find((blip) => blip.id === wanted);
    if (!target) return;
    flyTo(target);
    searchParams.delete('blip');
    setSearchParams(searchParams, {replace: true});
  }, [searchParams, setSearchParams, blips, mapReady, flyTo]);

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
        await apiSend('/api/map-blips', 'POST', {...draft, label, description, kind, group});
      }
      playSfx('success');
      closeDraft();
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
    }
  };

  const remove = async (id: string) => {
    try {
      await apiSend(`/api/map-blips/${id}`, 'DELETE');
      playSfx('delete');
      refresh();
    } catch (err) {
      setError((err as Error).message);
      playSfx('error');
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

  return (
    <div
      ref={shellRef}
      className="relative h-[70vh] max-h-[820px] min-h-[460px] w-full border-y border-[color:var(--rm-line)] bg-[#050304]"
    >
      {/* @ts-expect-error -- custom element, properties are set through the ref */}
      <gta-v-map
        ref={attachElement}
        leafletCssUrl="/assets/leaflet.css"
        tileBaseUrl={TILE_BASE_URL}
        defaultStyle="atlas"
        disableClustering
        showLayerControl
      />

      {zoomLocked && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-2 border border-[color:var(--rm-line)] bg-black/80 px-4 py-2 text-[9px] tracking-[0.2em] text-[#8f8887] backdrop-blur-md">
          <Lock size={11} className="text-[color:var(--rm-red)]"/>
          KATTINTS A TÉRKÉPRE A NAGYÍTÁSHOZ
        </div>
      )}

      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label="Teljes képernyő"
        /* Sits left of the layer control, which the map component renders at
           the top right corner. At right-4 the two overlapped and this button
           was invisible behind it. */
        className="absolute right-[68px] top-4 z-[600] border border-[color:var(--rm-line)] bg-black/80 p-2.5 text-[#8f8887] backdrop-blur-md transition-colors hover:border-[color:var(--rm-red)] hover:text-white"
      >
        <Maximize2 size={14}/>
      </button>

      {tilesMissing && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-8">
          <div className="pointer-events-auto max-w-md border border-[#35151c] bg-[#09090b]/95 p-7 text-center backdrop-blur-md">
            <span className="rm-label">TÉRKÉP / HIÁNYZÓ CSEMPÉK</span>
            <h3 className="mt-3 font-heading text-[22px] text-white">A térképcsempék hiányoznak.</h3>
            <p className="mt-3 text-[11px] leading-[1.8] text-[#8d8584]">
              Másold a styleSatelite, styleAtlas és styleGrid mappákat ide:{' '}
              <code className="text-white">public/assets/map/</code>, vagy állítsd be a{' '}
              <code className="text-white">VITE_MAP_TILE_BASE</code> változót a tárhely URL-jére.
            </p>
          </div>
        </div>
      )}

      {/* Blip panel. Always present, so the feature is discoverable even when
          the visitor is not signed in.

          On a phone the panel is 258px over a ~390px viewport, which leaves
          almost no map to look at — so there the header doubles as a toggle and
          the panel starts closed. On a wide screen it is always open and the
          toggle is not offered. */}
      <div className="absolute left-4 top-4 z-[600] w-[min(258px,calc(100%-2rem))] border border-[color:var(--rm-line)] bg-[#09090b]/95 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
          aria-controls="rm-blip-panel"
          className="flex w-full items-center justify-between border-b border-[color:var(--rm-line)] px-4 py-3 text-left sm:pointer-events-none"
        >
          <span className="rm-label">JELÖLŐK</span>
          <span className="flex items-center gap-2 text-[9px] text-[#777]">
            {blips.length}
            <ChevronDown
              size={12}
              aria-hidden="true"
              className={`transition-transform sm:hidden ${panelOpen ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        <div id="rm-blip-panel" className={panelOpen ? '' : 'hidden sm:block'}>
        {canEdit ? (
          <div className="p-3">
            <Btn
              variant={placing ? 'red' : 'outline'}
              onClick={() => setPlacing((value) => !value)}
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
            {placing && (
              <p className="mt-2 text-[9px] leading-[1.6] text-[color:var(--rm-red)]">
                Kattints a térképre a hely kijelöléséhez.
              </p>
            )}
          </div>
        ) : (
          <div className="p-4 text-[9px] leading-[1.7] text-[#777]">
            {user ? (
              'Jelölő elhelyezéséhez üzletvezetői jog kell.'
            ) : (
              <>
                Jelölőt üzletvezető helyezhet el.{' '}
                <Link to="/staff-login" className="text-[color:var(--rm-red)] hover:text-white">
                  Staff belépés ↗
                </Link>
              </>
            )}
          </div>
        )}

        {blips.length > 0 && (
          <div className="max-h-[32vh] overflow-y-auto border-t border-[color:var(--rm-line)]">
            {blips.map((blip) => {
              const style = blipStyle(blip.kind);
              return (
                <div
                  key={blip.id}
                  className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5 text-left"
                >
                  <span
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px]"
                    style={{background: style.color, color: '#0a0507'}}
                    aria-hidden="true"
                  >
                    {style.glyph}
                  </span>
                  <button
                    type="button"
                    onClick={() => flyTo(blip)}
                    className="flex-1 truncate text-left text-[10px] text-white transition-colors hover:text-[color:var(--rm-red)]"
                  >
                    {blip.label}
                  </button>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditor(blip)}
                        aria-label={`${blip.label} szerkesztése`}
                        className="text-[#777] transition-colors hover:text-white"
                      >
                        <Pencil size={11}/>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(blip.id)}
                        aria-label={`${blip.label} törlése`}
                        className="text-[#777] transition-colors hover:text-[color:var(--rm-red)]"
                      >
                        <Trash2 size={12}/>
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {draft && (
        <div className="absolute inset-0 z-[700] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <form onSubmit={save} className="w-full max-w-md border border-[color:var(--rm-line)] bg-[#09090b] p-7">
            <span className="rm-label">{editingId ? 'JELÖLŐ SZERKESZTÉSE' : 'ÚJ JELÖLŐ'}</span>
            <h3 className="mb-1 mt-2 font-heading text-[22px] text-white">
              {editingId ? 'Jelölő szerkesztése' : 'Jelölő elhelyezése'}
            </h3>
            <p className="mb-5 text-[9px] tracking-wider text-[#777]">
              X {Math.round(draft.x)} · Y {Math.round(draft.y)}
            </p>

            <label className="mb-3 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">NÉV</span>
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
                maxLength={80}
                className="border border-white/10 bg-black/50 p-2.5 text-xs text-white outline-none focus:border-[color:var(--rm-red)]"
              />
            </label>

            <label className="mb-4 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">LEÍRÁS</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                maxLength={400}
                className="border border-white/10 bg-black/50 p-2.5 text-xs text-white outline-none focus:border-[color:var(--rm-red)]"
              />
            </label>

            <span className="mb-2 block text-[8px] tracking-[0.25em] text-[#777]">TÍPUS</span>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {BLIP_KINDS.map((option) => {
                const style = BLIP_STYLES[option];
                const active = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setKind(option)}
                    aria-pressed={active}
                    title={style.label}
                    className={`flex flex-col items-center gap-1.5 border p-2 transition-all ${
                      active ? 'border-[color:var(--rm-red)] bg-[rgba(213,31,60,0.12)]' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    <span
                      className="grid h-6 w-6 place-items-center rounded-full text-[11px]"
                      style={{background: style.color, color: '#0a0507'}}
                    >
                      {style.glyph}
                    </span>
                    <span className="text-[7px] tracking-wider text-[#8f8887]">{style.label}</span>
                  </button>
                );
              })}
            </div>

            <label className="mb-5 flex flex-col gap-1.5">
              <span className="text-[8px] tracking-[0.25em] text-[#777]">CSOPORT</span>
              <input
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                maxLength={60}
                className="border border-white/10 bg-black/50 p-2.5 text-xs text-white outline-none focus:border-[color:var(--rm-red)]"
              />
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
