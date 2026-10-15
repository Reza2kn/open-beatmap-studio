import { zipSync } from "fflate";

/** Pure browser Beat Saber writer. All input object times/durations are beats.
 * offset is seconds added to every object time, baked once into exported beats.
 * audioBytes must already contain the trimmed song encoded as Ogg Vorbis.
 */
export const DIFFICULTIES = ["Easy", "Normal", "Hard", "Expert", "ExpertPlus"];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SPEEDS = [10, 12, 14, 16, 18];
const EVENT_TYPES = new Set([0, 1, 2, 3, 4, 8, 9, 12, 13]);
const NATIVE_GROUP_KEYS = [
  "lightColorEventBoxGroups",
  "lightRotationEventBoxGroups",
];
const COVER =
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAUlEQVR42u3TMQ0AAAgEsZfBiAP8u2NGA02q4JJL9cBbkQADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAABhABQwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgAA6iAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGACuBQxTBgp23ZmuAAAAAElFTkSuQmCC";

export function defaultCoverBytes() {
  return Uint8Array.from(atob(COVER), (character) => character.charCodeAt(0));
}

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value));
}
const finite = (number) =>
  typeof number === "number" && Number.isFinite(number);
const integer = (number, min, max) =>
  Number.isInteger(number) && number >= min && number <= max;
const rounded = (number) => Math.round(number * 1e6) / 1e6;
const bytes = (value) => value instanceof Uint8Array;
const safeFilename = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  !/[\\/\x00]/.test(name) &&
  name !== "." &&
  name !== "..";

function coverFormat(data) {
  if (!bytes(data)) return null;
  if (
    data.length > 32 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => data[i] === v)
  ) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      extension: "png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  if (
    data[0] === 255 &&
    data[1] === 216 &&
    data.at(-2) === 255 &&
    data.at(-1) === 217
  ) {
    for (let position = 2; position + 8 < data.length;) {
      if (data[position] !== 255) break;
      const marker = data[position + 1];
      const length = (data[position + 2] << 8) + data[position + 3];
      if (length < 2) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        return {
          extension: "jpg",
          width: (data[position + 7] << 8) + data[position + 8],
          height: (data[position + 5] << 8) + data[position + 6],
        };
      }
      position += 2 + length;
    }
  }
  return null;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value << 24;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
  return crc >>> 0;
});

/** Container-level check, including CRCs and Vorbis headers; not an audio decoder. */
export function inspectOggVorbis(data) {
  const errors = [];
  if (!bytes(data) || data.length < 58)
    return {
      valid: false,
      errors: ["Audio must be encoded Ogg Vorbis bytes."],
    };
  let position = 0,
    sequence = 0,
    serial,
    ended = false,
    packetLength = 0,
    packetCount = 0;
  const headers = [];
  while (position < data.length) {
    if (
      ended ||
      position + 27 > data.length ||
      ![79, 103, 103, 83, 0].every((v, i) => data[position + i] === v)
    ) {
      errors.push("Malformed, truncated, or chained Ogg stream.");
      break;
    }
    const view = new DataView(
      data.buffer,
      data.byteOffset + position,
      data.length - position,
    );
    const flags = data[position + 5],
      segmentCount = data[position + 26];
    if (position + 27 + segmentCount > data.length) {
      errors.push("Truncated Ogg segment table.");
      break;
    }
    const table = data.subarray(position + 27, position + 27 + segmentCount);
    const pageLength =
      27 + segmentCount + table.reduce((sum, value) => sum + value, 0);
    if (position + pageLength > data.length) {
      errors.push("Truncated Ogg audio page.");
      break;
    }
    if (serial === undefined) serial = view.getUint32(14, true);
    if (
      view.getUint32(14, true) !== serial ||
      view.getUint32(18, true) !== sequence++
    )
      errors.push("Ogg page sequence is discontinuous.");
    if (position === 0 && !(flags & 2))
      errors.push("Ogg stream is missing its beginning marker.");
    if (Boolean(flags & 1) !== Boolean(packetLength))
      errors.push("Ogg packet continuation is invalid.");
    let crc = 0;
    for (let i = 0; i < pageLength; i++)
      crc =
        ((crc << 8) ^
          CRC_TABLE[
            ((crc >>> 24) ^ (i >= 22 && i < 26 ? 0 : data[position + i])) & 255
          ]) >>>
        0;
    if (crc !== view.getUint32(22, true))
      errors.push("Ogg page checksum is invalid.");
    let payload = position + 27 + segmentCount;
    for (const size of table) {
      if (packetCount < 3) {
        const header = headers[packetCount] ?? (headers[packetCount] = []);
        const copyCount = Math.min(size, 30 - header.length);
        for (let i = 0; i < copyCount; i++) header.push(data[payload + i]);
      }
      packetLength += size;
      payload += size;
      if (size < 255) {
        packetCount++;
        packetLength = 0;
      }
    }
    ended = Boolean(flags & 4);
    position += pageLength;
  }
  if (!ended || packetLength)
    errors.push(
      "Ogg audio is incomplete (missing stream end or final packet).",
    );
  for (let i = 0; i < 3; i++) {
    if (
      !headers[i] ||
      headers[i][0] !== [1, 3, 5][i] ||
      ![118, 111, 114, 98, 105, 115].every((v, n) => headers[i][n + 1] === v)
    ) {
      errors.push(
        "Audio must use the Vorbis codec; renaming MP3, WAV, or Ogg Opus does not convert it.",
      );
      break;
    }
  }
  if (packetCount < 4) errors.push("Ogg stream contains no audio packets.");
  if (headers[0]?.length >= 30 && (headers[0][11] < 1 || !(headers[0][29] & 1)))
    errors.push("Invalid Vorbis identification header.");
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    pages: sequence,
    packets: packetCount,
  };
}

