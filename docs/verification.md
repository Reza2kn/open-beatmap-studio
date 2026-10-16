# Verification record

2026-10-15, initial release. These are measured implementation checks, not a claim of ranked-map quality or headset certification.

## v0.4.1: local connection instead of per-tab key copying

The user's hosted tab remained disconnected after an agent populated a different tab's input. That did not fix the user's connection. The companion now serves the built studio itself at `/studio/`, preceded by a local `/connect` form. A single-use form nonce and exact local Origin check establish an HttpOnly, SameSite=Strict session. Reloads use that session; neither the bearer key nor session credential is placed in page JavaScript or a URL. A restart requires reconnecting. Model/import endpoints remain authenticated, and another origin cannot borrow the local cookie.

The hosted UI exposes **Open local neural studio** and a visible connection status. Generating without a hosted key opens actionable connection instructions before analysis instead of throwing the former empty-key error. Local studio selects neural mode and uses its authenticated session. A bounded health check precedes neural inference so unreachable companions fail with a connection action rather than entering a long inference wait. Tests cover pairing, reload authentication, model POST, unauthorized requests, nonce replay, other-origin cookie rejection and file-path containment.

## v0.4.0: timing defects and difficulty recalibration

The user still found v0.3.1 partially off beat and requested that its Hard become the new Easy baseline. Earlier structural checks and model-agreement figures did not settle that listening complaint.

The browser percussion detector proposed attacks by frequency band but refined every candidate on the same full-band transient waveform. A stronger neighboring sound could therefore take a weaker sound's timestamp. Refinement now uses independent forward/reverse filtered bands, without causal filter group delay. A known-time regression mixes a quiet hat at 1.000 seconds and a loud kick at 1.040 seconds: the old full-band refinement chooses the later kick, while the corrected band-specific refinement recovers both attacks within 12 ms. On the private recording, 77 matched percussion candidates move by more than 15 ms. This count demonstrates an active code change, not proof that every moved candidate is musically correct.

Transport regressions also reproduced overlapping sources after concurrent pending Play requests, and a visual jump at the end before the device's buffered tail finished. Pending starts are now coalesced/cancelled, stale source callbacks are ignored, and playback completion follows the audible clock. Click scheduling remains on the same source clock. These are demonstrated defects; neither has been established as the cause of the user's full-song complaint.

Easy now retains the former Hard profile's rhythmic capacity. Upper profiles add supported rhythmic detail, accent doubles and movement complexity while keeping core percussion priority and static physical constraints. Difficulty calibration cannot justify inventing note timestamps or retaining questionable detector output.

The optional neural instrument detector previously ran the drum-detail detector on the separator's `other` stem, then relabeled every result melodic. This promoted band-normalized noise, sustained modulation and voice leakage into note candidates. A separate instrument detector now requires tonal/amplitude or spectral-change evidence, an audibility floor, and a veto for dominant coherent vocal leakage. The browser also drops legacy instrument events explicitly marked as drum details and asks users of an old companion to update.

The corrected full production entry point was run on the exact private recording with cached local models: 511 drum candidates and 373 instrument candidates, compared with 1,277 old instrument candidates. An independent stereo-stem analytic-amplitude audit found instrument-candidate support within 20 ms increased from 53.5% to 75.9%, and within 40 ms from 78.2% to 94.1%; unmatched candidates farther than 80 ms fell from 60 to 1. These are detector-agreement measurements, not manual musical annotations. Residual onset uncertainty remains. All four added hat candidates had independent high-band rises within 20 ms; the audit did not justify loosening gates to manufacture additional hats.

Known-time helper tests cover piano-like attacks, dominant vocal leakage and sustained modulation, in addition to the browser's neighboring-kick case. No global song offset was introduced: separate codec cross-correlations showed 0 ms lag in five passages, and core drum timing had no consistent delay that warranted shifting the entire map.

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

## v0.5 entirely browser neural mode and WebGPU — 2026-10-16

