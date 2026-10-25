import { describe, expect, it } from 'vitest';
import { countdownCues } from '../src/ui/cues';
import { SKINS, skinById, toMils } from '../src/ui/skins';

const words = (c: ReturnType<typeof countdownCues>) => c.map((x) => x.say ?? 'tone');

describe('countdown cues', () => {
  it('plain counts down to the landing', () => {
    const c = countdownCues('plain', 4.5);
    expect(words(c)).toEqual(['three', 'two', 'one', 'landing']);
    expect(c.map((x) => x.t)).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(c.at(-1)!.final).toBe(true);
  });

  it('military calls Shot, then Splash 5 s before impact, then a tone', () => {
    const c = countdownCues('military', 9);
    expect(words(c)).toEqual(['Shot, over', 'Splash, over', 'tone']);
    expect(c[1]!.t).toBe(4);
    expect(c[2]).toMatchObject({ t: 9, final: true });
  });

  it('military splashes halfway on short flights, at most 1.5 s in', () => {
    expect(countdownCues('military', 2.4)[1]!.t).toBeCloseTo(1.2);
    expect(countdownCues('military', 5)[1]!.t).toBe(1.5);
  });

  it('spy opens and closes with its own words and drops crowded numbers', () => {
    expect(words(countdownCues('spy', 6))).toEqual(['Package away', 'three', 'two', 'one', 'Delivered']);
    // "three" would come 0.5 s after "Package away": dropped.
    expect(words(countdownCues('spy', 3.5))).toEqual(['Package away', 'two', 'one', 'Delivered']);
  });

  it('never cues before firing and always keeps the landing', () => {
    for (const style of ['plain', 'military', 'spy'] as const) {
      for (const tof of [0.6, 1.2, 2, 3.3, 7]) {
        const c = countdownCues(style, tof);
        expect(c.every((x) => x.t >= 0)).toBe(true);
        expect(c.at(-1)).toMatchObject({ t: tof, final: true });
        for (let i = 1; i < c.length - 1; i++) expect(c[i]!.t - c[i - 1]!.t).toBeGreaterThanOrEqual(0.9);
      }
    }
    expect(countdownCues('plain', NaN)).toEqual([]);
  });
});

describe('skins', () => {
  it('has plain first, then the three themed skins', () => {
    expect(SKINS.map((s) => s.id)).toEqual(['plain', 'military', 'spy', 'retro']);
    expect(skinById('retro').name).toBe('1980s military');
  });

  it('converts degrees to NATO mils', () => {
    expect(toMils(360)).toBe(6400);
    expect(toMils(45)).toBe(800);
  });
});
