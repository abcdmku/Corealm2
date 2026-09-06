// Isolated source proposal. This module never writes files or promotes assets.
// Run applyMonitorAnatomySource on reptiles/monitor.mjs only after its owner agrees.
// Dimensions are authored game proportions, not measurements from photographs.
export const MONITOR_ANATOMY_REVIEW = Object.freeze({
  status: 'CPU proposal; requires rebuilt skin, clip audit and hardware lab review',
  inspectedViews: ['front', 'side', 'rear', 'gameplay', 'run'],
  evidenceDirectory: 'test-results/finish-quadrupeds-catalogue/shard3',
  source: 'tools/creature-expansion/reptiles/monitor.mjs',
  references: [
    { url: 'https://fieldofmar-e.schools.nsw.gov.au/fact-sheets/reptiles/lace-monitor-fact-sheet', basis: 'Long neck, muscular tail, strong curved claws and contrasting cream markings on dark skin.' },
    { url: 'https://animals.sandiegozoo.org/animals/komodo-dragon', basis: 'Monitor family reference for muscular tail and long powerful claws.' },
  ],
  findings: [
    'Front and rear show inflated proximal limbs tapering into nearly vertical narrow shins.',
    'Side shows a sudden neck waist and an elbow bulge that reads as an upper arm.',
    'Gameplay view exposes five evenly fanned digits and broad flat palms.',
    'Run retains the same shoulder and thigh balloons; a sampled run image cannot prove contact.',
  ],
  acceptance: [
    'Continuous shoulder transition without a projecting round cap in front, side and rear views.',
    'Elbows extend outward with substantial tapering forearms; wrists and digits remain readable.',
    'Asymmetric digit lengths and angles, arched knuckles and hooked claws replace flat star hands.',
    'Regenerate all clips from the changed rest joints. Audit every weighted vertex and stance foot.',
    'Inspect idle, walk, run, bite, hit and settled death in the hardware production lab before promotion.',
  ],
});

// Each exact anchor deliberately fails on drift. No replacement can silently
// affect another species, and the original source remains untouched on failure.
export function applyMonitorAnatomySource(input) {
  let source = input.replace(/\r\n/g, '\n');
  if (!source.includes("export async function buildMonitor()")) throw new Error('Expected monitor source');
  const edits = [
    ["hind ? .55 : .645, hind ? -.52 : .49", "hind ? .55 : .615, hind ? -.52 : .49"],
    ["side * (hind ? .62 : .565), hind ? .295 : .325, hind ? -.72 : .26", "side * (hind ? .66 : .65), hind ? .265 : .275, hind ? -.70 : .24"],
    ["side * (hind ? .70 : .635), .085, hind ? -.42 : .78", "side * (hind ? .78 : .75), .085, hind ? -.42 : .76"],
    ["hind ? [.165, .245, .325, .305, .215] : [.125, .205, .26, .228, .148]", "hind ? [.120, .195, .285, .310, .185] : [.105, .180, .235, .220, .135]"],
    ["const spread = (digit - 2) * .037;", "const spread = [-.048, -.025, 0, .028, .051][digit];"],
    ["angle: (digit - 2) * .26 * side", "angle: [-.46, -.17, .055, .23, .60][digit] * side"],
    ["[.62, .667, .254, .207], [.78, .737, .199, .176], [.96, .892, .159, .141],\n    [1.115, .997, .129, .111]", "[.62, .681, .246, .195], [.78, .773, .215, .168], [.96, .902, .181, .143],\n    [1.115, .997, .147, .112]"],
    ["i0: middle - 5, i1: middle + 5, j0: around - 3, j1: around + 3", "i0: middle - 3, i1: middle + 3, j0: around - 2, j1: around + 2"],
    ["hind ? [.096, .171, .166, .105, .070, .029] : [.078, .144, .125, .086, .053, .026]", "hind ? [.092, .128, .118, .091, .075, .033] : [.078, .107, .098, .078, .064, .031]"],
    ["hind ? [.103, .140, .138, .096, .063, .023] : [.082, .120, .108, .083, .049, .020]", "hind ? [.091, .116, .103, .083, .063, .026] : [.076, .098, .090, .073, .055, .025]"],
    ["[.047, .085, .060], [.042, .054, .032]", "[.035, .061, .046], [.034, .048, .029]"],
    ["knuckle.y = .035;", "knuckle.y = .049 + .006 * Math.cos(toe.angle);"],
    ["end.y = .021;", "end.y = .020;"],
    ["[.022, .023, .014], [.020, .023, .013]", "[.020, .018, .011], [.019, .021, .010]"],
    [".027).add(V(0, .012, 0))", ".023).add(V(0, .023, 0))"],
    ["for (let i = 0; i < 6; i++) {\n    const z = .756 + i * .050", "for (let i = 0; i < 4; i++) {\n    const z = .774 + i * .064"],
    ["const height = .0038 *", "const height = .0018 *"],
    ["ash: new THREE.Color('#66705d'), slate: new THREE.Color('#4d584b'), pale: new THREE.Color('#a0aa80')", "ash: new THREE.Color('#4c534a'), slate: new THREE.Color('#353c34'), pale: new THREE.Color('#b3b293')"],
    ["if (spots > .48) c.lerp(colors.pale, .30);\n      else if (spots < -.6) c.lerp(colors.dark, .27);", "if (spots > .40) c.lerp(colors.pale, .53);\n      else if (spots < -.52) c.lerp(colors.dark, .38);"],
  ];
  for (const [before, after] of edits) {
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`Monitor source changed: expected one anchor, found ${count}: ${before}`);
    source = source.replace(before, after);
  }
  return { source, edits: edits.length, acceptance: MONITOR_ANATOMY_REVIEW.acceptance };
}
