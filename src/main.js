import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@phosphor-icons/web/regular";
import "./style.css";
import { analyzeAudio, retimeAnalysis } from "./audio.js";
import { applyBeatModel, checkLocalCompanion, isLocalNeuralStudio } from "./beat-model.js";
import { analyzeBrowserNeural } from "./neural-audio.js";
import { generateMaps, validateGameplay, getRhythmAnchors } from "./generator.js";
import { buildMapFiles, validateMapFiles, createMapZip } from "./export.js";
import {
  trimAudio,
  encodeOgg,
  makeCover,
  createDemo,
  Transport,
} from "./media.js";
import { Stage } from "./preview.js";
import { generateLightshow } from "./lighting.js";
const icon = (name) => `<i class="ph ph-${name}" aria-hidden="true"></i>`;
const $ = (s) => document.querySelector(s);
const difficulties = ["Easy", "Normal", "Hard", "Expert", "ExpertPlus"];
const label = (d) => (d === "ExpertPlus" ? "Expert+" : d);
document.querySelector("#app").innerHTML = `
<header class="topbar"><a class="brand" href="#" aria-label="Open Beatmap Studio home"><span class="brand-mark">${icon("waveform")}</span>open<span class="brand-thin">beatmap</span><span class="brand-studio">STUDIO</span></a><nav aria-label="Workspace navigation"><a class="nav-active" href="#studio">Studio</a><button id="guide-open">How it works ${icon("arrow-up-right")}</button></nav><div class="local-status">${icon("shield-check")} On your device</div><button class="icon-button" id="about-open" title="About this open source project" aria-label="About this open source project">${icon("code")}</button></header>
<main id="studio"><section class="workspace-heading"><div><div class="eyebrow">YOUR MUSIC. YOUR MOVEMENT.</div><h1>Make the music playable<span>.</span></h1></div><button class="primary" id="export" disabled>${icon("download-simple")} Export beatmap <span class="button-tag">.ZIP</span></button></section>
<div class="studio-layout"><aside class="settings" aria-label="Track and generation controls">
<section class="source-section"><div class="section-heading"><h2>Your track</h2><button class="text-button" id="demo">Try demo ${icon("arrow-up-right")}</button></div><div class="source-tabs" role="tablist" aria-label="Audio source"><button role="tab" aria-selected="true" id="file-tab">${icon("file-audio")} Audio file</button><button role="tab" aria-selected="false" id="youtube-tab">${icon("youtube-logo")} YouTube link</button></div>
<div id="file-source"><label class="dropzone" id="dropzone" for="file"><span class="upload-icon">${icon("upload-simple")}</span><strong>Drop a track in here</strong><span>or <u>browse files</u></span><small>MP3, WAV, OGG, FLAC, M4A · up to 100 MB</small></label><input id="file" type="file" accept="audio/*,.ogg,.flac,.wav,.mp3,.m4a" class="sr-only"></div>
<div id="youtube-source" hidden><label for="yt-url">YouTube URL</label><input id="yt-url" type="url" placeholder="https://youtube.com/watch?v=…"><label for="bridge-token">Local bridge key</label><input id="bridge-token" type="password" placeholder="Paste the key from your terminal" autocomplete="off"><button id="yt-import" class="secondary full">${icon("download-simple")} Import audio</button><p class="help">Run <code>npm run bridge</code> locally. YouTube needs the optional yt-dlp bridge. <button class="inline-link" id="bridge-guide">Setup guide</button></p></div>
<div class="track-card" id="track-card"><span class="track-art">${icon("music-notes")}</span><div><strong id="track-name">Preparing demo…</strong><span id="track-detail">Original studio composition</span></div><span class="track-ready" title="Audio stays on your device">${icon("check-circle")}</span></div>
<details class="metadata"><summary>Track details ${icon("caret-down")}</summary><label for="title">Song title</label><input id="title" value="Afterglow Circuit" maxlength="120"><label for="artist">Artist</label><input id="artist" value="Open Beatmap Studio" maxlength="120"><label for="mapper">Mapper</label><input id="mapper" value="Open Beatmap" maxlength="120"><label for="cover">Cover art (optional)</label><input id="cover" type="file" accept="image/png,image/jpeg,image/webp"></details>
<div class="trim-row"><label for="trim-start">Trim start <span>seconds</span><input id="trim-start" type="number" min="0" step="0.1" value="0"></label><span class="trim-divider">→</span><label for="trim-end">Trim end <span>seconds</span><input id="trim-end" type="number" min="5" step="0.1" value="60"></label></div>
</section>
<section class="generation-section"><div class="section-heading"><h2>Make it yours</h2><span class="subtle">All 5 difficulties</span></div><label class="field-label" for="style">Choreography</label><div class="select-wrap"><select id="style"><option value="flow">Flow · smooth</option><option value="dance">Dance · rhythmic</option><option value="technical">Technical · varied</option><option value="cinematic">Cinematic · dramatic</option></select></div><div class="slider-label"><label for="density">Note density</label><output id="density-output">65%</output></div><input id="density" type="range" min="0.15" max="1" step="0.05" value="0.65"><div class="range-ends"><span>Room to breathe</span><span>Keep me moving</span></div>
<div class="toggle-row"><span>${icon("wall")} Walls</span><label class="switch"><input type="checkbox" id="walls" checked><span></span><span class="sr-only">Generate walls</span></label></div><div class="toggle-row"><span>${icon("bomb")} Bombs</span><label class="switch"><input type="checkbox" id="bombs" checked><span></span><span class="sr-only">Generate bombs</span></label></div><div class="toggle-row"><span>${icon("lightbulb")} Rhythm lighting</span><label class="switch"><input type="checkbox" id="lights" checked><span></span><span class="sr-only">Generate lighting events</span></label></div>
<details class="light-controls" open><summary>Lightshow director <span>NATIVE</span></summary><p class="light-caption">Spatial color waves · rotating beam fans · beat accents</p><div class="slider-label"><label for="light-intensity">Brightness</label><output id="light-intensity-output">70%</output></div><input id="light-intensity" type="range" min="0.1" max="1" step="0.05" value="0.7"><div class="slider-label"><label for="light-motion">Beam motion</label><output id="light-motion-output">65%</output></div><input id="light-motion" type="range" min="0" max="1" step="0.05" value="0.65"><p class="help">Bass pulses. Percussion accents. Phrase builds. No rapid strobe mode.</p></details><details class="advanced"><summary>Timing & advanced ${icon("sliders-horizontal")}</summary><div class="two-fields"><label for="bpm">Tempo (BPM)<input id="bpm" type="number" min="40" max="300" step="0.001" value="128"></label><label for="offset">Grid offset (s)<input id="offset" type="number" min="-5" max="5" step="0.01" value="0"></label></div><label for="seed">Pattern seed<input id="seed" type="number" value="42" min="0" max="4294967295"></label><button id="half-bpm" class="text-button">½ tempo</button><button id="double-bpm" class="text-button">2× tempo</button><p class="help" id="confidence">Tempo estimates need a listening check.</p></details>
<label class="field-label" for="beat-engine">Audio analysis</label><select id="beat-engine"><option value="pulse" selected>Neural pulse · fast</option><option value="learned">Neural drums · full</option><option value="browser">Browser pulse · fast</option></select><label class="field-label" for="neural-device">Neural hardware</label><select id="neural-device"><option value="auto">WebGPU · auto</option><option value="wasm">CPU · WebAssembly</option></select><p class="help" id="model-status" role="status">Fast neural pulse runs here. First use downloads ~17 MB; model files are cached. Drum features use browser DSP. Your song stays in this tab.</p><p id="model-fallback" class="help" role="status" hidden></p><details id="model-controls"><summary>About neural analysis</summary><p class="help">Fast neural pulse runs Beat This! small0 with browser DSP attacks. Full neural drums adds the much heavier HTDemucs separator and a ~118 MB model download. Both modes run in this tab. WebGPU accelerates supported devices, with a visible CPU fallback. No installation, account, key or second studio.</p><p class="help">Fast mode targets a quick first map. Full separation takes around 1–2 minutes on the tested GPU; CPU can take longer. Keep this tab open. Faster browser pulse is available for a quick draft.</p></details>
<button class="primary full" id="generate" disabled>${icon("sparkle")} Generate beatmaps</button><p class="local-note">${icon("cpu")} Drum-first rhythm. Local processing. No fees.</p></section></aside>
<section class="editor" aria-label="Beatmap preview and timeline"><div class="preview-toolbar"><div class="difficulty-tabs" role="tablist" aria-label="Preview difficulty">${difficulties.map((d) => `<button role="tab" aria-selected="${d === "Hard"}" data-difficulty="${d}">${label(d)}</button>`).join("")}</div><button class="lightshow-view" id="lightshow-view" aria-pressed="false">${icon("lightbulb")} Lightshow view</button></div><p class="help" id="runtime-status">Demo · fast browser DSP.</p>
<div class="stage-shell" id="stage-shell"><div id="stage"></div><div class="stage-top"><span class="stage-mode" id="stage-mode">${icon("eye")} Preview mode</span><span id="light-pattern" class="light-pattern">RHYTHM ENGINE</span><button class="stage-fullscreen" id="fullscreen" aria-label="Toggle fullscreen">${icon("arrows-out")}</button></div><div class="stage-watermark" hidden>LET THE<br><strong>RHYTHM LEAD.</strong></div><div class="practice-score" id="practice-score" hidden><strong id="score">0</strong><span id="combo">0 combo · 0 missed</span></div><div id="stage-feedback" aria-live="polite"></div><div class="stage-bottom"><span><b class="red-key"></b>Left saber <b class="blue-key"></b>Right saber</span><span id="stage-hint">Follow the notes through the cut frame</span></div><div id="loading" class="loading"><div class="loading-spinner"></div><strong id="loading-title">Finding the rhythm</strong><span id="loading-text">Listening for beats, energy and musical phrases…</span><button id="cancel-analysis" class="secondary" hidden>Cancel analysis</button></div></div>
<div class="transport"><div class="transport-main"><button id="restart" class="icon-button" title="Restart" aria-label="Restart">${icon("skip-back")}</button><button class="play-button" id="play" aria-label="Play preview" disabled>${icon("play")}</button><span class="transport-time"><span id="time">0:00</span><span> / </span><span id="duration">1:00</span></span></div><div class="transport-options"><label class="speed" for="speed"><span class="sr-only">Playback speed</span><select id="speed"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1× speed</option><option value="1.25">1.25×</option></select></label><label class="volume" for="volume">${icon("speaker-high")}<input id="volume" type="range" min="0" max="1" step="0.05" value="0.6"><span class="sr-only">Volume</span></label><button class="practice-button" id="practice" aria-pressed="false">${icon("cursor")} Mouse practice</button></div></div>
<div class="timing-review"><label for="timing-audio">Timing check</label><select id="timing-audio"><option value="notes" selected>Note click</option><option value="off">Click off</option><option value="beats">Beat click</option></select><span id="timing-hint">Hit clicks follow the selected difficulty.</span></div><div class="timeline"><div class="timeline-top"><span>${icon("waveform")} AUDIO & STRUCTURE</span><span id="analysis-summary">Analyzing your track</span></div><div class="waveform-shell"><canvas id="waveform" aria-label="Audio waveform and song sections"></canvas><input id="scrub" class="timeline-scrub" type="range" min="0" max="60" step="0.01" value="0" aria-label="Seek through song"><div id="playhead"></div></div><div class="timeline-ruler" id="ruler"></div><div class="sections" id="sections"></div></div>
<div class="map-stats"><div><span>${icon("music-note")} Notes</span><strong id="note-count">–</strong></div><div><span>${icon("activity")} Notes / sec</span><strong id="nps">–</strong></div><div><span>${icon("wall")} Walls</span><strong id="wall-count">–</strong></div><div><span>${icon("bomb")} Bombs</span><strong id="bomb-count">–</strong></div><div><span>${icon("lightning")} Light cues</span><strong id="light-count">–</strong></div><div class="validation-stat"><span id="validation-label">Checking patterns</span><strong id="validation">${icon("circle-notch")} In progress</strong></div></div>
<div class="editor-footnote"><span>${icon("info")} Native Weave lightshow · PC & Quest custom-song loaders · no Chroma required.</span><button class="text-button" id="compat-open">Compatibility ${icon("arrow-up-right")}</button></div>
</section></div><footer><span>v0.5 · Fast browser neural</span><button id="research-open">Under the hood ${icon("arrow-up-right")}</button><a href="https://github.com/Reza2kn/open-beatmap-studio" target="_blank" rel="noreferrer">Source on GitHub ${icon("arrow-up-right")}</a><span>Audio stays on your device<span class="desktop-only"> · Neural models run in this tab</span></span></footer></main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<dialog id="dialog"><button id="dialog-close" class="icon-button dialog-close" aria-label="Close dialog">${icon("x")}</button><div id="dialog-content"></div></dialog>`;
const context = new AudioContext();
let original,
  buffer,
  analysis,
  maps,
  lightshow,
  selected = "Hard",
  busy = false,
  dirty = false,
  encoded,
  coverBytes,
  isDemo = true,
  score = 0,
  combo = 0,
  misses = 0,
  stage;
