# Verification record

2026-10-15, initial release. These are measured implementation checks, not a claim of ranked-map quality or headset certification.

## Automated

`npm test`: **50 tests passed**, zero failures. This includes real synthesized PCM passed through the audio analyzer, trimming at nonzero times, five-difficulty generation, advanced native lighting, real WASM Vorbis encoding, map validation and ZIP round-trip. The choreography matrix spans 560 tempo/seed/style/difficulty combinations. Export tests include unusual BPM, positive/negative offsets, index filters, native rotation axes, brightness-wave tails, corrupt audio and malformed JSON.

`npm run build`: production static build passes. The main Three.js application bundle is about 164 KB gzipped. The worker's encoder is a separate, locally served asset. Vite warns about chunks above 500 KB before compression; no remote inference or codec CDN is used.

## Browser and media checks

- Studio loads and auto-generates its original sixty-second demo.
- Five difficulty tabs update note/hazard statistics and static pattern safeguards. Current demo at default seed/density gives 42, 80, 123, 156 and 166 notes from Easy through Expert+; 0, 3, 3, 3 and 3 bombs.
- Playback/pause, waveform section seeking, difficulty switching, choreography selection, trim editing and regeneration checked interactively.
- A 9.3–46.7-second trim produces a 37.4-second working segment. Edits disable stale preview/export until regeneration.
- Actual Ogg file import and decoded FLAC import exercised through the browser file chooser.
- Mouse practice starts after a seek without retroactively scoring all earlier notes. A source audit also found/fixed practice replay reset and zero-motion preview inconsistency. Actual human mouse scoring accuracy and VR comfort are not established.
- Browser worker generated a downloadable ZIP containing Info.dat, five difficulty files, PNG cover and song.ogg. Unpacked with Python; FFprobe confirmed Vorbis, 44,100 Hz stereo, 60.000000 seconds. Native Weave color and rotation arrays are present in each difficulty. Later revisions add dynamics/denser Expert+ choreography while retaining the same export pipeline.
- Wide and narrow layouts inspected. The desktop viewport override on the in-app browser was inconsistent with its screenshot surface; screenshots from the restored actual responsive viewport are retained rather than claiming automated pixel-perfect desktop acceptance.

## Live YouTube companion check

The existing user-global yt-dlp launcher referenced a removed Python interpreter. The isolated project-local setup installed yt-dlp 2026.8.19 and dependencies without modifying that launcher. The initially requested Vorbis conversion exposed a system FFmpeg build without libvorbis; the bridge now emits lossless FLAC and the browser performs the final Vorbis encoding.

A live HTTP bridge import of Blender's [Sintel trailer](https://www.youtube.com/watch?v=HOfdboHvshg) returned HTTP 200 and 8,791,150 bytes. FFprobe confirmed stereo FLAC, 48,000 Hz, 52.224 seconds. This copyrighted test asset is not bundled or published with the project. The generic yt-dlp test video was unavailable; no cookies or account access were used. Live access remains dependent on YouTube and downloader behavior.

## Remaining external acceptance

- Actual import/playback on both PC and Quest, with explicit game/loader versions.
- In-headset movement, reach, readability, bomb/wall comfort and lighting frame-rate review.
- Exact Weave fixture appearance, environment/color scheme overrides and show aesthetics in game.
- Broad browser/codec/device matrix, screen-reader and keyboard acceptance, touch-device practice support.
- Representative real music evaluation, variable-tempo alignment and expert mapper feedback. Current BPM/phrase/drop labels are heuristics.
- Hosted-page-to-loopback YouTube import can depend on browser mixed-content/local-network policy. The localhost studio is the reliable intended bridge configuration.

## First rhythm revision, later rejected by the user, 2026-10-15

The initial release's passing structural tests did not establish musical quality. The user's supplied “512” recording is now the local regression fixture; its SHA-256 is checked locally so the test cannot silently substitute another recording. The source repository contains no recording or beat-reference asset. `tests/real-audio.test.js` reads the ignored local fixture configuration or `BEATMAP_TEST_AUDIO`; clean public CI explicitly skips that private-file test.

Measured against independent Beat This! small0 estimates over the reliable 8–160-second main body, the failing old mono analysis was about 154 ms off at the median. The repaired analyzer is about 8 ms off at the median, with p90 about 19 ms. These are reference-model agreement figures, not human annotations. Gain/channel/sample-rate perturbations no longer trigger the observed 176 BPM/wrong-phase flip. The corrected DSP pulse is 87.998 BPM; the model's fitted estimate is about 88.002 BPM.

Random grid thinning was removed. The new mapper selects observed attacks, preserves their precise times and syncopations, simplifies the musical rhythm by difficulty, and assigns recurring rhythm families consistent movement vocabulary. Changing the seed changes movement vocabulary without inventing another note rhythm. Bombs use natural rests instead of deleting musical events to create hazard gaps.

On the mono diagnostic path, the old Hard map placed about 45% of its notes within 35 ms of a refined detected attack; the old stereo map reached about 66%. Every note in the new maps preserves an observed attack timestamp to within beat-serialization rounding (<0.04 ms). That preservation is a pipeline property measured against the app's own detections, not independent proof that every detection is musically appropriate. The same path generated 134/201/355/508/720 notes; browser decoding at 48 kHz can change a few marginal attack selections. All five passed static movement checks.

