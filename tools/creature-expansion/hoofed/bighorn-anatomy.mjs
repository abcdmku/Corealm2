// Rocky Mountain bighorn proportions. NPS Sheep 101 describes the tight horn
// curl and thick coat: https://www.nps.gov/features/colm/virtualtour/section/hard/activity/sheep-101/
// Coordinates are authored model targets, not measurements of the photographs.
export const BIGHORN_LANDMARKS = Object.freeze({
  eyes: [.139, 1.488, 1.012],
  earBase: [.151, 1.521, .833],
  earCenter: [.260, 1.548, .770],
  earTip: [.365, 1.558, .716],
  neck: [0, 1.125, .510],
  head: [0, 1.470, .925],
  jaw: [0, 1.341, 1.045],
  frontHip: [.220, 1.025, .405],
  frontKnee: [.220, .535, .435],
  frontAnkle: [.220, .120, .450],
  hindHip: [.225, 1.025, -.545],
  hindKnee: [.225, .565, -.400],
  hindAnkle: [.225, .120, -.595],
});

export function bighornAnatomy({ ell, capsule, cavity, s, p }) {
  const bone = s.rig.index;
  const plane = (center, scale, name, power, rotation = [0, 0, 0], blend = .025, weights) => {
    const field = ell(center, scale, name, rotation, blend, weights);
    field.power = power;
    return field;
  };

  // Different rib, flank and loin sections make a deep chest and rising belly.
  // Broad dorsal/flank planes replace the long oval barrel and spherical rump.
  plane([0, 1.061, .025], [.276, .269, .440], 'Body', 2.55);
  plane([0, 1.080, -.400], [.238, .221, .300], 'Body', 2.45);
  plane([0, 1.064, -.628], [.257, .268, .208], 'Body', 2.35);
  plane([0, 1.057, .354], [.254, .333, .259], 'Body', 2.40, [-.06, 0, 0], .029);
  plane([0, 1.291, .277], [.160, .116, .317], 'Body', 2.45, [-.09, 0, 0], .021);
  plane([0, .851, .387], [.173, .145, .203], 'Body', 2.2, [-.14, 0, 0], .028);

  // Narrow scapular planes merge into the chest, with no separate shoulder ball.
  for (const side of [-1, 1]) {
    plane([side * .226, 1.084, .319], [.064, .241, .139], 'Body', 2.35,
      [-.27, 0, side * .07], .021);
    plane([side * .195, 1.014, -.595], [.086, .204, .153],
      `Hind${side < 0 ? 'L' : 'R'}Hip`, 2.2, [.23, 0, 0], .023,
      [[bone.Body, .38], [bone[`Hind${side < 0 ? 'L' : 'R'}Hip`], .62]]);
  }

  // A sloped, muscular neck carries the skull without a pinched throat joint.
  plane([0, 1.246, .558], [.176, .281, .229], 'Neck', 2.25,
    [.52, 0, 0], .032, [[bone.Body, .25], [bone.Neck, .75]]);
  capsule([0, 1.255, .607], [0, 1.460, .818], .126, .114, 'Neck', .024);
  plane([0, 1.483, .918], [.136, .118, .175], 'Head', 2.5, [.12, 0, 0], .022);
  plane([0, 1.399, 1.097], [.091, .077, .183], 'Head', 2.6, [.35, 0, 0], .018);
  plane([0, 1.326, 1.218], [.080, .060, .087], 'Head', 2.6, [.12, 0, 0], .016);
  plane([0, 1.318, 1.106], [.080, .043, .157], 'Jaw', 2.45, [.23, 0, 0], .011);
  for (const side of [-1, 1]) {
    cavity([side * .067, 1.343, 1.268], [.015, .013, .023], [0, side * .20, 0], p.dark);
  }
  return BIGHORN_LANDMARKS;
}