const transport = new Transport(context, () => {
  if ($("#play")) {
    $("#play").innerHTML = icon(transport.playing ? "pause" : "play");
    $("#play").setAttribute(
      "aria-label",
      transport.playing ? "Pause preview" : "Play preview",
    );
  }
});
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 6000);
}
function showDialog(html) {
  $("#dialog-content").innerHTML = html;
  $("#dialog").showModal();
}
let analysisController;
$("#cancel-analysis").onclick=()=>analysisController?.abort();
function updateModelStatus() {
  const mode=$("#beat-engine").value;
  $("#model-status").textContent=mode==='learned'
    ? 'Full neural drums: Beat This! + HTDemucs. About 140 MB on first use. Slower, fully learned separation.'
    : mode==='pulse' ? 'Fast neural pulse: Beat This! + browser DSP attacks. About 17 MB on first use, then cached.'
    : 'Fast browser DSP. No model download.';
}
$("#dialog-close").onclick = () => $("#dialog").close();
$("#dialog").onclick = (e) => {
  if (e.target === $("#dialog")) $("#dialog").close();
};
function resetScore() {
  score = combo = misses = 0;
  updateScore();
  stage?.reset();
}
function updateScore() {
  $("#score").textContent = score.toLocaleString();
  $("#combo").textContent = `${combo} combo · ${misses} missed`;
}
function feedback(text) {
  $("#stage-feedback").textContent = text;
  $("#stage-feedback").classList.remove("visible");
  requestAnimationFrame(() => $("#stage-feedback").classList.add("visible"));
}
try {
  stage = new Stage($("#stage"), {
    getTime: () => transport.time,
    isPlaying: () => transport.playing,
    onHit: ({ bomb }) => {
      if (bomb) {
        combo = 0;
        score = Math.max(0, score - 100);
        feedback("Bomb · −100");
      } else {
        combo++;
        score += 100;
        feedback(combo > 1 ? `${combo} COMBO` : "NICE CUT");
      }
      updateScore();
    },
    onMiss: () => {
      combo = 0;
      misses++;
      updateScore();
    },
    onWall: () => {
      combo = 0;
      score = Math.max(0, score - 50);
      feedback("Wall · −50");
      updateScore();
    },
    onCue: (cue) => {
      $("#light-pattern").textContent = `${cue.phase} / ${cue.pattern}`;
    },
  });
} catch (e) {
  $("#stage").innerHTML =
    '<div class="webgl-error">3D preview needs WebGL. Map generation and ZIP export still work.</div>';
  console.error(e);
}
function setBusy(
  value,
  text = "Finding the rhythm",
  detail = "Listening for beats, energy and musical phrases…",
) {
  busy = value;
  for (const control of document.querySelectorAll(
    "aside input,aside select,aside button",
  ))
    control.disabled = value;
  $("#loading").hidden = !value;
  $("#loading-title").textContent = text;
  $("#loading-text").textContent = detail;
  $("#generate").disabled = value || !original;
  $("#export").disabled = value || dirty || !maps;
  $("#play").disabled = value || dirty || !buffer;
  $("#demo").disabled = value;
  $("#yt-import").disabled = value;
  $("#file").disabled = value;
}
function markDirty() {
  if (busy) return;
  dirty = true;
  transport.pause();
  $("#export").disabled = true;
  $("#play").disabled = true;
  $("#generate").innerHTML = `${icon("sparkle")} Apply & regenerate`;
  $("#validation").innerHTML = "Changes pending";
  $("#validation-label").textContent = "Regenerate to preview";
}
function settings() {
  return {
    seed: Number($("#seed").value) || 42,
    density: Number($("#density").value),
    style: $("#style").value,
    walls: $("#walls").checked,
    bombs: $("#bombs").checked,
    lights: $("#lights").checked,
  };
}
async function generate({ reanalyze = false, startedAt = performance.now() } = {}) {
  if (!original || busy) return;
  transport.pause();
  setBusy(true);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const start = Number($("#trim-start").value),
      end = Number($("#trim-end").value);
    const trimmed = trimAudio(original, start, end, context);
    if (trimmed.duration > 600)
      throw new Error("Please trim your track to 10 minutes or less.");
    const trimChanged =
      !buffer ||
      buffer.duration !== trimmed.duration ||
      generate.lastStart !== start;
    const engineChanged = generate.lastEngine !== $("#beat-engine").value+$("#neural-device").value;
    if (reanalyze || trimChanged || engineChanged || !analysis) {
      buffer = trimmed;
      encoded = null;
      analysis = await analyzeAudio(buffer);
      analysis.beatSource = "inferred";
      if(analysis.silent)throw new Error("This audio is silent. Choose a track with audible music.");
      if ($("#beat-engine").value !== "browser" && !isDemo) {
        analysisController=new AbortController();
        $("#model-fallback").hidden=true;
        $("#model-fallback").textContent="";
        $("#cancel-analysis").hidden=false;
        const learned=await analyzeBrowserNeural(buffer,{
          signal:analysisController.signal,
          backend:$("#neural-device").value,
          separateDrums:$("#beat-engine").value==='learned',
          onProgress:({stage,progress,fallbackReason})=>{
            $("#runtime-status").textContent=stage;
            if(fallbackReason){$("#model-fallback").hidden=false;$("#model-fallback").textContent+=`GPU fallback: ${fallbackReason} `;}
            setBusy(true,stage,`Running on this device · ${Math.round((progress||0)*100)}% of this step. First use downloads models; later runs reuse the cache.`);
            $("#model-status").textContent=stage;
          },
        });
        analysis=applyBeatModel(analysis,learned);
        $("#model-status").textContent=`Complete · Beats: ${learned.model.device==='webgpu'?'WebGPU':'CPU'} · Drums: ${learned.drumModel?(learned.drumModel.device==='webgpu'?'WebGPU':'CPU'):'DSP'} · ${Math.round(learned.elapsedSeconds)}s. No audio uploaded.`;
        $("#runtime-status").textContent=$("#model-status").textContent;
      }
      if(isDemo){$("#model-status").textContent="Demo uses fast browser DSP. Uploaded tracks use your selected analyzer.";$("#runtime-status").textContent="Demo · fast browser DSP.";}
      else if($("#beat-engine").value==="browser")$("#runtime-status").textContent="Browser pulse · DSP · no model inference.";
      if (isDemo && start === 0) {
        analysis = retimeAnalysis(analysis, 128, 0);
      }
      $("#bpm").value = Number(analysis.bpm.toFixed(3));
      $("#offset").value = Number(analysis.offset.toFixed(3));
    } else if (Number($("#bpm").value) !== Number(analysis.bpm.toFixed(3)) || Number($("#offset").value) !== Number(analysis.offset.toFixed(3))) {
      analysis = { ...analysis, modelBeatTimes: undefined, downbeatTimes: undefined, beatSource: "inferred" };
      analysis = retimeAnalysis(
        analysis,
        Number($("#bpm").value),
        Number($("#offset").value),
      );
    }
    if (analysis.silent)
      throw new Error(
        "This audio is silent. Choose a track with audible music.",
      );
    if (
      !Number.isFinite(analysis.bpm) ||
      analysis.bpm < 40 ||
      analysis.bpm > 300
    )
      throw new Error("Tempo must be between 40 and 300 BPM.");
    if (!Number.isFinite(analysis.offset) || Math.abs(analysis.offset) > 5)
      throw new Error("Grid offset must be between −5 and 5 seconds.");
    generate.lastStart = start;
    generate.lastEngine = $("#beat-engine").value+$("#neural-device").value;
    maps = generateMaps(analysis, settings());
    const lightRhythmEvents = getRhythmAnchors(analysis).map(event => ({ ...event,
      low: event.kind === "kick" ? .8 : .1, mid: event.kind === "snare" ? .8 : .2,
      high: event.kind === "high" ? .8 : .1 }));
    lightshow = generateLightshow({ ...analysis, lightRhythmEvents }, {
      intensity: Number($("#light-intensity").value),
      motion: Number($("#light-motion").value),
      seed: settings().seed,
      enabled: settings().lights,
    });
    stage?.setLightshow(lightshow);
    transport.load(buffer);
    dirty = false;
    resetScore();
    selectDifficulty(selected);
    renderTimeline();
    $("#confidence").textContent =
      `Timing: ${analysis.beatSource === "learned" ? (analysis.beatModel.drumModel?"learned drums + Beat This! pulse":"Beat This! pulse + DSP attacks") : "estimated browser pulse"}. Notes follow separated percussion and rhythmic melodic attacks. ${analysis.modelWarnings?.join(" ") || "Use Note click to review the chosen rhythm."}`;
    $("#track-detail").textContent =
      `${formatTime(original.duration)} · ${isDemo ? "Studio original" : `${Math.round(original.sampleRate / 1000)} kHz · local audio`}`;
    $("#analysis-summary").textContent =
      `${Number(analysis.bpm.toFixed(3))} BPM · ${analysis.beatSource === "learned" ? (analysis.beatModel.drumModel?"neural drums + beats":"neural pulse + DSP") : "browser separation"} · ${analysis.sections.length} sections`;
    if(analysis.beatSource==='learned'){
      const elapsed=((performance.now()-startedAt)/1000).toFixed(1);
      const beatDevice=analysis.beatModel.device==='webgpu'?'WebGPU':'CPU';
      const drumDevice=analysis.beatModel.drumModel?(analysis.beatModel.drumModel.device==='webgpu'?'WebGPU':'CPU'):'DSP';
      $("#model-status").textContent=`Complete · Beats: ${beatDevice} · Drums: ${drumDevice} · ${elapsed}s total. No audio uploaded.`;
      $("#runtime-status").textContent=$("#model-status").textContent;
    }
    $("#duration").textContent = formatTime(buffer.duration);
    $("#scrub").max = buffer.duration;
    $("#generate").innerHTML = `${icon("sparkle")} Regenerate beatmaps`;
    $("#stage-hint").textContent = stage?.practice
      ? "Hold and swipe through either color near the frame. Follow the arrows."
      : "Follow the notes through the cut frame";
  } catch (e) {
    dirty = true;
    toast(e.name==='AbortError'?'Analysis cancelled. Your track is ready to retry.':e.message, e.name!=='AbortError');
    if(e.name!=='AbortError')console.error(e);
    analysis=null;
    $("#runtime-status").textContent=e.name==='AbortError'?'Analysis cancelled · ready to retry.':'Analysis failed · check the message and retry.';
  } finally {
    analysisController=null;
    $("#cancel-analysis").hidden=true;
    setBusy(false);
  }
}
function selectDifficulty(d) {
  if (!maps || !analysis) return;
  selected = d;
  for (const btn of document.querySelectorAll("[data-difficulty]"))
    btn.setAttribute("aria-selected", btn.dataset.difficulty === d);
  const map = maps[d];
  stage?.setMap(map, analysis.bpm, analysis.offset);
  resetScore();
  $("#note-count").textContent = map.notes.length.toLocaleString();
  $("#nps").textContent = (map.notes.length / buffer.duration).toFixed(2);
  $("#wall-count").textContent = map.obstacles.length;
  $("#bomb-count").textContent = map.bombs.length;
  $("#light-count").textContent = (
    lightshow?.stats?.colorGroups ||
    lightshow?.lightColorEventBoxGroups?.length ||
    0
  ).toLocaleString();
  $("#light-count").title =
    `${lightshow?.lightRotationEventBoxGroups?.length || 0} rotation groups + color waves`;
  updateTimingCheck();
  renderTimeline();
  const v = validateGameplay(map);
  $("#validation").innerHTML = v.valid
    ? `${icon("check-circle")} Checks passed`
    : `${icon("warning")} Review needed`;
  $("#validation").classList.toggle("warn", !v.valid);
  $("#validation-label").textContent = "Pattern safeguards";
  $("#validation").title =
    [...(v.errors || []), ...(v.warnings || [])]
      .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
      .join("\n") ||
    "Grid, collision and movement checks. Human playtesting still recommended.";
}
function updateTimingCheck() {
  if (!analysis || !maps) return;
  const mode = $("#timing-audio").value;
  const times =
    mode === "beats"
      ? analysis.beatTimes
      : maps[selected].notes.map(
          (n) => analysis.offset + (n.beat * 60) / analysis.bpm,
        );
  transport.setClickTimes(times, mode);
  const distinct = new Set(times).size;
  $("#timing-hint").textContent = mode === "notes"
    ? `${distinct.toLocaleString()} hit times · ${label(selected)} · clicks on`
    : mode === "beats" ? "Beat grid clicks · selected map unchanged" : "Hit clicks off";
}
$("#timing-audio").onchange = updateTimingCheck;
function formatTime(t) {
  return `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;
}
function renderTimeline() {
  if (!analysis) return;
  const canvas = $("#waveform"),
    rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(400, rect.width * devicePixelRatio);
  canvas.height = 90 * devicePixelRatio;
  const g = canvas.getContext("2d");
  const bars = analysis.waveform || [];
  const w = canvas.width / bars.length;
  for (let i = 0; i < bars.length; i++) {
    const h = Math.max(2, bars[i] * canvas.height * 0.8);
    g.fillStyle = i % 16 < 8 ? "#d07866" : "#976456";
    g.fillRect(i * w, (canvas.height - h) / 2, Math.max(1, w * 0.68), h);
  }
  if (maps && buffer) {
    g.strokeStyle = "#bec8cf28";
    g.lineWidth = 1;
    for (const t of analysis.beatTimes) {
      const x = (t / buffer.duration) * canvas.width;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, canvas.height);
      g.stroke();
    }
    for (const n of maps[selected].notes) {
      const x =
        ((analysis.offset + (n.beat * 60) / analysis.bpm) / buffer.duration) *
        canvas.width;
      g.fillStyle = n.color === 0 ? "#ff786a" : "#6fc7ef";
      g.fillRect(
        x,
        canvas.height - 9 * devicePixelRatio,
        devicePixelRatio,
        7 * devicePixelRatio,
      );
    }
  }
  $("#ruler").innerHTML = Array.from(
    { length: 7 },
    (_, i) => `<span>${formatTime((buffer.duration * i) / 6)}</span>`,
  ).join("");
  const sections = analysis.sections;
  $("#sections").replaceChildren();
  for (const s of sections) {
    const btn = document.createElement("button");
    btn.style.flex = String(s.end - s.start);
    btn.style.setProperty("--energy", String(0.07 + s.energy * 0.18));
    btn.textContent = s.label || s.type || "Phrase";
    btn.title = `${s.label || "Section"} at ${formatTime(s.start)}`;
    btn.onclick = () => {
      transport.seek(s.start);
      resetScore();
    };
    $("#sections").append(btn);
  }
}
function tick() {
  $("#time").textContent = formatTime(transport.time);
  if (buffer) {
    $("#scrub").value = transport.time;
    $("#playhead").style.left = `${(transport.time / buffer.duration) * 100}%`;
  }
  requestAnimationFrame(tick);
}
tick();
$("#play").onclick = () => {
  if (transport.playing) transport.pause();
  else {
    if (buffer && transport.time >= buffer.duration - 0.01) {
      transport.seek(0);
      resetScore();
    }
    transport.play().catch((e) => toast(e.message, true));
  }
};
$("#restart").onclick = () => {
  transport.seek(0);
  resetScore();
};
$("#scrub").oninput = (e) => {
  transport.seek(Number(e.target.value));
  resetScore();
};
$("#speed").onchange = (e) => transport.setRate(Number(e.target.value));
$("#volume").oninput = (e) =>
  (transport.gain.gain.value = Number(e.target.value));
$("#practice").onclick = () => {
  if (!stage) return;
  const active = !stage.practice;
  stage.setPractice(active);
  resetScore();
  $("#practice").setAttribute("aria-pressed", active);
  $("#practice-score").hidden = !active;
  $("#stage-mode").innerHTML =
    icon(active ? "cursor" : "eye") +
    (active ? " Mouse practice" : " Preview mode");
  $("#stage-hint").textContent = active
    ? "Hold and swipe through either color near the frame. Follow the arrows."
    : "Follow the notes through the cut frame";
  if (active) {
    stage.lightshowOnly = false;
    $("#lightshow-view").setAttribute("aria-pressed", false);
  }
  if (active)
    toast(
      "Hold and swipe through either color near the frame. Follow the arrows. Move away from walls.",
    );
};
$("#lightshow-view").onclick = () => {
  if (!stage) return;
  stage.lightshowOnly = !stage.lightshowOnly;
  stage.renderDirty = true;
  $("#lightshow-view").setAttribute("aria-pressed", stage.lightshowOnly);
  if (stage.lightshowOnly && stage.practice) $("#practice").click();
};
$("#fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    $("#stage-shell")
      .requestFullscreen?.()
      .catch(() => toast("Fullscreen is unavailable in this browser."));
};
window.addEventListener("keydown", (e) => {
  if (
    e.code === "Space" &&
    !/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName) &&
    !$("#dialog").open
  ) {
    e.preventDefault();
    if (!$("#play").disabled) $("#play").click();
  }
});
for (const btn of document.querySelectorAll("[data-difficulty]"))
  btn.onclick = () => {
    if(busy||dirty)return;
    transport.pause();
    selectDifficulty(btn.dataset.difficulty);
  };
for (const id of [
  "style",
  "walls",
  "bombs",
  "lights",
  "trim-start",
  "trim-end",
  "bpm",
  "offset",
  "seed",
])
  $("#" + id).addEventListener("input", markDirty);
for (const id of ["light-intensity", "light-motion"])
  $("#" + id).oninput = () => {
    $("#" + id + "-output").textContent =
      `${Math.round(Number($("#" + id).value) * 100)}%`;
    markDirty();
  };
$("#density").oninput = () => {
  $("#density-output").textContent =
    `${Math.round(Number($("#density").value) * 100)}%`;
  markDirty();
};
$("#half-bpm").onclick = () => {
  $("#bpm").value = Math.max(40, Number($("#bpm").value) / 2);
  markDirty();
};
$("#double-bpm").onclick = () => {
  $("#bpm").value = Math.min(300, Number($("#bpm").value) * 2);
  markDirty();
};
$("#generate").onclick = () => generate();
$("#beat-engine").onchange=()=>{markDirty();updateModelStatus();};
$("#neural-device").onchange=()=>{markDirty();updateModelStatus();};

async function loadFile(file) {
  if (!file || busy) return;
  const startedAt=performance.now();
  if (file.size > 100 * 1024 * 1024) {
    toast("Please choose a file smaller than 100 MB.", true);
    return;
  }
  transport.pause();
  setBusy(true, "Opening your track", "Decoding audio locally on your device…");
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 5)
      throw new Error("Please choose at least 5 seconds of audio.");
    original = decoded;
    isDemo = false;
    analysis = null;
    buffer = null;
    encoded = null;
    $("#title").value = file.name.replace(/\.[^.]+$/, "");
    $("#artist").value = "Unknown artist";
    $("#track-name").textContent = $("#title").value;
    $("#trim-start").value = 0;
    $("#trim-end").value = Math.min(600, Number(decoded.duration.toFixed(2)));
    if (decoded.duration > 600)
      toast(
        "Track loaded. The first 10 minutes are selected; adjust the trim range.",
      );
  } catch (e) {
    toast(`Could not open audio: ${e.message}`, true);
  } finally {
    setBusy(false);
  }
  if (original && !analysis) await generate({ reanalyze: true, startedAt });
}
$("#file").onchange = (e) => loadFile(e.target.files[0]);
for (const event of ["dragenter", "dragover"])
  $("#dropzone").addEventListener(event, (e) => {
    e.preventDefault();
    $("#dropzone").classList.add("dragover");
  });
for (const event of ["dragleave", "drop"])
  $("#dropzone").addEventListener(event, (e) => {
    e.preventDefault();
    $("#dropzone").classList.remove("dragover");
    if (event === "drop") loadFile(e.dataTransfer.files[0]);
  });
function sourceTab(yt) {
  $("#file-source").hidden = yt;
  $("#youtube-source").hidden = !yt;
  $("#file-tab").setAttribute("aria-selected", !yt);
  $("#youtube-tab").setAttribute("aria-selected", yt);
}
$("#file-tab").onclick = () => sourceTab(false);
$("#youtube-tab").onclick = () => sourceTab(true);
$("#yt-import").onclick = async () => {
  if (busy) return;
  const url = $("#yt-url").value,
    key = $("#bridge-token").value;
  if (!key && !isLocalNeuralStudio()) {
    bridgeGuide();
    return;
  }
  setBusy(
    true,
    "Importing from YouTube",
    "Your local bridge is downloading and converting the audio…",
  );
  try {
    const connection=await checkLocalCompanion(key);
    const response = await fetch(connection.url+'/import', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...connection.headers,
      },
      credentials:connection.credentials,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(210000),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || "The local bridge could not import that video.",
      );
    }
    const name = decodeURIComponent(
      response.headers.get("X-Track-Title") || "YouTube track",
    );
    const blob = await response.blob();
    setBusy(false);
    await loadFile(new File([blob], `${name}.flac`, { type: "audio/flac" }));
  } catch (e) {
    setBusy(false);
    toast(
      e instanceof TypeError
        ? "Could not reach the local bridge. Run npm run bridge and allow local network access in your browser."
        : e.message,
      true,
    );
  }
};
$("#cover").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Cover must be smaller than 10 MB.");
    const image = await createImageBitmap(file);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d");
    const s = Math.min(image.width, image.height);
    g.drawImage(
      image,
      (image.width - s) / 2,
      (image.height - s) / 2,
      s,
      s,
      0,
      0,
      512,
      512,
    );
    image.close();
    coverBytes = await new Promise((r) =>
      c.toBlob(
        async (b) => r(new Uint8Array(await b.arrayBuffer())),
        "image/png",
      ),
    );
    toast("Cover art ready.");
  } catch (e) {
    toast(e.message, true);
  }
};
$("#export").onclick = async () => {
  if (!maps || busy || dirty) return;
  transport.pause();
  setBusy(true, "Packing your beatmaps", "Encoding Ogg Vorbis audio locally…");
  try {
    if (!encoded)
      encoded = await encodeOgg(
        buffer,
        (p) =>
          ($("#loading-text").textContent =
            `Encoding Ogg Vorbis audio · ${Math.round(p * 100)}%`),
      );
    const params = {
      title: $("#title").value || "Untitled",
      artist: $("#artist").value || "Unknown artist",
      author: $("#mapper").value || "Open Beatmap",
      bpm: analysis.bpm,
      offset: analysis.offset,
      audioBytes: encoded,
      coverBytes: coverBytes || (await makeCover($("#title").value)),
      maps,
      lightshow,
      duration: buffer.duration,
    };
    const files = buildMapFiles(params);
    const validation = validateMapFiles(files);
    if (!validation.valid)
      throw new Error(
        `Export validation failed: ${validation.errors.join("; ")}`,
      );
    const zip = await createMapZip(params);
    const href = URL.createObjectURL(
      new Blob([zip], { type: "application/zip" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `${params.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "beatmap"} - Open Beatmap.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    toast(
      "Exported all 5 difficulties, native lightshow, cover art and Ogg audio.",
    );
  } catch (e) {
    toast(e.message, true);
    console.error(e);
  } finally {
    setBusy(false);
  }
};
const guide = () =>
  showDialog(
    `<div class="dialog-eyebrow">FROM TRACK TO PLAYABLE</div><h2>A little music.<br>A lot of movement.</h2><ol class="guide-list"><li><strong>Bring a track</strong><p>Upload an audio file, or use the optional local YouTube bridge. Trim to the part you want.</p></li><li><strong>Shape the movement</strong><p>Choose choreography, density, walls, bombs and lighting. Every generation creates Easy through Expert+.</p></li><li><strong>Listen, preview, refine</strong><p>Check tempo and grid offset by ear. Use ½ / 2× tempo for ambiguous tracks. Try the map with your mouse before exporting.</p></li><li><strong>Take it to your headset</strong><p>Export a ZIP. Import it using a compatible PC or Quest custom-song loader. The stock games do not directly import ZIP maps.</p></li></ol><p class="help">Mouse practice approximates timing and directional cuts. It cannot validate VR reach, comfort or headset behavior. Give every map a real playtest.</p>`,
  );
