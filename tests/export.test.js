import test from "node:test";
import assert from "node:assert/strict";
import { createOggEncoder } from "wasm-media-encoders";
import { unzipSync, strFromU8, strToU8 } from "fflate";
import {
  DIFFICULTIES,
  buildMapFiles,
  createMapZip,
  defaultCoverBytes,
  inspectOggVorbis,
  validateMapFiles,
} from "../src/export.js";
import { generateLightshow } from "../src/lighting.js";

// Real libvorbis output exercises Ogg pages, CRCs, and packet continuations.
const oggEncoder = await createOggEncoder();
oggEncoder.configure({ sampleRate: 44100, channels: 1, vbrQuality: 3 });
const pcm = Float32Array.from(
  { length: 88200 },
  (_, index) => Math.sin((index * 440 * Math.PI * 2) / 44100) * 0.15,
);
const chunks = [
  oggEncoder.encode([pcm]).slice(),
  oggEncoder.finalize().slice(),
];
const audioBytes = new Uint8Array(
  chunks.reduce((sum, chunk) => sum + chunk.length, 0),
);
let cursor = 0;
for (const chunk of chunks) {
  audioBytes.set(chunk, cursor);
  cursor += chunk.length;
}

function params(overrides = {}) {
  return {
    title: "A test song",
    artist: "Test artist",
    author: "Test mapper",
    bpm: 120,
    offset: 0,
    duration: 2,
    audioBytes,
    maps: Object.fromEntries(
      DIFFICULTIES.map((difficulty) => [
        difficulty,
        {
          notes: [
            { beat: 1, x: 1, y: 0, color: 0, direction: 1 },
            { beat: 2, x: 2, y: 1, color: 1, direction: 0 },
          ],
          bombs: [{ beat: 3, x: 3, y: 2 }],
          obstacles: [
            { beat: 1, x: 0, y: 0, width: 1, height: 5, duration: 1 },
          ],
          events: [
            { beat: 0, type: 0, value: 1, floatValue: 0.6 },
            { beat: 2, type: 4, value: 6, floatValue: 1 },
          ],
        },
      ]),
    ),
    ...overrides,
  };
}
const read = (files, name) => JSON.parse(strFromU8(files[name]));
const alter = (files, name, change) => {
  const value = read(files, name);
  change(value);
  files[name] = strToU8(JSON.stringify(value));
};

test("exports all five Standard difficulties and real Ogg audio at ZIP root", async () => {
  const zip = await createMapZip(params());
  const files = unzipSync(zip);
  assert.deepEqual(
    Object.keys(files).sort(),
    [
      "Info.dat",
      "song.ogg",
      "cover.png",
      ...DIFFICULTIES.map((difficulty) => `${difficulty}.dat`),
    ].sort(),
  );
  assert.deepEqual(files["song.ogg"], audioBytes);
  const validation = validateMapFiles(files, { duration: 2 });
  assert.equal(validation.valid, true, validation.errors.join(" "));
  assert.deepEqual(validation.stats.Easy, {
    notes: 2,
    bombs: 1,
    obstacles: 1,
    events: 2,
  });
  const info = read(files, "Info.dat");
  assert.equal(info._version, "2.0.0");
  assert.equal(info._environmentName, "DefaultEnvironment");
  assert.deepEqual(
    info._difficultyBeatmapSets[0]._difficultyBeatmaps.map(
      (difficulty) => difficulty._difficultyRank,
    ),
    [1, 3, 5, 7, 9],
  );
});

test("offset seconds are baked exactly once into notes, bombs, walls and lights", () => {
  const files = buildMapFiles(params({ offset: 0.25 }));
  const map = read(files, "ExpertPlus.dat");
  assert.equal(read(files, "Info.dat")._songTimeOffset, 0);
  assert.equal(map.colorNotes[0].b, 1.5);
  assert.equal(map.bombNotes[0].b, 3.5);
  assert.equal(map.obstacles[0].b, 1.5);
  assert.equal(map.obstacles[0].d, 1);
  assert.equal(map.basicBeatmapEvents[0].b, 0.5);
  assert.deepEqual(map.colorNotes[0], { b: 1.5, x: 1, y: 0, c: 0, d: 1, a: 0 });
});

test("sorts copied object arrays without mutating the generated map", () => {
  const input = params();
  input.maps.Easy.notes.reverse();
  const map = read(buildMapFiles(input), "Easy.dat");
  assert.equal(map.colorNotes[0].b, 1);
  assert.equal(input.maps.Easy.notes[0].beat, 2);
});

test("Ogg inspector verifies an actual Vorbis stream and its end marker", () => {
  assert.equal(inspectOggVorbis(audioBytes).valid, true);
  assert.equal(
    inspectOggVorbis(audioBytes.subarray(0, audioBytes.length - 10)).valid,
    false,
  );
});

