/** Spotter mode: mark where each of the shooter's shots lands, then hand the marks back by QR code. */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { marksLink } from '../data/spotter';
import { addSpotterMark, leaveSpotterMode, removeSpotterMark } from '../state/actions';
import { settings, toast } from '../state/store';
import { FixAverager } from '../sensors/gps';
import { fmt, timeOf } from './format';
import { Qr } from './Qr';
import { appBase, shareOrCopy } from './SpotterCard';

function SpotterMap() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sp = settings.peek().spotter!;
    const launchLL: L.LatLngTuple = [sp.invite.l[0], sp.invite.l[1]];
    const map = L.map(el.current!, { zoomControl: false, maxZoom: 21 }).setView(launchLL, 17);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      maxZoom: 21,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const icon = (cls: string, html = '<span></span>') => L.divIcon({ className: `mk ${cls}`, iconSize: [26, 26], iconAnchor: [13, 13], html });
    L.marker(launchLL, { icon: icon('mk-launch'), interactive: false }).addTo(map);
    const pts: L.LatLngTuple[] = [launchLL];
    if (sp.invite.t) {
      const t: L.LatLngTuple = [sp.invite.t[0], sp.invite.t[1]];
      L.marker(t, { icon: icon('mk-target'), interactive: false }).addTo(map);
      L.polyline([launchLL, t], { className: 'target-line', interactive: false }).addTo(map);
      pts.push(t);
    }
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      addSpotterMark({ lat: e.latlng.lat, lon: e.latlng.lng });
      navigator.vibrate?.(40);
      toast('Landing marked');
    });
    const layer = L.layerGroup().addTo(map);
    const dispose = effect(() => {
      layer.clearLayers();
      (settings.value.spotter?.marks ?? []).forEach((m, i) =>
        L.marker([m.lat, m.lon], { icon: icon('mk-spot', `<span>${i + 1}</span>`), interactive: false }).addTo(layer),
      );
    });
    return () => {
      dispose();
      map.remove();
    };
  }, []);
  return <div ref={el} class="map" />;
}

export function SpotterScreen() {
  const sp = settings.value.spotter!;
  const [link, setLink] = useState<string | null>(null);
  const [standing, setStanding] = useState<string | null>(null);

  const markHere = () => {
    const avg = new FixAverager(5, 50);
    setStanding('Averaging GPS for 5 s…');
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const r = avg.push({ t: performance.now() / 1000, lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setStanding(`Averaging GPS: ${fmt(r.span, 0)}/5 s (±${fmt(p.coords.accuracy, 0)} m)`);
        if (r.done) {
          navigator.geolocation.clearWatch(id);
          addSpotterMark({ lat: r.lat, lon: r.lon });
          setStanding(null);
          toast(`Landing marked where you stand (±${fmt(r.accuracy, 0)} m)`);
        }
      },
      (e) => {
        navigator.geolocation.clearWatch(id);
        setStanding(null);
        toast(`GPS: ${e.message}`, 'warn');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  };

  return (
    <div class="app spotter">
      <div class="map-wrap">
        <SpotterMap />
        <div class="map-hint">Long-press: mark a landing</div>
      </div>
      <main class="panel">
        <div class="panel-inner">
          <h2>Spotter mode</h2>
          <p class="small">
            Long-press the map where each potato lands, straight after it lands (the time is used to match it to the shot), or walk to it and use
            GPS. Stay well clear of the line of fire.
          </p>
          <button class="btn" disabled={!!standing} onClick={markHere}>
            {standing ?? "Mark where I'm standing"}
          </button>
          <ol class="spot-list">
            {sp.marks.map((m) => (
              <li key={m.t}>
                {timeOf(new Date(m.t * 1000).toISOString())}{' '}
                <button class="link" onClick={() => removeSpotterMark(m.t)}>
                  remove
                </button>
              </li>
            ))}
          </ol>
          {sp.marks.length === 0 && <p class="muted">No landings marked yet.</p>}
          <button class="btn btn-primary btn-big" disabled={!sp.marks.length} onClick={async () => setLink(await marksLink(appBase(), sp.invite.s, sp.marks))}>
            Send {sp.marks.length} mark{sp.marks.length === 1 ? '' : 's'} to the shooter
          </button>
          {link && (
            <div class="qr-box">
              <Qr text={link} label="QR code with the landing marks" />
              <p class="small">The shooter taps Scan spotter's marks (Shots screen) and points their camera here, or open the shared link.</p>
              <button class="btn btn-small" onClick={() => void shareOrCopy(link, 'Potato landings')}>
                Share link instead
              </button>
            </div>
          )}
          <p>
            <button class="btn btn-warn" onClick={leaveSpotterMode}>
              Leave spotter mode
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
