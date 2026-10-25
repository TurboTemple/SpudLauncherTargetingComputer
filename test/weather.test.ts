import { describe, expect, it } from 'vitest';
import { parseWindProfile, trendVerdict, windProfileUrl } from '../src/data/weather';

const T0 = 1_793_000_000; // a quarter-hour boundary-ish unix time

describe('wind profile parsing', () => {
  it('fits the shear exponent from the hour nearest now and keeps the 15-minute trend', () => {
    const a = 0.2;
    const s10 = [4, 5, 6];
    const json = {
      hourly: {
        time: [T0 - 3600, T0, T0 + 3600],
        wind_speed_10m: s10,
        wind_speed_80m: s10.map((s) => s * 8 ** a),
        wind_speed_120m: s10.map((s) => s * 12 ** a),
      },
      minutely_15: {
        time: [T0, T0 + 900, T0 + 1800],
        wind_speed_10m: [5, 5.5, 6],
        wind_gusts_10m: [8, 9, 10],
        wind_direction_10m: [250, 255, 260],
      },
    };
    const p = parseWindProfile(json, T0 + 600);
    expect(p.shearExponent).toBeCloseTo(a, 10);
    expect(p.profile?.map((l) => l.z)).toEqual([10, 80, 120]);
    expect(p.profile?.[0]?.speed).toBe(5);
    expect(p.trend).toHaveLength(3);
    expect(p.trend?.[1]).toEqual({ t: T0 + 900, speed: 5.5, gust: 9, fromDeg: 255 });
  });

  it('tolerates missing series', () => {
    expect(parseWindProfile({}, T0)).toEqual({});
    const p = parseWindProfile({ hourly: { time: [T0], wind_speed_10m: [5] } }, T0);
    expect(p.shearExponent).toBeUndefined();
    expect(p.profile).toEqual([{ z: 10, speed: 5 }]);
  });

  it('asks for the profile and trend in m/s and unix time', () => {
    const u = new URL(windProfileUrl(52.2, 0.12));
    expect(u.searchParams.get('hourly')).toBe('wind_speed_10m,wind_speed_80m,wind_speed_120m');
    expect(u.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(u.searchParams.get('timeformat')).toBe('unixtime');
  });
});

describe('trend verdict', () => {
  const steps = (speeds: number[]) => speeds.map((speed, i) => ({ t: T0 + 900 * i, speed }));
  it('calls rising, easing and steady wind', () => {
    expect(trendVerdict(steps([4, 4.5, 5, 6.5, 7]), T0)).toMatch(/^Picking up: 7\.0 m\/s/);
    expect(trendVerdict(steps([8, 7, 6, 5, 4]), T0)).toMatch(/^Easing: 4\.0 m\/s/);
    expect(trendVerdict(steps([5, 5.2, 4.9, 5.1]), T0)).toBe('Steady for the next two hours');
    expect(trendVerdict(steps([5]), T0)).toBeNull();
  });
});