test("rejects damaged Ogg pages and renamed non-Ogg files", () => {
  const damaged = audioBytes.slice();
  damaged[damaged.length - 1] ^= 1;
  assert.match(inspectOggVorbis(damaged).errors.join(" "), /checksum/);
  assert.throws(
    () =>
      buildMapFiles(
        params({ audioBytes: strToU8("RIFF WAV file renamed song.ogg") }),
      ),
    /Ogg Vorbis/,
  );
  assert.throws(
    () => buildMapFiles(params({ audioBytes: damaged })),
    /checksum/,
  );
});

test("rejects omitted difficulties, invalid BPM and nonfinite offsets", () => {
  const input = params();
  delete input.maps.Hard;
  assert.throws(() => buildMapFiles(input), /Missing Hard/);
  assert.throws(() => buildMapFiles(params({ bpm: 0 })), /BPM/);
  assert.throws(() => buildMapFiles(params({ offset: NaN })), /Offset/);
});

test("rejects off-grid notes and unsupported directions", () => {
  const input = params();
  input.maps.Easy.notes[0].x = 4;
  assert.throws(() => buildMapFiles(input), /4×3 grid/);
  input.maps.Easy.notes[0].x = 1;
  input.maps.Easy.notes[0].direction = 9;
  assert.throws(() => buildMapFiles(input), /color\/direction/);
});

test("rejects same-cell note/bomb intersections", () => {
  const input = params();
  input.maps.Normal.bombs.push({ beat: 1, x: 1, y: 0 });
  assert.throws(() => buildMapFiles(input), /overlapping notes\/bombs/);
});

test("rejects objects before zero or after the trimmed audio, including wall tails", () => {
  assert.throws(
    () => buildMapFiles(params({ offset: -0.1 })),
    /lighting event/,
  );
  const input = params();
  input.maps.Expert.obstacles[0].duration = 4;
  assert.throws(() => buildMapFiles(input), /wall timing/);
  input.maps.Expert.obstacles[0].duration = 1;
  input.maps.Expert.notes[0].beat = 5;
  assert.throws(() => buildMapFiles(input), /timing/);
});

test("rejects nonstandard wall geometry and deprecated rotation events", () => {
  const input = params();
  input.maps.Hard.obstacles[0].width = 5;
  assert.throws(() => buildMapFiles(input), /wall bounds/);
  input.maps.Hard.obstacles[0].width = 1;
  input.maps.Hard.events[0].type = 14;
  assert.throws(() => buildMapFiles(input), /lighting event/);
});

test("validation catches missing files, corrupt JSON, unsupported versions and unsafe paths", () => {
  const files = buildMapFiles(params());
  delete files["Normal.dat"];
  files["Hard.dat"] = strToU8("{broken json");
  alter(files, "Expert.dat", (map) => {
    map.version = "4.0.0";
  });
  alter(files, "Info.dat", (info) => {
    info._difficultyBeatmapSets[0]._difficultyBeatmaps[0]._beatmapFilename =
      "../escape.dat";
  });
  const validation = validateMapFiles(files);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(" "), /Normal.dat/);
  assert.match(validation.errors.join(" "), /Hard.dat/);
  assert.match(validation.errors.join(" "), /version/);
  assert.match(validation.errors.join(" "), /unsafe/);
});

test("uses a valid square PNG default cover and rejects missing image bytes", () => {
  const cover = defaultCoverBytes();
  const view = new DataView(cover.buffer);
  assert.equal(view.getUint32(16), 256);
  assert.equal(view.getUint32(20), 256);
  assert.throws(
    () => buildMapFiles(params({ coverBytes: new Uint8Array(100) })),
    /PNG or JPEG/,
  );
  const files = buildMapFiles(params());
  delete files["cover.png"];
  assert.equal(validateMapFiles(files).valid, false);
});

test("metadata preserves user strings safely as JSON and preview stays inside short songs", () => {
  const files = buildMapFiles(
    params({ title: '"\\ Persian آهنگ', duration: 2 }),
  );
  const info = read(files, "Info.dat");
  assert.equal(info._songName, '"\\ Persian آهنگ');
  assert.equal(info._previewStartTime, 0);
  assert.equal(info._previewDuration, 2);
});

test("validation reports malformed object structures without throwing", () => {
  const files = buildMapFiles(params());
  alter(files, "Easy.dat", (map) => {
    map.colorNotes.push(null);
    map.obstacles.push(null);
    map.basicBeatmapEvents.push(null);
  });
  assert.equal(validateMapFiles(files).valid, false);
  files["Info.dat"] = strToU8("null");
  assert.equal(validateMapFiles(files).valid, false);
});