$("#guide-open").onclick = guide;
function bridgeGuide() {
  showDialog(
    `<div class="dialog-eyebrow">OPTIONAL LOCAL COMPANION</div><h2>Bring a YouTube track.</h2><p>Browsers cannot reliably download YouTube media directly. This open source bridge runs on your computer with yt-dlp and FFmpeg.</p><pre>brew install ffmpeg\nnpm install\nnpm run bridge:setup\nnpm run bridge</pre><p>Open this project's local studio with <code>npm run dev</code>, then paste the temporary bridge key printed in your terminal into the YouTube tab. The bridge listens on <code>127.0.0.1:4174</code>. From a hosted studio your browser may ask for local network access.</p><p>One video, up to 10 minutes. Private videos, playlists and DRM are not supported. Only import audio you have permission to use. The audio is converted locally and sent straight to your browser.</p>`,
  );
}
$("#bridge-guide").onclick = bridgeGuide;
$("#compat-open").onclick = () =>
  showDialog(
    `<div class="dialog-eyebrow">STANDARD MAP EXPORT</div><h2>One ZIP. Five difficulties.</h2><p>The archive contains <code>Info.dat</code> (2.0.0), five Standard difficulty files (3.0.0), <code>song.ogg</code> with real Vorbis audio, and PNG cover art. Notes, bombs, walls and native color event boxes, rotating light groups and color boosts target the built-in Weave environment. No Chroma extension is required.</p><p><strong>PC:</strong> install custom songs using your version's compatible loader, or extract into its custom-level folder.</p><p><strong>Quest:</strong> use a compatible modded custom-song loader. Quest support depends on your game and loader version. A ZIP cannot be imported directly into the unmodified stock game.</p><p>We validate the map structure and gameplay safeguards. PC/Quest headset import and playtesting are still unverified. This browser stage approximates the exported environment.</p><p class="help">Beat Saber is a trademark of its owners. This is an independent community project.</p>`,
  );
