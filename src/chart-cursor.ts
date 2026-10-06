// Distances are absolute metres from the start of each complete GPX.
export type Sample = [number, number];

export function clampDistance(distance: number, start: number, end: number): number {
  return Math.min(end, Math.max(start, distance));
}

export function distanceAtX(x: number, left: number, right: number,
  start: number, end: number): number {
  return start + (clampDistance(x, left, right) - left) / (right - left) * (end - start);
}

export function xAtDistance(distance: number, left: number, right: number,
  start: number, end: number): number {
  return left + (clampDistance(distance, start, end) - start) / (end - start) * (right - left);
}

export function heartRateAt(runs: Sample[][], isolated: Sample[], distance: number,
  start: number, end: number): number | null {
  if (distance < start || distance > end) return null;
  // Point samples at a boundary take precedence over the preceding held value.
  const point = isolated.find(([position]) => Math.abs(position - distance) < 1e-6);
  if (point) return point[1];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [from, value] = run[i], [to] = run[i + 1];
      if (from <= distance && distance < to && to > from) return value;
    }
  }
  // At an interval end, only an actual isolated HR sample proves a value.
  return null;
}

export function paceAt(runs: Sample[][], distance: number,
  start: number, end: number): number | null {
  if (distance < start || distance > end) return null;
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const [from, value] = run[i], [to, next] = run[i + 1];
      if (from <= distance && distance <= to && to > from)
        return value + (next - value) * (distance - from) / (to - from);
    }
    if (run.length === 1 && Math.abs(run[0][0] - distance) < 1e-6) return run[0][1];
  }
  return null;
}
