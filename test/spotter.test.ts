import { describe, expect, it } from 'vitest';
import { inviteLink, marksLink, matchMarks, parseSpotterLink } from '../src/data/spotter';

describe('spotter links', () => {
  it('round-trips an invite and a set of marks through compact links', async () => {
    const inv = await inviteLink('https://x.test/app/', { s: 'sess-1', l: [52.20531234, 0.12181234], t: [52.206, 0.122] });
    expect(inv.startsWith('https://x.test/app/#spot=')).toBe(true);
    const a = await parseSpotterLink(inv);
    expect(a && 'invite' in a && a.invite).toEqual({ v: 1, s: 'sess-1', l: [52.205312, 0.121812], t: [52.206, 0.122] });

    const marks = Array.from({ length: 20 }, (_, i) => ({ t: 1_793_000_000 + 30 * i + 0.27, lat: 52.2 + i * 1e-4, lon: 0.12 + i * 1e-4 }));
    const link = await marksLink('https://x.test/app/', 'sess-1', marks);
    expect(link.length).toBeLessThan(900); // fits a scannable QR code
    const b = await parseSpotterLink(link);
    expect(b && 'marks' in b && b.marks.m.length).toBe(20);
    expect(b && 'marks' in b && b.marks.m[3]).toEqual([1_793_000_090.3, 52.2003, 0.1203]);
  });

  it('rejects anything else', async () => {
    expect(await parseSpotterLink('https://x.test/#foo=bar')).toBeNull();
    expect(await parseSpotterLink('https://x.test/#marks=notbase64!!')).toBeNull();
    expect(await parseSpotterLink('#marks=AAAA')).toBeNull();
  });
});

describe('matching marks to shots', () => {
  const shots = [
    { id: 'a', firedAt: 1000, flightTime: 4 },
    { id: 'b', firedAt: 1060, flightTime: 5 },
    { id: 'c', firedAt: 1200, flightTime: 3 },
  ];
  it('pairs each mark with the shot fired just before it, one mark per shot', () => {
    const m = matchMarks(
      [
        { t: 1066, lat: 1, lon: 1 },
        { t: 1005, lat: 0, lon: 0 },
        { t: 1009, lat: 9, lon: 9 }, // second mark for shot a: unmatched
        { t: 1500, lat: 5, lon: 5 }, // long after every shot
      ],
      shots,
    );
    expect(m.map((x) => x.shotId)).toEqual(['a', null, 'b', null]);
  });
  it('tolerates small clock differences between phones', () => {
    expect(matchMarks([{ t: 1199, lat: 0, lon: 0 }], shots)[0]!.shotId).toBe('c');
  });
});
