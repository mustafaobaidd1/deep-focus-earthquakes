/**
 * Preset cross-sections, drawn roughly perpendicular to each plate boundary. Following the usual
 * convention for sections (and matching a north-up globe, where east is always to the right),
 * east–west profiles run from A in the west to A′ in the east; north–south ones from A in the
 * south to A′ in the north. The Dead Sea Transform is the deliberate contrast: a strike-slip
 * boundary with no slab.
 */
export interface Preset {
  id: string;
  /** Short label for buttons. */
  name: string;
  /** Title of the section figure. */
  title: string;
  region: string;
  a: [number, number];
  b: [number, number];
  halfWidthKm: number;
  /** What to look for — a sentence or two, checked against the catalogue. */
  caption: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'tonga',
    name: 'Tonga',
    title: 'Tonga–Kermadec subduction zone',
    region: 'Southwest Pacific, 18–20° S',
    a: [-17.8, 179.0],
    b: [-20.0, -172.0],
    halfWidthKm: 120,
    caption:
      'The Pacific plate sinks westward beneath the Tonga arc. Its earthquakes trace a single sheet from the trench down to almost 700 km — the deepest seismicity on Earth. The 2018 M 8.2 Fiji earthquake, 600 km down, lies on this slab.',
  },
  {
    id: 'honshu',
    name: 'Japan · Honshu',
    title: 'Japan Trench beneath northeast Honshu',
    region: 'Northwest Pacific, 38° N',
    a: [39.5, 131.0],
    b: [37.5, 145.0],
    halfWidthKm: 200,
    caption:
      'The Pacific plate dives west under Honshu at a shallow angle. The dense cluster near A′ is the 2011 M 9.1 Tōhoku rupture and its aftershocks on the plate interface; the slab continues, more sparsely, to about 550 km beneath the Sea of Japan.',
  },
  {
    id: 'chile',
    name: 'Chile',
    title: 'Nazca plate beneath northern Chile and Argentina',
    region: 'South America, 22–26° S',
    a: [-22.0, -72.0],
    b: [-26.0, -62.0],
    halfWidthKm: 200,
    caption:
      'The Nazca plate descends east under the Andes. Intermediate-depth earthquakes follow it to about 300 km; after a quiet gap with none between 300 and 500 km, a separate band of deep earthquakes near 550–600 km lies beneath northern Argentina.',
  },
  {
    id: 'aleutians',
    name: 'Aleutians',
    title: 'Aleutian arc',
    region: 'North Pacific, 175° W',
    a: [50.0, -175.0],
    b: [55.0, -176.5],
    halfWidthKm: 250,
    caption:
      'The Pacific plate subducts north beneath the Aleutian Islands. At magnitude 5 and above its Wadati–Benioff zone is traced to about 250 km, steeper than beneath Japan.',
  },
  {
    id: 'sumatra',
    name: 'Sumatra',
    title: 'Sunda subduction zone beneath southern Sumatra',
    region: 'Indian Ocean, 0–5° S',
    a: [-5.0, 100.5],
    b: [0.0, 106.0],
    halfWidthKm: 250,
    caption:
      'The Indo-Australian plate subducts northeast beneath Sumatra. The 2007 M 8.4 Bengkulu earthquake ruptured the shallow interface near A; the slab is seismically active to about 300 km.',
  },
  {
    id: 'hindukush',
    name: 'Hindu Kush',
    title: 'Hindu Kush intermediate-depth zone',
    region: 'Central Asia, 36.5° N',
    a: [35.2, 70.6],
    b: [37.4, 71.0],
    halfWidthKm: 60,
    caption:
      'Far from any ocean trench, a nearly vertical slab of lithosphere beneath the Hindu Kush produces frequent intermediate-depth earthquakes down to about 270 km — a continental cousin of the oceanic slabs.',
  },
  {
    id: 'aegean',
    name: 'Aegean',
    title: 'Hellenic subduction zone',
    region: 'Eastern Mediterranean, 25° E',
    a: [34.2, 24.2],
    b: [38.6, 25.6],
    halfWidthKm: 200,
    caption:
      'The African plate subducts north beneath Crete and the Aegean Sea, and intermediate-depth earthquakes beneath the volcanic arc reach about 170 km. Only a few dozen of them reach magnitude 5, so the fitted dip is loosely constrained.',
  },
  {
    id: 'deadsea',
    name: 'Dead Sea Transform',
    title: 'Dead Sea Transform (contrast)',
    region: 'Levant, 28–35° N',
    a: [28.5, 34.7],
    b: [35.5, 36.2],
    halfWidthKm: 100,
    caption:
      'A strike-slip boundary where the Arabian and African (Sinai) plates slide past each other. Nothing is subducting, so every earthquake stays in the upper crust: there is no slab to fit.',
  },
];

export const FEATURED_PRESET = PRESETS[0];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