The companion/key/second-studio requirement is removed from uploaded-file neural analysis. Beat This! small0 and a 118 MB HTDemucs learned core execute in sequential browser workers with WebGPU preferred. JavaScript handles spectrograms, inverse STFT and physical attack extraction. Static model/runtime assets are same-origin, checksum verified and cached; no song is uploaded. A fresh-worker WASM retry is visible on GPU failure. Optional YouTube downloading still uses its separate importer.

The direct all-in-one 166 MB Demucs graph did not work on tested WebGPU because its unrolled reconstruction graph failed provider placement. Extracting the unchanged learned core and reconstructing via a verified complex inverse FFT removes that boundary. Direct PyTorch/core+JavaScript waveform agreement and numerical Beat This! parity are documented in [browser core](browser-demucs-core.md) and [beat conversion](browser-beat-model.md).

Actual browser tests used the supplied private 195.86-second recording, with no localhost companion listening on 4174. The production build completed the full song in 98 seconds with cached model files and reported **Beats: WebGPU · Drums: WebGPU**. A separate instrumented browser test counted 885 GPU compute dispatches for a short Beat This! run and 1227 for one Demucs chunk; this is actual GPU work, not merely an available-adapter check. CPU preprocessing/reconstruction and metadata operations remain CPU work. These are measurements on this computer, not a mobile/other-device speed promise.

The actual GUI exported all five difficulties at 88.001 BPM. Reopened ZIP validation reported zero errors/warnings. Notes were 499/574/655/682/694; distinct hit times 480/529/560/586/599. Every difficulty includes 4504 native color groups and 1168 rotation groups. FFprobe confirms real stereo 48 kHz Vorbis with 195.860-second duration. The private recording, stems, generated maps and per-sample evidence remain excluded from source publication. More notes and model parity do not establish subjective musical quality or headset comfort.

Mouse practice now tests a swept cursor against the visible moving cube's projected bounds. Primary-button swipes work for either color. Coalesced movement, final pointer-up strokes and timing grace are covered. Actual Stage input tests cut 20/20 cubes across lanes/rows/arrow directions, and real browser drags visibly scored cuts. Hovering, stationary/paused input and reversed strokes still do not score.

Typography was enlarged about 2.2 times, with 18 px minimum visible explicit text and generally 22–28 px help/control text. Larger targets, wrapping and responsive stacking fit a 390 px viewport without horizontal document overflow. Browser desktop/fullscreen practice was also checked.

The Node suite passes 119 tests, including runtime transport integrity, ordered model-shard reconstruction, model math/parity, fresh-worker fallback/cancellation, mouse geometry/input, existing gameplay/export/audio regressions and the private song fixture. Source build passes. Published-route checks are recorded after deployment below.

Explicit CPU neural mode was also exercised through the production browser build on a five-second excerpt: both learned models completed on WASM in 16 seconds and produced the same seven Hard hit times as the GPU excerpt run. Cancellation restored the loaded track for retry; the unit regression also verifies that cancellation never launches an unwanted CPU retry.

## v0.5 fast default after latency feedback — 2026-10-16

The user set a cached full-song generation target below ten seconds. The default now runs Beat This! small0 plus browser DSP attacks, with full HTDemucs separation explicitly optional. Actual production-browser upload of the same 195.86-second MP3 completed in **9.1 seconds total** (file decode through five maps/native lighting), reporting **Beats: WebGPU · Drums: DSP**. ZIP encoding/download took a further 3.2 seconds. First-use downloads and CPU/other hardware are outside this single cached WebGPU result.

The downloaded fast ZIP passed static validation with zero errors/warnings. Easy through Expert+ contain 556/584/679/689/698 note objects and 548/569/629/629/629 distinct hit times. Each difficulty contains 6,796 native color/rotation groups. Expert profiles can add movement/double notes after supported acoustic timing density saturates; extra subdivisions are not invented to inflate counts.

Compared against an independently generated Demucs-stem attack reference over seconds 22–188, actual Hard ZIP hit times cover 99.2% (fast) / 99.6% (full) of the stronger half of stem attacks within 50 ms. All-hit agreement is 71.1% / 74.4%, with median nearest-stem distances 7.3 / 0.03 ms. These all-hit comparisons include melodic and pulse notes against a drum-only reference; they are not a drum precision/false-positive measurement or human annotation. The fast mode retains the same learned pulse while trading stem isolation for latency; it is not presented as a quality upgrade over full separation.