function nativeShow() {
  return {
    environment: "WeaveEnvironment",
    lightColorEventBoxGroups: [
      {
        b: 1,
        g: 12,
        e: [
          {
            f: { f: 2, p: 0, t: 2, r: 1 },
            w: 0.25,
            d: 1,
            r: -0.2,
            t: 1,
            b: 0,
            e: [
              { b: 0, c: 1, s: 1.1, i: 0, f: 0 },
              { b: 0.5, c: 0, s: 0.2, i: 1, f: 0 },
            ],
          },
        ],
      },
    ],
    lightRotationEventBoxGroups: [
      {
        b: 1,
        g: 3,
        e: [
          {
            f: { f: 1, p: 1, t: 0, r: 0 },
            w: 0.5,
            d: 1,
            s: 90,
            t: 1,
            a: 1,
            r: 0,
            b: 0,
            l: [
              { b: 0, r: 45, e: 0, p: 0, o: 0, l: 0 },
              { b: 1, r: 270, e: 4, p: 0, o: 1, l: 0 },
            ],
          },
        ],
      },
    ],
    colorBoostBeatmapEvents: [
      { b: 1, o: true },
      { b: 3, o: false },
    ],
  };
}

test("exports native Weave color waves, rotation sweeps and boost on every difficulty", () => {
  const lightshow = nativeShow();
  const input = params({ offset: 0.25, lightshow });
  const files = buildMapFiles(input);
  assert.equal(read(files, "Info.dat")._environmentName, "WeaveEnvironment");
  for (const difficulty of DIFFICULTIES) {
    const map = read(files, `${difficulty}.dat`);
    assert.equal(map.version, "3.0.0");
    assert.equal(map.useNormalEventsAsCompatibleEvents, false);
    assert.equal(map.lightColorEventBoxGroups[0].b, 1.5);
    assert.equal(map.lightRotationEventBoxGroups[0].b, 1.5);
    assert.deepEqual(
      map.lightColorEventBoxGroups[0].e,
      lightshow.lightColorEventBoxGroups[0].e,
    );
    assert.equal(map.lightRotationEventBoxGroups[0].e[0].l[1].b, 1);
    assert.equal(map.colorBoostBeatmapEvents[0].b, 1.5);
    assert.equal(
      validateMapFiles(files, { duration: 2 }).stats[difficulty].nativeGroups,
      2,
    );
  }
  assert.equal(lightshow.lightColorEventBoxGroups[0].b, 1);
});

test("initial native cues with negative grid beat align to audio zero after grid offset", () => {
  const lightshow = nativeShow();
  lightshow.lightColorEventBoxGroups[0].b = -0.5;
  const files = buildMapFiles(params({ offset: 0.25, lightshow }));
  assert.equal(read(files, "Expert.dat").lightColorEventBoxGroups[0].b, 0);
});

test("rejects unsupported native environment groups, axes, filters and translations", () => {
  const show = nativeShow();
  show.lightColorEventBoxGroups[0].g = 16;
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /Weave group ID/,
  );
  show.lightColorEventBoxGroups[0].g = 12;
  show.lightColorEventBoxGroups[0].e[0].f.p = 12;
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /light counts/,
  );
  show.lightColorEventBoxGroups[0].e[0].f.p = 0;
  show.lightRotationEventBoxGroups[0].e[0].a = 2;
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /unsupported axis/,
  );
  show.lightRotationEventBoxGroups[0].e[0].a = 1;
  show.lightTranslationEventBoxGroups = [{ b: 0, g: 0, e: [] }];
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /translation/,
  );
});

test("validates relative event tails including delayed individual-light waves", () => {
  const show = nativeShow();
  show.lightColorEventBoxGroups[0].e[0].w = 4;
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /extends past audio/,
  );
  show.lightColorEventBoxGroups[0].e[0].w = 0.6;
  show.lightColorEventBoxGroups[0].e[0].d = 2;
  assert.throws(
    () => buildMapFiles(params({ lightshow: show })),
    /extends past audio/,
  );
});

test("real rhythm-directed lighting integrates with non-round BPM and grid phase", () => {
  for (const offset of [0.17305, -0.13007]) {
    const analysis = {
      duration: 2,
      bpm: 137,
      offset,
      energy: Array(40).fill(0.7),
      frameDuration: 0.05,
      onsets: [{ time: 0.3, strength: 0.9, low: 0.8, mid: 0.1, high: 0.1 }],
      sections: [{ start: 0, end: 2, energy: 0.7, label: "peak" }],
    };
    const lightshow = generateLightshow(analysis);
    const files = buildMapFiles(
      params({ bpm: analysis.bpm, offset, lightshow }),
    );
    const validation = validateMapFiles(files, { duration: 2 });
    assert.equal(validation.valid, true, validation.errors.join(" "));
    assert.ok(validation.stats.Expert.nativeGroups > 16);
    assert.ok(
      read(files, "Expert.dat").lightRotationEventBoxGroups[0].b < 1e-4,
    );
  }
});
