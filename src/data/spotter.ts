/**
 * Spotter phone, without a server: the shooter shows a QR code (a link carrying the launch point
 * and target); the spotter opens it, long-presses where each shot lands, then shows a QR code of
 * those marks (or shares the link) for the shooter to scan. Marks are matched to shots by time.
 * Payloads are JSON, deflate-compressed and base64url-encoded into the URL fragment, which is
 * never sent to the web server.
 */

export interface SpotInvite {
  v: 1;
  /** Shooter's session id. */
  s: string;
  /** Launch point [lat, lon]. */
  l: [number, number];
  /** Target [lat, lon]. */
  t?: [number, number];
}

export interface SpotMark {
  /** Unix time, s. */
  t: number;
  lat: number;
  lon: number;
}

export interface SpotMarks {
  v: 1;
  s: string;
  /** [unix seconds, lat, lon] per mark. */
  m: [number, number, number][];
}

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function packPayload(obj: unknown): Promise<string> {
  return b64url(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
}

export async function unpackPayload<T>(s: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await pipe(fromB64url(s), new DecompressionStream('deflate-raw')))) as T;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export async function inviteLink(base: string, invite: Omit<SpotInvite, 'v'>): Promise<string> {
  const p: SpotInvite = { v: 1, s: invite.s, l: [r6(invite.l[0]), r6(invite.l[1])], ...(invite.t ? { t: [r6(invite.t[0]), r6(invite.t[1])] as [number, number] } : {}) };
  return `${base}#spot=${await packPayload(p)}`;
}

export async function marksLink(base: string, session: string, marks: readonly SpotMark[]): Promise<string> {
  const p: SpotMarks = { v: 1, s: session, m: marks.map((k) => [Math.round(k.t * 10) / 10, r6(k.lat), r6(k.lon)]) };
  return `${base}#marks=${await packPayload(p)}`;
}

/** Reads `#spot=` or `#marks=` from a URL or a bare fragment. */
export async function parseSpotterLink(url: string): Promise<{ invite: SpotInvite } | { marks: SpotMarks } | null> {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : url;
  const m = /^(spot|marks)=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    if (m[1] === 'spot') {
      const invite = await unpackPayload<SpotInvite>(m[2]!);
      return invite.v === 1 && Array.isArray(invite.l) ? { invite } : null;
    }
    const marks = await unpackPayload<SpotMarks>(m[2]!);
    return marks.v === 1 && Array.isArray(marks.m) ? { marks } : null;
  } catch {
    return null;
  }
}

export interface FiredShot {
  id: string;
  /** Unix time fired, s. */
  firedAt: number;
  /** Predicted flight time, s. */
  flightTime: number;
}

/**
 * Pair each mark with the shot it most likely belongs to: the latest shot fired before the mark
 * whose landing window (fired − 2 s … fired + 2 × predicted flight + 20 s) contains it. Each shot
 * takes at most one mark (the earliest).
 */
export function matchMarks(marks: readonly SpotMark[], shots: readonly FiredShot[]): { mark: SpotMark; shotId: string | null }[] {
  const taken = new Set<string>();
  return [...marks]
    .sort((a, b) => a.t - b.t)
    .map((mark) => {
      const candidates = shots
        .filter((s) => !taken.has(s.id) && mark.t >= s.firedAt - 2 && mark.t <= s.firedAt + 2 * (Number.isFinite(s.flightTime) ? s.flightTime : 5) + 20)
        .sort((a, b) => b.firedAt - a.firedAt);
      const hit = candidates.find((s) => s.firedAt <= mark.t) ?? candidates[0] ?? null;
      if (hit) taken.add(hit.id);
      return { mark, shotId: hit?.id ?? null };
    });
}