$("#about-open").onclick = () =>
  showDialog(
    `<div class="dialog-eyebrow">OPEN BEATMAP STUDIO</div><h2>Built for the music.<br>Open for everyone.</h2><p>A browser-first Beat Saber map generator. No accounts, credits or hosted inference. Audio analysis, choreography, 3D preview, Vorbis encoding and ZIP creation run on your device.</p><p>The source is MIT licensed. The bundled demo, Afterglow Circuit, is an original deterministic synth composition generated locally.</p><p><a class="source-link" href="https://github.com/Reza2kn/open-beatmap-studio" target="_blank" rel="noreferrer">Browse the source on GitHub ↗</a></p><p class="help">This is an initial release. Human playtesting, varied-tempo handling and headset compatibility verification are the next steps.</p>`,
  );
$("#research-open").onclick = () =>
  showDialog(
    `<div class="dialog-eyebrow">UNDER THE HOOD</div><h2>Musical structure.<br>Intentional movement.</h2><p><strong>Listen:</strong> The browser estimates a pulse from spectral rhythm. The browser separates transient and sustained sounds using median filters. Neural mode runs HTDemucs drum separation and Beat This! small0 beat tracking entirely in browser workers. The arranger prioritizes recurring kick/snare patterns and uses melodic attacks in passages without drums.</p><p><strong>Choreograph:</strong> The musical pulse provides the note rhythm. Recurring rhythmic families reuse movement vocabulary, alternate hands and cut directions, and simplify across five difficulties. Conservative walls and sparse bombs are checked against notes.</p><p><strong>Light:</strong> native event-box groups create spatial color waves, mirrored rotating beam fans, bass pulses and percussion accents, with phrase builds and deliberate rests. The browser provides an artistic approximation; actual game environments interpret these events differently.</p><p><strong>Export:</strong> a lightweight WebAssembly Vorbis encoder produces real Ogg audio in a worker. Musical pulse timing is preserved; grid offsets are baked once into exported event timestamps.</p><p class="help">The models download as static files; audio never leaves the browser. Neural inference prefers WebGPU for the learned layers and falls back to a fresh WebAssembly worker if GPU execution fails. Spectrograms and waveform reconstruction use CPU DSP. Ordinary HTTPS hosting needs no special browser headers. Browser pulse uses DSP and needs no model download.</p><div class="research-links"><a href="https://bsmg.wiki/mapping/map-format.html" target="_blank" rel="noreferrer">BSMG map format ↗</a><a href="https://bsmg.wiki/mapping/basic-mapping.html" target="_blank" rel="noreferrer">Mapping fundamentals ↗</a><a href="https://github.com/arseneyr/wasm-media-encoders" target="_blank" rel="noreferrer">Local Vorbis encoder ↗</a></div>`,
  );