A compact full-mixture drum classifier and a small E-GMD drum transcription network were also investigated privately. The former has unresolved explicit checkpoint licensing/recall limitations; the latter is trained on isolated drums and performed poorly on this mixture. Neither is bundled or silently substituted for a verified model.

All 120 Node tests pass, including the private real-song comparisons and a regression that fast mode creates only the beat worker and preserves DSP attack timestamps. The production build passes.

## Compact workspace without reducing type — 2026-10-16

At the normal 1280×720 browser viewport, the prior full-song page measured 3,242 px tall. The compact workspace measures 1,372 px with the same supplied full recording loaded: approximately 52.5% of the page is visible at once instead of 22.2%. The page-top view includes Generate, Export, the full preview, playback, Mouse practice and timing-click controls. Body labels remain 24 px, help 22 px, difficulty controls 24 px and the main heading 61.952 px at this viewport.

Track and Map & lights panels now use accessible tabs with arrow/Home/End navigation. Generate is available above either panel. Metadata/trimming, detailed lighting and analysis controls expand on demand; their input values remain mounted and persist across tab switches. Upload, panel padding, toolbar spacing, the responsive stage height and the timeline cue strip were compacted. The cue strip scrolls horizontally instead of growing many rows. Browser checks covered tab click/keyboard navigation, retained choreography settings, opening lighting/analysis controls, the full reference-song neural upload and 390/1024-pixel layouts without horizontal page overflow. The actual full-song run still completed in 9.1 seconds on this device. All 120 Node tests pass.

## v0.6 YouTube import, bombs and visual finish — 2026-10-16

The user-facing YouTube flow now contains a URL field and Import track button, with download progress, cancellation and errors. The local Workers runtime imported the official full “512” video, decoded it, ran browser neural pulse/DSP analysis, and exported all five difficulties without a key, account cookie, native executable or local companion. The importer relays the anonymous VISIONOS audio stream using pinned YouTube.js 18.1.0, with the first media chunk checked before success, same-origin/URL guards, bounded memory, duration/byte caps and no persistent recording storage. Signed media URLs are kept on the server. Actual hosting-IP acceptance must still be checked after deployment; a local success does not establish it.

The zero-bomb failure came from an Easy exclusion plus a global ±0.65-second note-free requirement at four fixed phrase-tail grid times. Bombs now use observed mapped attack times in a phrase tail and clear outer cells. A shared geometric rule reserves cut preparation/follow-through, same-hand recovery, uncertain dot directions and wall footprints. Easy uses less frequent lower-row candidates. No musical notes are removed or retimed to make hazards fit. The saved private analysis produces 4/8/6/8/6 bombs across the five difficulties with zero bomb collision warnings. The actual local-browser YouTube run produced 8 on Hard, and the downloaded ZIP passed structural validation without errors/warnings. Counts may vary with the decoded audio and available movement space; a saturated map can legitimately omit hazards.

The visual pass replaces sharp note boxes with bevels, wireframe bombs with solid spiked shells/emissive seams, wireframe walls with translucent volumes and rails, and the dense construction grid with a solid runway and physical stage ribs. Cut-frame corner brackets preserve the same z=1 plane. Warm key/cool rim light, bloom, fog, clearer tab/input surfaces, transport console styling, hover/pressed/focus states and an original favicon finish the existing compact interface. Camera, note bounds, object trajectories, mouse projection and larger font sizes are preserved. Particle lifetime now uses elapsed time. Practice regressions pass, including the projected moving-cube input cases.

All 129 Node tests pass, including URL/host and cross-site rejection, lazy upstream failure handling, stream metadata/size/duration limits, known-safe/unsafe cut and recovery geometry, and a continuous demo that produces sparse bombs in every difficulty while leaving notes unchanged when the bomb toggle changes. The Vite client + API Worker production build succeeds and retains the Sites manifest integration. Headset comfort and musical listening quality remain separate, unverified acceptance checks.