export function buildMapFiles({
  title = "Untitled",
  artist = "Unknown artist",
  author = "Open Beatmap Generator",
  bpm,
  offset = 0,
  audioBytes,
  coverBytes = defaultCoverBytes(),
  maps,
  duration,
  lightshow,
}) {
  if (!finite(bpm) || bpm <= 0 || bpm > 1000)
    throw new Error("BPM must be greater than 0 and at most 1000.");
  if (!finite(offset))
    throw new Error("Offset must be a finite number of seconds.");
  if (!finite(duration) || duration <= 0)
    throw new Error("Song duration must be a positive number of seconds.");
  const cover = coverFormat(coverBytes);
  if (!cover) throw new Error("Cover must contain a PNG or JPEG image.");
  const coverName = `cover.${cover.extension}`;
  const files = { "song.ogg": audioBytes, [coverName]: coverBytes };
  const shift = (offset * bpm) / 60;
  const timing = (beat) => {
    if (!finite(beat)) throw new Error("Every object must have a finite beat.");
    const shifted = beat + shift;
    // Generators round their public grid beats; preserve audio-zero cues when
    // that rounding leaves a few millionths of a beat below zero.
    return shifted < 0 && shifted > -1e-4 ? 0 : rounded(shifted);
  };
  const list = (map, key, convert) => {
    if (!Array.isArray(map[key]))
      throw new Error(`Every difficulty must provide a ${key} array.`);
    return map[key].map(convert).sort((a, b) => a.b - b.b);
  };
  const shows = DIFFICULTIES.map(
    (difficulty) => maps?.[difficulty]?.lightshow ?? lightshow,
  );
  const environment =
    shows.some((show) => show) ||
    DIFFICULTIES.some((difficulty) =>
      NATIVE_GROUP_KEYS.some((key) => maps?.[difficulty]?.[key]?.length),
    )
      ? "WeaveEnvironment"
      : "DefaultEnvironment";
  for (const show of shows.filter(Boolean)) {
    if (show.environment && show.environment !== "WeaveEnvironment")
      throw new Error("Native lighting currently targets WeaveEnvironment.");
    if (show.lightTranslationEventBoxGroups?.length)
      throw new Error("Weave does not support native translation groups.");
  }
  for (const difficulty of DIFFICULTIES) {
    const map = maps?.[difficulty];
    if (!map) throw new Error(`Missing ${difficulty} difficulty.`);
    if (map.lightTranslationEventBoxGroups?.length)
      throw new Error("Weave does not support native translation groups.");
    const show = map.lightshow ?? lightshow;
    const nativeGroups = Object.fromEntries(
      NATIVE_GROUP_KEYS.map((key) => {
        const groups = show?.[key] ?? map[key] ?? [];
        if (!Array.isArray(groups)) throw new Error(`${key} must be an array.`);
        // Nested event b values are relative to their parent group and MUST NOT shift.
        return [
          key,
          groups
            .map((group) => ({ ...structuredClone(group), b: timing(group.b) }))
            .sort((a, b) => a.b - b.b),
        ];
      }),
    );
    const boost =
      show?.colorBoostBeatmapEvents ?? map.colorBoostBeatmapEvents ?? [];
    if (!Array.isArray(boost))
      throw new Error("colorBoostBeatmapEvents must be an array.");
    const hasNative = NATIVE_GROUP_KEYS.some(
      (key) => nativeGroups[key].length > 0,
    );
    files[`${difficulty}.dat`] = jsonBytes({
      version: "3.0.0",
      bpmEvents: [],
      rotationEvents: [],
      colorNotes: list(map, "notes", (note) => ({
        b: timing(note.beat),
        x: note.x,
        y: note.y,
        c: note.color,
        d: note.direction,
        a: 0,
      })),
      bombNotes: list(map, "bombs", (bomb) => ({
        b: timing(bomb.beat),
        x: bomb.x,
        y: bomb.y,
      })),
      obstacles: list(map, "obstacles", (wall) => ({
        b: timing(wall.beat),
        x: wall.x,
        y: wall.y,
        w: wall.width,
        h: wall.height,
        d: wall.duration,
      })),
      sliders: [],
      burstSliders: [],
      waypoints: [],
      basicBeatmapEvents: list(
        show?.basicEvents ? { events: show.basicEvents } : map,
        "events",
        (event) => ({
          b: timing(event.beat),
          et: event.type,
          i: event.value,
          f: event.floatValue ?? 1,
        }),
      ),
      colorBoostBeatmapEvents: boost
        .map((event) => ({ b: timing(event.b), o: event.o }))
        .sort((a, b) => a.b - b.b),
      basicEventTypesWithKeywords: { d: [] },
      ...nativeGroups,
      useNormalEventsAsCompatibleEvents: !hasNative,
    });
  }
  files["Info.dat"] = jsonBytes({
    _version: "2.0.0",
    _songName: String(title).trim() || "Untitled",
    _songSubName: "",
    _songAuthorName: String(artist).trim() || "Unknown artist",
    _levelAuthorName: String(author).trim() || "Open Beatmap Generator",
    _beatsPerMinute: bpm,
    _songTimeOffset: 0,
    _shuffle: 0,
    _shufflePeriod: 0,
    _previewStartTime: Math.min(
      Math.max(duration * 0.25, 0),
      Math.max(duration - 10, 0),
    ),
    _previewDuration: Math.min(10, duration),
    _songFilename: "song.ogg",
    _coverImageFilename: coverName,
    _environmentName: environment,
    _allDirectionsEnvironmentName: "GlassDesertEnvironment",
    _difficultyBeatmapSets: [
      {
        _beatmapCharacteristicName: "Standard",
        _difficultyBeatmaps: DIFFICULTIES.map((difficulty, i) => ({
          _difficulty: difficulty,
          _difficultyRank: 1 + i * 2,
          _beatmapFilename: `${difficulty}.dat`,
          _noteJumpMovementSpeed: maps[difficulty].njs ?? SPEEDS[i],
          _noteJumpStartBeatOffset: maps[difficulty].jumpOffset ?? 0,
        })),
      },
    ],
  });
  const validation = validateMapFiles(files, { duration });
  if (!validation.valid)
    throw new Error(`Cannot export map: ${validation.errors.join(" ")}`);
  return files;
}