Preview timing now follows the speaker-output clock where available, falling back to reported output latency. A visible cut frame and automatic preview cuts mark each intended hit; blocks no longer continue looming past the player for a quarter-second in autoplay. Beat-click and note-click modes provide audible timing review, scheduled on the same audio clock. Waveform annotations show generated hit timestamps. BPM controls retain millibpm precision instead of rounding the estimate to one decimal place on regeneration.

Remaining acceptance is listening and gameplay judgment across varied music and actual headsets. Exact timestamp preservation, static checks and model agreement do not certify aesthetic quality or VR comfort.

The corrected source passes **59 local tests**, including the private recording regression. Public CI runs the same suite with the explicitly unavailable private-song case skipped. The source build passes. The reference model's temporary Python environment was removed after verification; its local beat estimates, provenance and aggregate diagnostics are retained.


## Drum-first replacement after second rejection, 2026-10-15

The user rejected v0.2 throughout the song. The earlier 8 ms model-agreement figure described the **estimated regular beat grid**, not the generated note sequence. Exact alignment to the application's own onset detections was circular evidence for musical quality and did not justify calling the map rhythm repaired.

A separate audit found no sustained export-audio timing offset: cross-correlated four-second windows at 8/60/140/188 seconds differed from the original recording by approximately 0/0/4/0 ms. The old Easy map covered only about 47% of independent model quarter-beat positions over 12–156 seconds; its 51 main-body bars contained 13 distinct rhythm masks and adjacent-bar Jaccard agreement of 0.369. This supports an arrangement/selection failure even when most selected attacks lie near a sixteenth-note subdivision.

The replacement uses pulse positions as a timing reference and selects recurring kick/snare attacks as its primary groove. Drumless passages use rhythmic melodic attacks. Easier difficulties use stable subsets; isolated weak events do not become filler notes. Native lighting accents use the same arranged rhythm. The optional local companion now supplies both learned Beat This! timing and a Demucs drum stem to the production mapping pipeline; it is not merely a test reference. Downbeats and model probabilities remain estimates, and inconsistent meter is reported rather than asserted.

Full-song evidence and final test outcomes are recorded below after validation. Neither pulse coverage nor model agreement establishes expert choreography or subjective musical quality; human listening and headset playtesting remain required.

Browser HPSS was checked against attacks extracted from an independently learned htdemucs stem of the exact recording. Over 22–188 seconds, drum-role note agreement within 50 ms was 100% / 98.9% / 94.7% / 93.4% / 93.0% from Easy through Expert+. Coverage of the louder half of independent stem attacks was 37.1% / 76.4% / 90.3% / 90.7% / 98.7%. The thresholds describe this regression recording and are not a general accuracy benchmark. Melodic-role notes in drumless sections are evaluated separately rather than incorrectly counted as false drum hits.

The first independently separated main kick is at about 22.070 seconds. Its groove follows pulse phases 0, .75, 1, 1.5, 2, 2.75, 3, 3.5. Before that drum entry, the new mapper uses rhythmic melodic attacks. The local neural production option isolates an actual htdemucs drum stem before detecting those physical attacks; browser-only HPSS remains a faster approximate alternative. Learned separation and beat tracking run locally, and no song/stem/checkpoint is published with the site.

The production mono-PCM neural path completed the full recording with 476 isolated-stem attacks, none before 22 seconds. Its attack sequence agreed within 40 ms with 97.9% of events from the earlier independent stereo-input separation, covering 98.1% of that stereo reference. These are two input paths through the same separator, not an independently labeled recognition benchmark. The standalone warmed CPU run took 90.7 seconds; concurrent browser runs can take longer. The Node suite passes 73 tests, including the private real-song checks; six Python model-helper tests also pass. The production frontend builds successfully.

Final browser QA also exposed a development-only encoder dependency optimization reload that discarded the uploaded track on first export. The codec is now explicitly prebundled for development; final export acceptance uses the built production frontend, where dependency optimization/HMR is absent.

Production-browser end-to-end acceptance passed on the supplied MP3: local neural separation/tracking, piano-intro and drum-entry playback/seeking, native rhythm lighting, worker encoding and ZIP download. The downloaded export contains 123/245/495/532/580 notes across five difficulties, and 4,536 color plus 1,168 rotation groups per difficulty. Reopened ZIP validation reports zero errors/warnings; FFprobe confirms real stereo 48 kHz Vorbis and 195.860-second duration. The user's audio and generated maps remain local. This establishes the implemented signal/export path; subjective musicality and in-headset acceptance remain unverified.

## Preview clicks and denser difficult maps (v0.3.1)

Note clicks now default on and follow the currently selected difficulty; the timing control also shows the number of distinct hit times. Simultaneous saber notes produce one click. Click-off and beat-grid review remain available.

The learned path now analyzes the separator's instrument stem as well as its drums. Band-balanced transient detection adds quieter percussion detail, and the arranger layers recurring instrumental attacks into drum passages. Expert+ also admits supported finer/quiet instrument fills. Strong drum anchors take priority; higher profiles retain the accepted rhythm of the previous harder profile while adding playable detail. No uniform-grid filler is added.

On the exact local “512” file, the full CPU model plus default 65% density produced 119 / 236 / 570 / 660 / 949 distinct hit times across the five difficulties (119 / 236 / 582 / 690 / 1,004 note objects). The previous neural revision had about 493 distinct Expert+ hit times. These counts establish increased rhythmic coverage, not ranked difficulty or human gameplay quality. Every proposed timestamp still refers to a detected instrument/percussion attack; hand intervals and collision checks remain active. Private source audio, stems and model outputs are excluded from publication.
