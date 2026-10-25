/**
 * Leaflet map with the aiming layers: launch marker, aim line, ground track, impact pin,
 * 50% and 90% ellipses, GPS accuracy circle, target, Monte Carlo dots, landmarks and the
 * calibration residual map. Layers are updated imperatively from signals.
 */

import { effect } from '@preact/signals';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'preact/hooks';
import { ellipsePolygon } from '../core/uncertainty';
import { satelliteLayer, type SatelliteLayerConfig } from '../data/satellite';
import { EA_ATTRIBUTION } from '../data/eaLidar';
import { TERRAIN_ATTRIBUTION } from '../data/terrainTiles';
import { latLonOf, type LatLon } from '../geoDeg';
import { markImpactAt, pickLandmark, setLaunchFromMap, updateSettings } from '../state/actions';
import {
  aim,
  fitResult,
  footprint,
  lastFix,
  launch,
  mapAction,
  monteCarlo,
  prediction,
  recording,
  selectedArc,
  session,
  settings,
  shots,
  tab,
  target,
  targetSolution,
  terrain,
  toast,
  wizard,
  zone,
} from '../state/store';

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const ll = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];

function divIcon(cls: string, size = 28): L.DivIcon {
  return L.divIcon({ className: `mk ${cls}`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: '<span></span>' });
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = launch.peek() ?? lastFix.peek();
    // Zoom past the tiles' native 19 (they are upscaled) to place marks precisely.
    const map = L.map(el.current!, { zoomControl: false, attributionControl: true, maxZoom: 21 }).setView(start ? ll(start) : [52.5, -1.5], start ? 17 : 6);
    L.control.zoom({ position: 'topright' }).addTo(map);
    // CORS mode (OSM sends Access-Control-Allow-Origin) so the offline cache stores real responses.
    const osm = L.tileLayer(OSM_URL, { maxNativeZoom: 19, maxZoom: 21, attribution: OSM_ATTRIBUTION, crossOrigin: true }).addTo(map);
    map.attributionControl.addAttribution(TERRAIN_ATTRIBUTION);
    const canvas = L.canvas({ padding: 0.3 });

    const accuracy = L.circle([0, 0], { radius: 1, className: 'gps-accuracy', interactive: false });
    const gpsDot = L.circleMarker([0, 0], { radius: 5, className: 'gps-dot', interactive: false });
    const launchMarker = L.marker([0, 0], { icon: divIcon('mk-launch', 26), keyboard: false });
    const aimLine = L.polyline([], { className: 'aim-line', interactive: false });
    const track = L.polyline([], { className: 'track', interactive: false });
    const impact = L.marker([0, 0], { icon: divIcon('mk-impact', 30), interactive: false });
    const e50 = L.polygon([], { className: 'ellipse e50', interactive: false });
    const e90 = L.polygon([], { className: 'ellipse e90', interactive: false });
    const targetMarker = L.marker([0, 0], { icon: divIcon('mk-target', 34), interactive: false });
    const targetLine = L.polyline([], { className: 'target-line', interactive: false });
    const mcLayer = L.layerGroup();
    const landmarkLayer = L.layerGroup();
    const shotLayer = L.layerGroup();
    const draftImpact = L.marker([0, 0], { icon: divIcon('mk-mark', 26), interactive: false });
    const ringLayer = L.layerGroup();
    const footprintLayer = L.polygon([], { className: 'footprint', interactive: false });
    const obstacleMarker = L.marker([0, 0], { icon: divIcon('mk-obstacle', 26), interactive: false });
    let eaAttributed = false;

    const show = (layer: L.Layer, on: boolean) => {
      if (on && !map.hasLayer(layer)) layer.addTo(map);
      else if (!on && map.hasLayer(layer)) layer.remove();
    };

    launchMarker.on('dragend', () => {
      const p = launchMarker.getLatLng();
      setLaunchFromMap({ lat: p.lat, lon: p.lng });
    });

    // Long-press (contextmenu on touch, right-click on desktop) does what the current screen needs.
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      const p = { lat: e.latlng.lat, lon: e.latlng.lng };
      switch (mapAction.peek()) {
        case 'launch':
          setLaunchFromMap(p);
          toast('Launch point placed');
          break;
        case 'target':
          target.value = p;
          selectedArc.value = null;
          break;
        case 'impact':
          void markImpactAt(p);
          toast('Impact marked');
          break;
        case 'landmark':
          pickLandmark(p);
          break;
      }
    });

    // Follow: keep launch, impact and target in view until the user pans.
    let follow = true;
    map.on('dragstart', () => (follow = false));
    const frame = (force = false) => {
      const l = launch.peek();
      if (!l || (!follow && !force)) return;
      const pts: L.LatLngTuple[] = [ll(l)];
      const pr = prediction.peek();
      if (pr) pts.push(ll(latLonOf(l, pr.impact[0], pr.impact[1])));
      const t = target.peek();
      if (t && tab.peek() === 'target') pts.push(ll(t));
      const b = L.latLngBounds(pts);
      if (force || !map.getBounds().pad(-0.15).contains(b)) map.fitBounds(b, { padding: [40, 40], maxZoom: 19, animate: false });
    };
    const Recenter = L.Control.extend({
      onAdd() {
        const b = L.DomUtil.create('button', 'map-btn');
        b.type = 'button';
        b.title = 'Re-centre on launch and impact';
        b.textContent = '◎';
        L.DomEvent.disableClickPropagation(b);
        b.onclick = () => {
          follow = true;
          frame(true);
        };
        return b;
      },
    });
    new Recenter({ position: 'topright' }).addTo(map);

    // Satellite base layer, its required logo, and a big MAP/SAT toggle.
    let satellite: L.TileLayer | null = null;
    let satelliteKey = '';
    let logo: L.Control | null = null;
    const satButton = L.DomUtil.create('button', 'map-btn map-btn-text');
    satButton.type = 'button';
    L.DomEvent.disableClickPropagation(satButton);
    satButton.onclick = () => updateSettings({ mapBase: settings.peek().mapBase === 'satellite' ? 'map' : 'satellite' });
    const SatToggle = L.Control.extend({ onAdd: () => satButton });
    new SatToggle({ position: 'topright' }).addTo(map);
    const makeSatellite = (cfg: SatelliteLayerConfig) => {
      const layer = L.tileLayer(cfg.url, { maxNativeZoom: cfg.maxNativeZoom, maxZoom: 21, attribution: cfg.attribution, crossOrigin: true });
      let warned = false;
      layer.on('tileerror', () => {
        if (warned) return;
        warned = true;
        toast(navigator.onLine ? 'Satellite tiles are not loading: check the key in Setup' : 'No signal: satellite tiles not cached here', 'warn', 6000);
      });
      return layer;
    };
    const makeLogo = (l: NonNullable<SatelliteLayerConfig['logo']>) => {
      const Logo = L.Control.extend({
        onAdd() {
          const a = L.DomUtil.create('a', 'provider-logo');
          a.href = l.href;
          a.target = '_blank';
          a.rel = 'noopener';
          const img = L.DomUtil.create('img', '', a);
          img.src = l.src;
          img.alt = l.alt;
          return a;
        },
      });
      return new Logo({ position: 'bottomleft' });
    };

    const disposers = [
      effect(() => {
        const s = settings.value;
        launchMarker.dragging?.[s.devMode ? 'enable' : 'disable']();
        const cfg = satelliteLayer(s);
        const key = cfg ? `${cfg.url}|${cfg.attribution}` : '';
        if (key !== satelliteKey) {
          satellite?.remove();
          logo?.remove();
          satellite = cfg ? makeSatellite(cfg) : null;
          logo = cfg?.logo ? makeLogo(cfg.logo) : null;
          satelliteKey = key;
        }
        const useSat = !!satellite && s.mapBase === 'satellite';
        show(osm, !useSat);
        if (satellite) show(satellite, useSat);
        if (logo) {
          if (useSat) logo.addTo(map);
          else logo.remove();
        }
        satButton.style.display = cfg ? '' : 'none';
        satButton.textContent = useSat ? 'MAP' : 'SAT';
        satButton.title = useSat ? 'Show the street map' : 'Show satellite imagery';
      }),
      effect(() => {
        const f = lastFix.value;
        show(accuracy, !!f);
        show(gpsDot, !!f);
        if (f) {
          accuracy.setLatLng([f.lat, f.lon]).setRadius(f.accuracy);
          gpsDot.setLatLng([f.lat, f.lon]);
        }
      }),
      effect(() => {
        const l = launch.value;
        show(launchMarker, !!l);
        if (l) {
          launchMarker.setLatLng(ll(l));
          if (settings.peek().devMode) launchMarker.dragging?.enable();
          follow = true;
          frame(true);
        }
      }),
      effect(() => {
        const l = launch.value;
        const pr = prediction.value;
        const a = aim.value;
        const ok = !!(l && pr && a);
        show(aimLine, ok);
        show(track, ok);
        show(impact, ok);
        if (!ok) return;
        const az = (a!.azimuthDeg * Math.PI) / 180;
        const len = Math.max(pr!.range * 1.15, 40);
        aimLine.setLatLngs([ll(l!), ll(latLonOf(l!, len * Math.sin(az), len * Math.cos(az)))]);
        const p = pr!.path;
        const pts: L.LatLngTuple[] = [];
        for (let i = 0; i < p.length; i += 3) pts.push(ll(latLonOf(l!, p[i]!, p[i + 1]!)));
        track.setLatLngs(pts);
        impact.setLatLng(ll(latLonOf(l!, pr!.impact[0], pr!.impact[1])));
        frame();
      }),
      effect(() => {
        const l = launch.value;
        const z = zone.value;
        const ok = !!(l && z && prediction.value);
        show(e50, ok);
        show(e90, ok);
        if (!ok) return;
        const toLL = (pts: [number, number][]) => pts.map(([x, y]) => ll(latLonOf(l!, x, y)));
        e50.setLatLngs(toLL(ellipsePolygon(z!.mean, z!.ellipses[0]!)));
        e90.setLatLngs(toLL(ellipsePolygon(z!.mean, z!.ellipses[1]!)));
      }),
      effect(() => {
        const t = target.value;
        const l = launch.value;
        const visible = !!t && tab.value !== 'shots';
        show(targetMarker, visible);
        show(targetLine, visible && !!l);
        if (t) targetMarker.setLatLng(ll(t));
        if (t && l) targetLine.setLatLngs([ll(l), ll(t)]);
        void targetSolution.value;
      }),
      effect(() => {
        const mc = monteCarlo.value;
        mcLayer.clearLayers();
        show(mcLayer, !!mc);
        if (!mc) return;
        for (let i = 0; i < mc.points.length; i += 2) {
          // Canvas-rendered for speed, so colours are set here rather than in CSS.
          L.circleMarker(ll(latLonOf(mc.origin, mc.points[i]!, mc.points[i + 1]!)), {
            renderer: canvas,
            radius: 2.5,
            stroke: false,
            fillColor: '#8b00d6',
            fillOpacity: 0.75,
            interactive: false,
          }).addTo(mcLayer);
        }
      }),
      effect(() => {
        landmarkLayer.clearLayers();
        const w = wizard.value;
        const marks = [...(session.value?.landmarks ?? [])];
        for (const m of marks) L.marker(ll(m), { icon: divIcon('mk-landmark', 22), interactive: false }).addTo(landmarkLayer);
        if (w?.kind === 'landmark' && w.picked) L.marker(ll(w.picked), { icon: divIcon('mk-landmark picked', 30), interactive: false }).addTo(landmarkLayer);
        show(landmarkLayer, marks.length > 0 || w?.kind === 'landmark');
      }),
      effect(() => {
        // Shots screen: marked impacts, and lines from each fitted prediction to its mark.
        shotLayer.clearLayers();
        const on = tab.value === 'shots';
        show(shotLayer, on);
        if (!on) return;
        const fit = fitResult.value;
        const byId = new Map(shots.value.map((s) => [s.id, s]));
        for (const s of shots.value) {
          if (!s.impact) continue;
          L.circleMarker(ll(s.impact), { radius: 6, className: s.excluded ? 'shot-dot excluded' : 'shot-dot', interactive: false }).addTo(shotLayer);
        }
        for (const r of fit?.result.residuals ?? []) {
          const s = byId.get(r.id);
          if (!s?.impact) continue;
          const pred = latLonOf(s.launch, r.predicted[0], r.predicted[1]);
          L.polyline([ll(pred), ll(s.impact)], { className: 'residual', interactive: false }).addTo(shotLayer);
          L.circleMarker(ll(pred), { radius: 3, className: 'residual-pred', interactive: false }).addTo(shotLayer);
        }
      }),
      effect(() => {
        const l = launch.value;
        const o = prediction.value?.obstacle;
        show(obstacleMarker, !!(l && o));
        if (l && o) obstacleMarker.setLatLng(ll(latLonOf(l, o.x, o.y)));
      }),
      effect(() => {
        const g = settings.value.game;
        const t = target.value;
        ringLayer.clearLayers();
        show(ringLayer, !!(g && t));
        if (!g || !t) return;
        for (const r of [...g.rings].sort((a, b) => b.radius - a.radius)) {
          L.circle(ll(t), { radius: r.radius, className: 'game-ring', interactive: false }).addTo(ringLayer);
        }
        // Scored landings of this game.
        for (const s of shots.value) {
          if (s.game?.id === g.id && s.impact) L.circleMarker(ll(s.impact), { radius: 5, className: 'game-hit', interactive: false }).addTo(ringLayer);
        }
      }),
      effect(() => {
        const l = launch.value;
        const f = footprint.value;
        show(footprintLayer, !!(l && f) && tab.value !== 'setup');
        if (l && f) footprintLayer.setLatLngs(f.points.map((p) => ll(latLonOf(l, p.x, p.y))));
      }),
      effect(() => {
        const lidar = terrain.value.source === 'lidar';
        if (lidar && !eaAttributed) map.attributionControl.addAttribution(EA_ATTRIBUTION);
        if (!lidar && eaAttributed) map.attributionControl.removeAttribution(EA_ATTRIBUTION);
        eaAttributed = lidar;
      }),
      effect(() => {
        const imp = recording.value?.draft.impact;
        show(draftImpact, !!imp);
        if (imp) draftImpact.setLatLng(ll(imp));
      }),
      effect(() => {
        void tab.value;
        requestAnimationFrame(() => map.invalidateSize());
      }),
    ];

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      disposers.forEach((d) => d());
      map.remove();
    };
  }, []);

  return <div ref={el} class="map" />;
}