/** Validates this app's conservative Standard/v3 export profile, not every Beat Saber schema. */
export function validateMapFiles(files, { duration } = {}) {
  const errors = [],
    warnings = [],
    stats = {};
  const fail = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const parse = (name) => {
    try {
      if (!bytes(files?.[name])) throw new Error();
      const value = JSON.parse(decoder.decode(files[name]));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value;
    } catch {
      errors.push(`${name} is missing or is not valid UTF-8 JSON.`);
      return null;
    }
  };
  const info = parse("Info.dat");
  if (!info) return { valid: false, errors, warnings, stats };
  fail(info._version === "2.0.0", "Info.dat must use version 2.0.0.");
  for (const field of ["_songName", "_songAuthorName", "_levelAuthorName"])
    fail(
      typeof info[field] === "string" && info[field].trim().length > 0,
      `Info.dat ${field} must be nonempty.`,
    );
  fail(
    finite(info._beatsPerMinute) &&
      info._beatsPerMinute > 0 &&
      info._beatsPerMinute <= 1000,
    "Info.dat has invalid BPM.",
  );
  fail(
    info._songTimeOffset === 0,
    "Song offset must be baked into beat timestamps.",
  );
  fail(
    ["DefaultEnvironment", "WeaveEnvironment"].includes(info._environmentName),
    "Unsupported environment for this export profile.",
  );
  fail(
    finite(info._previewStartTime) &&
      info._previewStartTime >= 0 &&
      finite(info._previewDuration) &&
      info._previewDuration > 0,
    "Invalid song preview timing.",
  );
  if (finite(duration))
    fail(
      info._previewStartTime + info._previewDuration <= duration + 1e-4,
      "Song preview extends past the audio.",
    );
  const audioName = info._songFilename;
  fail(
    safeFilename(audioName) && /\.(ogg|egg)$/i.test(audioName),
    "Info.dat must reference a local Ogg audio file.",
  );
  const audio = inspectOggVorbis(files?.[audioName]);
  errors.push(...audio.errors);
  const coverName = info._coverImageFilename;
  const cover = safeFilename(coverName)
    ? coverFormat(files?.[coverName])
    : null;
  fail(
    Boolean(cover && new RegExp(`\\.${cover.extension}$`, "i").test(coverName)),
    "Cover file is missing or has invalid image bytes/extension.",
  );
  if (cover && (cover.width !== cover.height || cover.width < 256))
    warnings.push("Use a square cover image at least 256×256 for BeatSaver.");
  const sets = info._difficultyBeatmapSets;
  const difficulties =
    Array.isArray(sets) &&
    sets.length === 1 &&
    sets[0]?._beatmapCharacteristicName === "Standard"
      ? sets[0]._difficultyBeatmaps
      : null;
  fail(
    Array.isArray(difficulties) && difficulties.length === 5,
    "Exactly five Standard difficulties are required.",
  );
  const maxBeat = finite(duration)
    ? (duration * info._beatsPerMinute) / 60
    : Infinity;
  const beatValid = (beat) =>
    finite(beat) && beat >= 0 && beat <= maxBeat + 1e-4;
  function validateGroups(map, difficulty) {
    let total = 0;
    for (const key of NATIVE_GROUP_KEYS) {
      const groups = map[key] ?? [];
      if (!Array.isArray(groups)) {
        errors.push(`${difficulty}: invalid ${key} collection.`);
        continue;
      }
      let previous = -Infinity;
      for (const group of groups) {
        const label = `${difficulty} ${key}`;
        if (!group || typeof group !== "object") {
          errors.push(`${label} contains an invalid group.`);
          continue;
        }
        total++;
        fail(
          info._environmentName === "WeaveEnvironment",
          `${label} requires WeaveEnvironment.`,
        );
        fail(
          beatValid(group.b) && group.b >= previous && integer(group.g, 0, 15),
          `${label} has invalid time or Weave group ID.`,
        );
        previous = group.b;
        if (!Array.isArray(group.e) || !group.e.length) {
          errors.push(`${label} requires event boxes.`);
          continue;
        }
        const lightCount = group.g === 12 || group.g === 13 ? 12 : 8;
        for (const box of group.e) {
          if (!box || typeof box !== "object") {
            errors.push(`${label} contains an invalid box.`);
            continue;
          }
          fail(
            finite(box.w ?? 0) &&
              (box.w ?? 0) >= 0 &&
              integer(box.d ?? 1, 1, 2),
            `${label} has invalid beat distribution.`,
          );
          fail(
            integer(box.t ?? 1, 1, 2) && integer(box.b ?? 0, 0, 1),
            `${label} has invalid attribute distribution.`,
          );
          const filter = box.f ?? { f: 1, p: 1, t: 0 };
          const filterType = filter.f ?? 1,
            p = filter.p ?? 1,
            t = filter.t ?? 0;
          fail(
            integer(filterType, 1, 2) && integer(filter.r ?? 0, 0, 1),
            `${label} has an invalid index filter.`,
          );
          fail(
            filterType === 1
              ? integer(p, 1, lightCount) && integer(t, 0, p - 1)
              : integer(p, 0, lightCount - 1) && integer(t, 1, lightCount),
            `${label} index filter exceeds Weave light counts.`,
          );
          if (filter.l !== undefined)
            fail(
              finite(filter.l) && filter.l >= 0 && filter.l <= 1,
              `${label} has an invalid index limit.`,
            );
          let count =
            filterType === 1
              ? Math.ceil(lightCount / Math.max(1, p))
              : Math.ceil((lightCount - p) / Math.max(1, t));
          if (filter.l) count = Math.ceil(count * filter.l);
          const wave =
            (box.w ?? 0) * ((box.d ?? 1) === 2 ? Math.max(count - 1, 0) : 1);
          const color = key === "lightColorEventBoxGroups";
          if (color)
            fail(
              finite(box.r ?? 0),
              `${label} has invalid brightness distribution.`,
            );
          else
            fail(
              finite(box.s ?? 0) &&
                integer(box.a ?? 0, 0, 1) &&
                integer(box.r ?? 0, 0, 1),
              `${label} has invalid rotation distribution or unsupported axis.`,
            );
          const events = box[color ? "e" : "l"];
          if (!Array.isArray(events) || !events.length) {
            errors.push(`${label} requires relative events.`);
            continue;
          }
          let previousRelative = -Infinity;
          for (const event of events) {
            if (!event || typeof event !== "object") {
              errors.push(`${label} contains an invalid relative event.`);
              continue;
            }
            const relative = event.b ?? 0;
            fail(
              finite(relative) &&
                relative >= 0 &&
                relative >= previousRelative &&
                beatValid(group.b + relative + wave),
              `${label} has invalid relative event timing or extends past audio.`,
            );
            previousRelative = relative;
            if (color) {
              fail(
                integer(event.c ?? 0, -1, 2) &&
                  finite(event.s ?? 1) &&
                  (event.s ?? 1) >= 0 &&
                  integer(event.i ?? 0, 0, 2) &&
                  integer(event.f ?? 0, 0, 100),
                `${label} has invalid color, brightness, transition or frequency.`,
              );
            } else {
              fail(
                finite(event.r ?? 0) &&
                  integer(event.p ?? 0, 0, 1) &&
                  integer(event.o ?? 0, 0, 2) &&
                  integer(event.e ?? 0, -1, 30) &&
                  integer(event.l ?? 0, 0, 100),
                `${label} has invalid rotation event.`,
              );
            }
          }
        }
      }
    }
    if (total)
      fail(
        map.useNormalEventsAsCompatibleEvents === false,
        `${difficulty} native lighting must disable compatible basic-event conversion.`,
      );
    if (map.lightTranslationEventBoxGroups?.length)
      errors.push(`${difficulty} Weave does not support native translation.`);
    let previousBoost = -Infinity;
    const boosts = map.colorBoostBeatmapEvents ?? [];
    if (!Array.isArray(boosts))
      errors.push(`${difficulty} has an invalid color boost collection.`);
    for (const event of Array.isArray(boosts) ? boosts : []) {
      fail(
        event &&
          beatValid(event.b) &&
          event.b >= previousBoost &&
          typeof event.o === "boolean",
        `${difficulty} has invalid color boost data.`,
      );
      previousBoost = event?.b;
    }
    return total;
  }
  for (const [i, difficulty] of DIFFICULTIES.entries()) {
    const entry = difficulties?.find?.(
      (item) => item?._difficulty === difficulty,
    );
    if (!entry) {
      errors.push(`Missing ${difficulty} difficulty metadata.`);
      continue;
    }
    fail(
      entry._difficultyRank === 1 + i * 2,
      `${difficulty} has the wrong difficulty rank.`,
    );
    fail(
      finite(entry._noteJumpMovementSpeed) &&
        entry._noteJumpMovementSpeed > 0 &&
        entry._noteJumpMovementSpeed <= 40 &&
        finite(entry._noteJumpStartBeatOffset),
      `${difficulty} has invalid jump settings.`,
    );
    if (!safeFilename(entry._beatmapFilename)) {
      errors.push(`${difficulty} has an unsafe filename.`);
      continue;
    }
    const map = parse(entry._beatmapFilename);
    if (!map) continue;
    fail(
      map.version === "3.0.0",
      `${difficulty} must use beatmap version 3.0.0.`,
    );
    const collections = [
      "colorNotes",
      "bombNotes",
      "obstacles",
      "basicBeatmapEvents",
    ];
    for (const key of collections)
      fail(
        Array.isArray(map[key]),
        `${difficulty}: missing ${key} collection.`,
      );
    if (collections.some((key) => !Array.isArray(map[key]))) continue;
    fail(
      map.colorNotes.length > 0,
      `${difficulty} must contain at least one note.`,
    );
    const occupied = new Set();
    for (const key of ["colorNotes", "bombNotes"]) {
      let previous = -Infinity;
      for (const item of map[key]) {
        const label = `${difficulty} ${key}`;
        if (!item || typeof item !== "object") {
          errors.push(`${label} contains an invalid object.`);
          continue;
        }
        fail(
          beatValid(item.b) && item.b >= previous,
          `${label} has invalid or unsorted timing.`,
        );
        previous = item.b;
        fail(
          integer(item.x, 0, 3) && integer(item.y, 0, 2),
          `${label} is outside the standard 4×3 grid.`,
        );
        if (key === "colorNotes")
          fail(
            integer(item.c, 0, 1) && integer(item.d, 0, 8) && finite(item.a),
            `${label} has invalid color/direction.`,
          );
        const place = `${item.b}:${item.x}:${item.y}`;
        fail(
          !occupied.has(place),
          `${difficulty} contains overlapping notes/bombs.`,
        );
        occupied.add(place);
      }
    }
    let previousWall = -Infinity;
    for (const wall of map.obstacles) {
      if (!wall || typeof wall !== "object") {
        errors.push(`${difficulty} contains an invalid wall object.`);
        continue;
      }
      fail(
        beatValid(wall.b) &&
          wall.b >= previousWall &&
          finite(wall.d) &&
          wall.d > 0 &&
          beatValid(wall.b + wall.d),
        `${difficulty} has invalid wall timing.`,
      );
      previousWall = wall.b;
      fail(
        integer(wall.x, 0, 3) &&
          integer(wall.y, 0, 2) &&
          integer(wall.w, 1, 4) &&
          wall.x + wall.w <= 4 &&
          integer(wall.h, 1, 5) &&
          wall.y + wall.h <= 5,
        `${difficulty} has invalid standard wall bounds.`,
      );
    }
    let previousEvent = -Infinity;
    for (const event of map.basicBeatmapEvents) {
      if (!event || typeof event !== "object") {
        errors.push(`${difficulty} contains an invalid lighting object.`);
        continue;
      }
      fail(
        beatValid(event.b) &&
          event.b >= previousEvent &&
          EVENT_TYPES.has(event.et) &&
          integer(event.i, 0, 100) &&
          finite(event.f) &&
          event.f >= 0,
        `${difficulty} has invalid lighting event data.`,
      );
      previousEvent = event.b;
      if (event.et >= 0 && event.et <= 4)
        fail(event.i <= 12, `${difficulty} has an invalid light color/action.`);
    }
    const nativeGroups = validateGroups(map, difficulty);
    if (!map.basicBeatmapEvents.length && !nativeGroups)
      warnings.push(`${difficulty} has no lighting events.`);
    stats[difficulty] = {
      notes: map.colorNotes.length,
      bombs: map.bombNotes.length,
      obstacles: map.obstacles.length,
      events: map.basicBeatmapEvents.length,
    };
    if (nativeGroups) stats[difficulty].nativeGroups = nativeGroups;
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    stats,
  };
}

/** Returns ZIP bytes with files at the archive root, ready for custom-song import. */
export async function createMapZip(params) {
  const files = buildMapFiles(params);
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, data]) => [
        name,
        [data, { level: name.endsWith(".dat") ? 6 : 0 }],
      ]),
    ),
    { level: 6 },
  );
}
