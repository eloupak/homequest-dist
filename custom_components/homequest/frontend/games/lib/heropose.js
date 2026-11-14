/* #101 variant A (test only): the hero swings with three front pictures of the motion PoC - angle (rest) -> raise (wind-up) -> swing (end of
 * the cut, with a smear) -> back - cross-faded. Pure functions (tests/js/heropose.test.mjs); the view is views/defend_gate_v2.js. */

// ms after the tap: raise fades in over raiseIn, holds until `raise`, the smear (raise and swing at once) lasts `smear`, swing holds until
// `swing`, then fades back to the rest picture until `back`. The whole move is longer than the lunge (280 ms) so the cut reads on a phone.
export const POSE_T = { raiseIn: 60, raise: 140, smear: 60, swing: 320, back: 480 };

/** Opacity {base, raise, swing} (0..1) of the three pictures `ms` after the last swing; outside the move the rest picture only. */
export function poseWeights(ms) {
  const T = POSE_T;
  const ramp = (a, b, t) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  if (!(ms >= 0) || ms >= T.back) return { base: 1, raise: 0, swing: 0 };
  if (ms < T.raise) { const r = ramp(0, T.raiseIn, ms); return { base: r < 1 ? 1 : 0, raise: r, swing: 0 }; }   // the picture BELOW stays solid while the one above fades in (no see-through)
  if (ms < T.raise + T.smear) { const k = ramp(T.raise, T.raise + T.smear, ms); return { base: 0, raise: 0.6 * (1 - k), swing: 0.5 + 0.5 * k }; }   // smear: both arms
  if (ms < T.swing) return { base: 0, raise: 0, swing: 1 };
  const b = ramp(T.swing, T.back, ms);
  return { base: 1, raise: 0, swing: 1 - b };                                   // the rest picture is under the swing one: solid at once, the swing fades out
}

