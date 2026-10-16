/** Desktop practice uses CSS pixels and the audio clock, independently of DPR. */
export const PRACTICE_LIMITS = Object.freeze({
  early: 0.28,
  late: 0.24,
  padding: 10,
  minMovement: 3,
  directionDot: 0.1,
  maxStrokeSeconds: 0.12,
});

// Screen coordinates have positive Y downwards; these match the visible arrows.
const DIRECTIONS = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2],
];

/** Project the eight corners of a cube using a supplied world→CSS transform. */
export function projectPracticeBox(center, halfSize, project) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const x of [-halfSize, halfSize])
    for (const y of [-halfSize, halfSize])
      for (const z of [-halfSize, halfSize]) {
        const point = project({ x: center.x + x, y: center.y + y, z: center.z + z });
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
  return { minX, minY, maxX, maxY };
}

/** Clip a cursor segment against an axis-aligned target whose projected
 * bounds move and grow between input samples. Endpoints may both miss. */
export function sweepMovingBox(from, to, before, after, padding = 0) {
  if (!before || !after) return null;
  let enter = 0, exit = 1;
  const clip = (start, end) => {
    if (start < 0 && end < 0) return false;
    const change = end - start;
    if (Math.abs(change) < 1e-9) return start >= 0;
    if (change > 0) enter = Math.max(enter, -start / change);
    else exit = Math.min(exit, -start / change);
    return enter <= exit;
  };
  for (const axis of ["X", "Y"]) {
    const coordinate = axis.toLowerCase();
    if (!clip(from[coordinate] - before[`min${axis}`] + padding,
      to[coordinate] - after[`min${axis}`] + padding)) return null;
    if (!clip(before[`max${axis}`] - from[coordinate] + padding,
      after[`max${axis}`] - to[coordinate] + padding)) return null;
  }
  return { enter: Math.max(0, enter), exit: Math.min(1, exit) };
}

/** A cut still requires a moving, correctly directed cursor, spatial contact,
 * and contact within the note's timing window. Default mouse mode accepts
 * either saber color; single-color mode remains available to explicit callers. */
export function assessPracticeCut({
  from, to, before, after, attackTime, direction = 8, kind = "note",
  noteColor, selectedColor = 0, colorMode = "both", limits = PRACTICE_LIMITS,
}) {
  if (![from?.x, from?.y, from?.time, to?.x, to?.y, to?.time, attackTime].every(Number.isFinite))
    return { hit: false, reason: "invalid" };
  const elapsed = to.time - from.time;
  if (elapsed < 0 || elapsed > limits.maxStrokeSeconds + 1e-6)
    return { hit: false, reason: "stale" };
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < limits.minMovement) return { hit: false, reason: "still" };
  if (kind === "note" && colorMode === "single" && noteColor !== selectedColor)
    return { hit: false, reason: "color" };
  let directionDot = 1;
  if (kind === "note" && direction !== 8) {
    const vector = DIRECTIONS[direction];
    if (!vector) return { hit: false, reason: "direction" };
    directionDot = (dx * vector[0] + dy * vector[1]) / distance;
    if (directionDot < limits.directionDot) return { hit: false, reason: "direction", directionDot };
  }
  const contact = sweepMovingBox(from, to, before, after, limits.padding);
  if (!contact) return { hit: false, reason: "position" };
  const firstContact = from.time + elapsed * contact.enter;
  const lastContact = from.time + elapsed * contact.exit;
  if (lastContact < attackTime - limits.early || firstContact > attackTime + limits.late)
    return { hit: false, reason: "timing" };
  const time = Math.max(firstContact, Math.min(lastContact, attackTime));
  return { hit: true, time, timingError: time - attackTime, directionDot };
}
