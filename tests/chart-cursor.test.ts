import {expect, it} from 'vitest';
import {clampDistance, distanceAtX, heartRateAt, paceAt, xAtDistance, type Sample} from '../src/chart-cursor.ts';

it('clamps to the common absolute kilometre range, not segment progress', () => {
  expect(clampDistance(200, 350, 850)).toBe(350);
  expect(clampDistance(900, 350, 850)).toBe(850);
  expect(clampDistance(620, 350, 850)).toBe(620);
});

it('maps the same absolute distance to either SVG without aligning selection starts', () => {
  expect(distanceAtX(500, 100, 900, 200, 1000)).toBe(600);
  expect(xAtDistance(600, 100, 900, 200, 1000)).toBe(500);
  expect(xAtDistance(600, 115, 972, 200, 1000)).toBeCloseTo(543.5);
  expect(xAtDistance(10, 100, 900, 200, 1000)).toBe(100);
});

it('reads held HR only inside valid runs and isolated points', () => {
  const runs: Sample[][] = [[[200, 150], [300, 150]], [[430, 170], [500, 170]]];
  expect(heartRateAt(runs, [[300, 155], [400, 165]], 250, 200, 500)).toBe(150);
  expect(heartRateAt(runs, [[300, 155], [400, 165]], 300, 200, 500)).toBe(155);
  expect(heartRateAt(runs, [[300, 155], [400, 165]], 350, 200, 500)).toBeNull();
  expect(heartRateAt(runs, [[300, 155], [400, 165]], 400, 200, 500)).toBe(165);
  expect(heartRateAt(runs, [], 500, 200, 500)).toBeNull();
  expect(heartRateAt(runs, [[500, 172]], 500, 200, 500)).toBe(172);
  expect(heartRateAt(runs, [], 190, 200, 500)).toBeNull();
});

it('interpolates local pace inside a run but never through a pause or outside selection', () => {
  const runs: Sample[][] = [[[200, 360], [300, 300]], [[450, 400], [550, 200]]];
  expect(paceAt(runs, 250, 200, 550)).toBe(330);
  expect(paceAt(runs, 375, 200, 550)).toBeNull();
  expect(paceAt(runs, 500, 200, 550)).toBe(300);
  expect(paceAt(runs, 190, 200, 550)).toBeNull();
});
