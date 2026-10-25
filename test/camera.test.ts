import { describe, expect, it } from 'vitest';
import { toRad } from '../src/core/angles';
import { cameraRotation, focalFromFov, project } from '../src/core/camera';

// Phone held upright in portrait, screen facing the user, rear camera looking north: β = 90°.
const upright = (alphaDeg = 0, corr = 0) => cameraRotation(toRad(alphaDeg), toRad(90), 0, corr);
const cam = { f: 500, cx: 200, cy: 400, screenAngle: 0 };
const eye: [number, number, number] = [0, 0, 1.5];

describe('camera projection', () => {
  it('puts a point straight ahead at the centre, higher points higher, east to the right', () => {
    const R = upright();
    const ahead = project(R, eye, [0, 100, 1.5], cam)!;
    expect(ahead.u).toBeCloseTo(200, 9);
    expect(ahead.v).toBeCloseTo(400, 9);
    expect(ahead.depth).toBeCloseTo(100, 9);
    expect(project(R, eye, [0, 100, 11.5], cam)!.v).toBeCloseTo(400 - 50, 9);
    expect(project(R, eye, [10, 100, 1.5], cam)!.u).toBeCloseTo(250, 9);
  });

  it('hides points behind the camera', () => {
    expect(project(upright(), eye, [0, -50, 1.5], cam)).toBeNull();
  });

  it('applies the heading correction (clockwise)', () => {
    // Compass reads 10° too far anticlockwise: correction +10° makes the camera look 10° east of north.
    const R = upright(0, toRad(10));
    const p = [100 * Math.sin(toRad(10)), 100 * Math.cos(toRad(10)), 1.5] as const;
    expect(project(R, eye, p, cam)!.u).toBeCloseTo(200, 6);
  });

  it('turning to face east (α = 270°) centres an eastern point', () => {
    expect(project(upright(270), eye, [100, 0, 1.5], cam)!.u).toBeCloseTo(200, 6);
  });

  it('rotates with the screen in landscape', () => {
    // Device turned anticlockwise to landscape (angle 90): device +x (east here) is now screen-up.
    const R = upright();
    const p = project(R, eye, [10, 100, 1.5], { ...cam, screenAngle: 90 })!;
    expect(p.v).toBeCloseTo(400 - 50, 6);
    expect(p.u).toBeCloseTo(200, 6);
  });

  it('focal length from field of view', () => {
    expect(focalFromFov(1000, toRad(90))).toBeCloseTo(500, 9);
  });
});
