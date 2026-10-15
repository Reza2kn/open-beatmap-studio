# Choreography research and implemented design

Research checked 15 October 2026. This document distinguishes implemented browser behavior from research directions. The current generator is original deterministic JavaScript; it does not run an AI model or reuse another automapper's code or weights.

## What makes a playable map

Beat Saber mapping is a motion-design problem as well as an onset-detection problem. The [BSMG basic mapping guide](https://bsmg.wiki/mapping/basic-mapping.html) describes hand parity, vision obstruction, emphasis, and dangerous patterns. These inform our conservative constraints: each hand alternates forehand/backhand; consecutive cut vectors change by at least 135°; hands stay in their own halves; the two inner face-height cells remain empty. Simultaneous doubles use vertical arrows. No crossovers, inward handclaps, towers, or note stacks are generated. Bombs occupy isolated pauses with ample swing clearance. Single-column edge walls preserve the middle two lanes. These constraints reduce common mistakes; they do not prove that any map is comfortable for every player.

The [intermediate mapping guide](https://bsmg.wiki/mapping/intermediate-mapping.html#jump-settings) explains that note jump speed affects timing and should rise only as necessary to preserve readability. Our baseline NJS is 10, 12, 14, 15, and 16 across the five difficulties. High intensity adds one unit for Hard and above. Minimum same-hand intervals are measured in seconds, so a fast song cannot turn a fixed beat subdivision into an unrestricted same-hand stream. NJS and static checks still need headset playtesting.

The [basic lighting guide](https://bsmg.wiki/mapping/basic-lighting.html#assigning-lighting-events) recommends consistent musical roles for light groups. Our lightshow assigns bass/downbeat emphasis to back lights, rhythmic pulses to rings, and alternating texture to side lasers. Persistent center illumination provides visibility; phrase boundaries move rings and alter laser speeds. Builds and energetic sections add staggered accents. The show ends by switching off the five main light groups. This is an approximate musical interpretation, not stem separation or instrument recognition.

## Implemented pipeline

`generateMaps(analysis, controls)` consumes a single BPM, an offset in seconds, the trimmed duration, onset features, energy frames, and section estimates from the local audio analyzer. It returns Easy, Normal, Hard, Expert, and ExpertPlus Standard maps.

1. Convert between seconds and musical beats using `beat = (time - offset) * bpm / 60`. Notes begin after an introductory reaction window and stop before the audio ends.
2. Snap detected events to quarter-beat candidates only when their original times are within 90 ms. A steady musical grid supplies the baseline rhythm; individual onsets increase a candidate's salience. Silence receives no notes or hazards.
3. Combine instantaneous and section energy to thin quiet passages, emphasize stronger downbeats, and retain breathing space. Difficulty controls rhythmic resolution, acceptance density, minimum real-time swing interval, double-hit frequency, spatial distribution, and jump speed.
4. Select one of six seeded 16-beat spatial motifs. Motif identity repeats across four phrases, with hand-local alternation carrying through phrase changes. Flow, dance, technical, and cinematic controls alter that vocabulary. ExpertPlus transforms the spatial motif even when the song offers no meaningful extra subdivisions. Its quarter-beat notes normally require detected acoustic evidence; brief high-energy phrase-end fills are also possible.
5. Reserve sparse phrase-tail pauses for optional bombs: no cut is generated within 0.72 seconds on either side. Easy contains no bombs. Edge-wall phrases redirect affected notes into the available inner column without using face cells. Obstacles use full-height, single-column, positive-duration geometry and do not force crouches or rapid side changes.
6. Produce a portable legacy lightshow and run static checks before exposing export.

The [lightshow specification](https://bsmg.wiki/mapping/map-format/lightshow.html) defines basic light group events and their colored on/flash/fade values. We use red/blue legacy events in the Default environment; modern environment-specific event boxes, white strobes, custom environment objects, and mod-only animation are outside this implementation. Group assignments vary by environment, so previews are illustrative rather than an exact game renderer.

The [beatmap specification](https://bsmg.wiki/mapping/map-format/beatmap.html) defines lane, layer, cut-direction, and obstacle geometry. Internally notes use `{beat,x,y,color,direction}`, bombs `{beat,x,y}`, obstacles `{beat,x,y,width,height,duration}`, and light events `{beat,type,value,floatValue}`. Positions are the standard four-column, three-row grid. Obstacles have `y:0,height:5` for full height. No custom enemy type exists in this generator; bombs and walls provide its hazards.

## Local models: evidence and next steps

Existing open projects support splitting timing, choreography, and lighting into separate tasks:

| Project | Evidence from its own source | Relevance and limits |
| --- | --- | --- |
| [OxAI DeepSaber](https://github.com/oxai/deepsaber) | GPL-3.0 Python/PyTorch generator; README recommends CUDA for the slow second stage. | Historical learned-map baseline. Its documented setup does not establish tiny-model or browser performance. No code or weights imported. |
| [InfernoSaber](https://github.com/fred-brenner/InfernoSaber---BeatSaber-Automapper) | MIT repository; its README describes a convolutional audio autoencoder, a temporal convolution beat detector, a note/bomb classifier, and a light classifier. | A useful staged local-ML reference. Browser conversion, actual weight licensing/provenance, model size, and quality would require a separate audit and benchmark. No model downloaded or run here. |
| [Robo-Saber, Eurographics 2026](https://arxiv.org/abs/2602.18319) | Research generates headset/controller movement from in-game objects, conditioned on movement exemplars and trained on BOXRR-23. | A potential future playtesting direction, not a shipped browser mapper or an implemented safety proof. |
| [Map Inspector](https://github.com/GalaxyMaster2/bs-parity) | Open-source parity-analysis tooling. | A useful independent map-review tool; not integrated, and its results would complement rather than replace player feedback. |

Our recommended next learned component is a *phrase scorer*, rather than a free-form JSON-producing language model. A tiny MLP or decision tree could score a small grammar-valid set of motif choices using energy slope, onset spacing, spectral-band balance, phrase position, desired difficulty, recent hand state, and repetition. Constraint checking would remain deterministic. Training could use explicitly licensed maps and mapper preference comparisons, with artists/songs held out from development and final evaluation. This is a proposed architecture: no scorer is trained, calibrated, or benchmarked in this release. We have no verified Jev-like checkpoint suitable for this task.

This keeps a browser path practical: the current planner needs zero model downloads, and a future small scorer could operate on already extracted features. A local audio beat model can be evaluated independently if it improves timing over the present DSP analyzer. Web inference support, asset sizes, mobile memory, and performance must be measured before selecting any weights.

## Validation and limits

`validateGameplay(map)` returns `{valid,errors,warnings,stats}`. Errors cover invalid grid objects, duplicate notes/bombs, note–bomb overlap, note/bomb–wall intersections, overly fast same-hand repeats, unsafe wall coverage, and inward simultaneous handclaps. Warnings cover suspicious cut-direction transitions, face notes, bombs close to cuts, and rapid opposing wall dodges. `valid` means zero static errors; it is not a comfort, musicality, ranking, or headset-compatibility certification.

The generator tests exercise all five difficulties; deterministic seeds; density/style/intensity effects; silence and changing section energy; hazard clearance; negative/manual offsets; exported timing bounds; sorted lights; malformed-map diagnostics; and 112 combinations of tempo, seed, and style (560 generated difficulty maps). The tempo matrix spans 30–400 BPM. These are synthetic fixtures, not an evaluation on a curated music corpus.

Known limits: section labels are heuristics; timing uses a constant tempo; triplet-specific grids and tempo maps are not implemented; the onset-to-grid tolerance can omit expressive events; motifs do not model a full human skeleton or saber trajectories; edge walls emphasize visual rhythm more than head movement. A mouse preview helps inspect timing and placements but cannot validate physical VR playability. Generated maps should receive real PC and Quest headset playtests and independent mapping feedback before claims of production quality or universal comfort.