async function loadDemo() {
  if (busy) return;
  setBusy(
    true,
    "Composing a little demo",
    "Creating an original synth track on your device…",
  );
  await new Promise((r) => setTimeout(r, 20));
  try {
    original = createDemo(context);
    isDemo = true;
    analysis = buffer = encoded = null;
    $("#title").value = "Afterglow Circuit";
    $("#artist").value = "Open Beatmap Studio";
    $("#track-name").textContent = "Afterglow Circuit";
    $("#trim-start").value = 0;
    $("#trim-end").value = original.duration;
    sourceTab(false);
  } catch (e) {
    toast(e.message, true);
  }
  setBusy(false);
  await generate({ reanalyze: true });
}
$("#demo").onclick = loadDemo;
new ResizeObserver(() => renderTimeline()).observe(
  $("#waveform").parentElement,
);
loadDemo();
// Narrow read-only diagnostics for reproducible local smoke checks. No audio is exposed.
window.beatmapStudio = {
  get diagnostics() {
    return {
      busy,
      dirty,
      selected,
      beatSource: analysis?.beatSource,
      model: analysis?.beatModel,
      rhythm: maps?.[selected]?.rhythmDiagnostics,
      bpm: analysis?.bpm,
      offset: analysis?.offset,
      duration: buffer?.duration,
      maps: maps
        ? Object.fromEntries(
            Object.entries(maps).map(([d, m]) => [
              d,
              {
                notes: m.notes.length,
                walls: m.obstacles.length,
                bombs: m.bombs.length,
                lights: lightshow?.lightColorEventBoxGroups?.length || 0,
                validation: validateGameplay(m),
              },
            ]),
          )
        : null,
    };
  },
};
