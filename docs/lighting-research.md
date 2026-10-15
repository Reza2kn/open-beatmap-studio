# Native rhythm-directed lightshows

Checked 2026-10-15. `src/lighting.js` implements a deterministic, local show director for Beat Saber's **native v3 event-box system**. It requires no Chroma/Noodle extensions, inference service, model weights, or separate runtime. Game appearance and headset performance still require physical PC/Quest playtesting; browser artwork does not establish game parity.

## Verified environment and format

Weave supports both basic and group lighting, with authored symmetry around its square layout. The official documentation explains spatial wave/step timing, index filters, brightness distributions, independently controlled rotation axes, and eased rotation transitions. [Official environment guide](https://beatsaber.com/documentation/environment-specific-lighting-attributes-and-explanations/index.html), [official group-lighting guide](https://beatsaber.com/documentation/the-group-lighting-event-system/index.html).

The maintained `bsmap` source lists **WeaveEnvironment groups 0–15**. Groups **12 and 13 contain 12 fixtures**, all others contain 8. All support color and X/Y rotation; none supports translation or Z rotation. These IDs/counts/capabilities are encoded explicitly in `LIGHTING_ENVIRONMENT`. The generator does not invent physical names for groups or assume that numeric ordering identifies exact fixture positions. Its bank choices are artistic selections among verified group IDs. [Environment capability source](https://github.com/KivalEvan/BeatSaber-JSMap/blob/main/src/beatmap/misc/environment.ts#L496).

The emitted JSON uses v3.0 color and rotation groups. A group has `b` (grid beat), `g` (environment group ID), and `e` (event boxes). Color boxes use division filters, wave-duration distribution, brightness distribution, and relative color events. Rotation boxes specify X/Y axis, rotation distribution, and relative angle/easing events. Color transition type 0 is instantaneous, 1 is a fade; rotation transition type 0 interpolates according to its easing. Every color event has strobe frequency `f:0`. [BSMG lightshow schema](https://bsmg.wiki/mapping/map-format/lightshow.html). Easing `-1` is none and `3` is InOutQuad. [Easing enumeration](https://github.com/bsmg/wiki/blob/master/wiki/.assets/parts/easings.md).

`lightTranslationEventBoxGroups` is deliberately empty because Weave has no verified translation support. Moving light beams use the native rotation system. This is a real exported effect; the browser's separate shapes are a stylized interpretation.

## How musical features direct the show

The director merges whole-beat anchors with detected acoustic onsets and phrase boundaries. Coincident onset evidence augments the anchor; extra accents are thinned at a 0.22-second spacing. Low/mid/high **spectral-flux proportions** weight bass impacts, mid accents and treble stabs. They are not a learned drum/instrument classifier. Short-window RMS supplies local energy; sixteen-beat analysis sections supply phrase energy.

Six recurring motifs change exported bank selection, wave timing, complementary color halves, fan spread and rotation cycle, as well as the browser cues:

| Motif | Native behavior |
| --- | --- |
| Ribbon | Rolling color waves across selected banks, moderate fan spread |
| Orbit | Cycling banks with a twelve-beat rotation cycle |
| Fan | Broad bass accents with wide distributed beam angles |
| Helix | Alternating color/direction across banks, quicker rotation cycle |
| Tunnel | Cycling blocks of four group IDs, slow compact rotations |
| Diagonal | Paired complementary banks and alternating group color assignment |

Phrase states add **breath** (dim sustained atmosphere), **rise** (more banks enter across the phrase), and **bloom** (all-bank impact on a strong energy increase). Drop decisions are heuristic changes in section energy, not neural beat-drop recognition. A seed gives repeated phrases identity and changes motif/movement choices reproducibly. Color choices use primary/secondary game colors; the exact displayed palette also depends on the selected game color scheme.

Color waves use two spatial halves with complementary colors and a gentle brightness gradient, then fade to a dim tail. Low-energy rests explicitly extinguish all banks. X/Y beams move in eased four-beat segments with distributed fans, avoiding random frame-to-frame angle jumps. Intensity scales brightness; motion scales sweeps/fans and zero motion removes rotation groups. All fixtures receive an explicit final blackout. Native strobe frequencies and added 360-degree rotation loops remain zero. This is a design choice, not a photosensitivity certification.

## API and timing

```js
const lightshow = generateLightshow(analysis, {
  intensity: 0.7, // 0–1
  motion: 0.65,  // 0–1; 0 emits no native rotation groups
  seed: 42,      // number or string
  enabled: true,
});
// {
//   environment: 'WeaveEnvironment',
//   lightColorEventBoxGroups: [...native v3 JSON],
//   lightRotationEventBoxGroups: [...native v3 JSON],
//   lightTranslationEventBoxGroups: [],
//   basicEvents: [{beat,type,value,floatValue}],
//   previewCues: [...], stats: {...}
// }
```

Input is the `analyzeAudio` contract: `bpm`, `offset`, `duration` seconds, normalized `energy` frames with `frameDuration`, timestamped `onsets`, `sections`, and optional `silent`. Inputs are not mutated. Disabled, silent, or zero-intensity shows return empty collections. Duration must be greater than zero and at most two hours; BPM must be 30–400.

Native top-level `group.b` and basic-event `beat` use **`(time - offset) * bpm / 60`**. They may initially be negative for a positive audio-grid offset. The exporter must add `offset*bpm/60` exactly once to these top-level fields. **Nested event `b` values remain relative offsets and must never receive that shift.** Wave durations and nested tails fit inside the audio. Native arrays are chronologically sorted. The export agent's integration test exercises non-round BPM and positive/negative offsets.

Each preview cue has this exact shape:

```js
{
  time, beat,             // time: seconds from trimmed audio; beat: editable grid
  energy, bass, mid, treble, // normalized local descriptors 0–1
  phase,                 // quiet | build | drop | peak | flow | end
  pattern,               // ribbon | orbit | fan | helix | tunnel | diagonal |
                         // breath | rise | bloom | blackout
  color,                 // 0 primary, 1 secondary
  intensity, motion,     // normalized user controls
  brightness, fan,       // 0–1, intended scene brightness and beam spread
  sweep,                 // −1..1
  beamAngle,             // radians, approximately −PI/3..PI/3
  phraseProgress,        // 0–1 across a sixteen-beat phrase
  duration,              // suggested visual envelope duration in seconds
  impact,                // normalized transient visual impulse
  groups,                // selected verified native IDs, array of 0..15
}
```

The preview should interpolate brightness and beam geometry, decay `impact`, and use `phase`/`pattern` for visual composition. It is a music-synchronized artistic stage, not a reconstruction of licensed Weave assets or a reference implementation of the game's event interpreter. Cue motif names such as “tunnel” describe choreography; they are not verified physical names for environment fixtures.

`stats` reports color/rotation/translation group counts, color-event count, preview-cue count, unique pattern/phase names, strobe-event count, environment-group count and `native:true`.

## Verification and remaining evidence

`tests/lighting.test.js` covers verified groups/axes, native gradients and waves, relative event tails at unusual BPM/offset, deterministic seeds, sensitivity to frequency balance, quiet/build/drop/peak transitions, density thinning under a crescendo, zero-motion/intensity controls, silence/final blackout, and invalid timing. Export integration additionally validates actual generated JSON against the application's conservative native profile. These are structural and synthetic musical tests. They do not establish aesthetic quality, exact in-game fixture transforms, frame-rate budget, or successful Quest/PC playback. A representative song set and in-headset review remain the next validation step.
