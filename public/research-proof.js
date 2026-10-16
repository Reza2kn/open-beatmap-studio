// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/utils/constants.js
var GOOG_BASE_URL = "https://jnn-pa.googleapis.com";
var YT_BASE_URL = "https://www.youtube.com";
var GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
var USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36(KHTML, like Gecko)";

// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/utils/helpers.js
var base64urlCharRegex = /[-_.]/g;
var base64urlToBase64Map = {
  "-": "+",
  _: "/",
  ".": "="
};
var DeferredPromise = class {
  promise;
  resolve;
  reject;
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
};
var BgError = class extends TypeError {
  info;
  constructor(message, info) {
    super(message);
    this.name = "BgError";
    if (info)
      this.info = info;
  }
};
function base64ToU8(base64) {
  let base64Mod;
  if (base64urlCharRegex.test(base64)) {
    base64Mod = base64.replace(base64urlCharRegex, function(match) {
      return base64urlToBase64Map[match];
    });
  } else {
    base64Mod = base64;
  }
  base64Mod = atob(base64Mod);
  return new Uint8Array([...base64Mod].map((char) => char.charCodeAt(0)));
}
function u8ToBase64(u8, base64url = false) {
  const result = btoa(String.fromCharCode(...u8));
  if (base64url) {
    return result.replace(/\+/g, "-").replace(/\//g, "_");
  }
  return result;
}
function isBrowser() {
  const isBrowser2 = typeof window !== "undefined" && typeof window.document !== "undefined" && typeof window.document.createElement !== "undefined" && typeof window.HTMLElement !== "undefined" && typeof window.navigator !== "undefined" && typeof window.getComputedStyle === "function" && typeof window.requestAnimationFrame === "function" && typeof window.matchMedia === "function";
  const hasValidWindow = Object.getOwnPropertyDescriptor(globalThis, "window")?.get?.toString().includes("[native code]") ?? false;
  return isBrowser2 && hasValidWindow;
}
function getHeaders() {
  const headers = {
    "content-type": "application/json+protobuf",
    "x-goog-api-key": GOOG_API_KEY,
    "x-user-agent": "grpc-web-javascript/0.1"
  };
  if (!isBrowser()) {
    headers["user-agent"] = USER_AGENT;
  }
  return headers;
}
function buildURL(endpointName, useYouTubeAPI) {
  return `${useYouTubeAPI ? YT_BASE_URL : GOOG_BASE_URL}/${useYouTubeAPI ? "api/jnn/v1" : "$rpc/google.internal.waa.v1.Waa"}/${endpointName}`;
}

// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/utils/EventEmitterLike.js
var EventEmitterLike = class {
  #listeners = /* @__PURE__ */ new Map();
  #onceWrappers = /* @__PURE__ */ new Map();
  emit(type, ...args) {
    const listeners = this.#listeners.get(type);
    if (!listeners || listeners.size === 0)
      return;
    for (const listener of [...listeners]) {
      listener(...args);
    }
  }
  on(type, listener) {
    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = /* @__PURE__ */ new Set();
      this.#listeners.set(type, listeners);
    }
    listeners.add(listener);
  }
  once(type, listener) {
    const wrapper = (...args) => {
      this.off(type, listener);
      listener(...args);
    };
    let wrappersByType = this.#onceWrappers.get(listener);
    if (!wrappersByType) {
      wrappersByType = /* @__PURE__ */ new Map();
      this.#onceWrappers.set(listener, wrappersByType);
    }
    wrappersByType.set(type, wrapper);
    this.on(type, wrapper);
  }
  off(type, listener) {
    const listeners = this.#listeners.get(type);
    if (!listeners)
      return;
    let target = listener;
    const wrappersByType = this.#onceWrappers.get(listener);
    if (wrappersByType) {
      const onceWrapper = wrappersByType.get(type);
      if (onceWrapper) {
        target = onceWrapper;
        wrappersByType.delete(type);
        if (wrappersByType.size === 0)
          this.#onceWrappers.delete(listener);
      }
    }
    listeners.delete(target);
    if (listeners.size === 0)
      this.#listeners.delete(type);
  }
  removeAllListeners(type) {
    if (!type) {
      this.#listeners.clear();
      this.#onceWrappers.clear();
      return;
    }
    this.#listeners.delete(type);
    for (const [listener, wrappersByType] of this.#onceWrappers.entries()) {
      wrappersByType.delete(type);
      if (wrappersByType.size === 0)
        this.#onceWrappers.delete(listener);
    }
  }
};

// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/core/BotGuardClient.js
var BotGuardClient = class _BotGuardClient extends EventEmitterLike {
  vm;
  program;
  userInteractionElement;
  syncSnapshotFunction;
  deferredVmFunctions = new DeferredPromise();
  defaultTimeout = 3e3;
  on(type, listener) {
    super.on(type, listener);
  }
  off(type, listener) {
    super.off(type, listener);
  }
  constructor(options) {
    super();
    if (!options.globalObject || !options.globalName || !options.program) {
      throw new BgError("Invalid options", { options });
    }
    this.userInteractionElement = options.userInteractionElement;
    this.vm = options.globalObject[options.globalName];
    this.program = options.program;
  }
  /**
   * Factory method to create and load a BotGuardClient instance.
   * @param options - Configuration options for the BotGuardClient.
   * @returns A loaded BotGuardClient instance.
   */
  static async create(options) {
    return await new _BotGuardClient(options).load();
  }
  async load() {
    if (!this.vm)
      throw new BgError("EGOU: BotGuard unavailable");
    if (!this.vm.a)
      throw new BgError("ELIU: BotGuard initialization function unavailable");
    const vmSetupCallback = (asyncSnapshotFunction, shutdownFunction, passEventFunction, checkCameraFunction) => {
      this.deferredVmFunctions.resolve({
        asyncSnapshotFunction,
        shutdownFunction,
        passEventFunction,
        checkCameraFunction
      });
    };
    const logEvent = (event, elapsedTime) => {
      this.emit("record-bg-event", { event, elapsedTime });
    };
    const incrementClientErrorCount = (errorCode) => {
      this.emit("increment-client-error-count", { errorCode });
    };
    const recordPayloadSize = (payloadSize) => {
      this.emit("record-payload-size", { payloadSize });
    };
    const recordLatency = (latency, et) => {
      this.emit("record-latency", { latency, et });
    };
    const incrementEventCount = (event) => {
      this.emit("increment-bg-event-count", { event });
    };
    const loggerFunctions = [
      logEvent,
      incrementClientErrorCount,
      recordPayloadSize,
      recordLatency,
      incrementEventCount
    ];
    const vmTelemetryCallback = (latency, eventFlag1, eventFlag2) => {
      let event = "k";
      if (eventFlag1) {
        event = "h";
      } else if (eventFlag2) {
        event = "u";
      }
      incrementEventCount(event);
      logEvent(event, latency);
    };
    try {
      this.syncSnapshotFunction = await this.vm.a(this.program, vmSetupCallback, true, this.userInteractionElement, vmTelemetryCallback, [[], []], void 0, false, loggerFunctions)?.[0];
    } catch (error) {
      throw new BgError("Could not load program", { error });
    }
    return this;
  }
  /**
   * Calls a VM function with a timeout.
   * @param vmFunctionName - The name of the VM function to execute.
   * @param timeout - The timeout in milliseconds.
   * @param args - The arguments to pass to the VM function.
   */
  async execute(vmFunctionName, timeout, ...args) {
    return await Promise.race([
      (async () => {
        const vmFunctions = await this.deferredVmFunctions.promise;
        const vmFunction = vmFunctions[vmFunctionName];
        if (!vmFunction)
          throw new BgError(`${vmFunctionName} function not found`);
        return vmFunction(...args);
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new BgError("VM operation timed out")), timeout))
    ]);
  }
  /**
   * Takes a snapshot asynchronously.
   * @returns The snapshot result.
   * @example
   * ```ts
   * const result = await botguard.snapshot({
   *   contentBinding: {
   *     c: "a=6&a2=10&b=SZWDwKVIuixOp7Y4euGTgwckbJA&c=1729143849&d=1&t=7200&c1a=1&c6a=1&c6b=1&hh=HrMb5mRWTyxGJphDr0nW2Oxonh0_wl2BDqWuLHyeKLo",
   *     e: "ENGAGEMENT_TYPE_VIDEO_LIKE",
   *     encryptedVideoId: "P-vC09ZJcnM"
   *    }
   * });
   *
   * console.log(result);
   * ```
   */
  async snapshot(args, timeout = this.defaultTimeout) {
    return await new Promise(async (resolve, reject) => {
      await this.execute("asyncSnapshotFunction", timeout, (response) => resolve(response), [
        args.contentBinding,
        args.signedTimestamp,
        args.webPoSignalOutput,
        args.skipPrivacyBuffer
      ]).catch(reject);
    });
  }
  /**
   * Passes an event to the VM.
   */
  async passEvent(args, timeout = this.defaultTimeout) {
    return this.execute("passEventFunction", timeout, args);
  }
  /**
   * Checks the "camera".
   */
  async checkCamera(args, timeout = this.defaultTimeout) {
    return this.execute("checkCameraFunction", timeout, args);
  }
  /**
   * Shuts down the VM. Once called, the VM is no longer usable.
   */
  async shutdown(timeout = this.defaultTimeout) {
    return this.execute("shutdownFunction", timeout);
  }
  /**
   * Takes a snapshot synchronously.
   * @returns The snapshot result.
   */
  async snapshotSynchronous(args) {
    if (!this.syncSnapshotFunction)
      throw new BgError("Synchronous snapshot function not found");
    return this.syncSnapshotFunction([
      args.contentBinding,
      args.signedTimestamp,
      args.webPoSignalOutput,
      args.skipPrivacyBuffer
    ]);
  }
};

// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/core/ChallengeFetcher.js
async function getChallenge(config) {
  const { requestKey: requestKey2, interpreterHash, fetchFunction, useYouTubeAPI } = config;
  if (!fetchFunction)
    throw new BgError("No fetch function provided");
  if (!requestKey2)
    throw new BgError("No request key provided");
  const payload = [requestKey2];
  if (interpreterHash)
    payload.push(interpreterHash);
  const response = await fetchFunction(buildURL("Create", useYouTubeAPI), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok)
    throw new BgError("Failed to fetch challenge", { status: response.status });
  const rawData = await response.json();
  return parseChallengeData(rawData);
}
function parseChallengeData(rawData) {
  let challengeData = [];
  if (rawData.length > 1 && typeof rawData[1] === "string") {
    const descrambled = descrambleChallenge(rawData[1]);
    challengeData = JSON.parse(descrambled || "[]");
  } else if (rawData.length && typeof rawData[0] === "object") {
    challengeData = rawData[0];
  }
  const [messageId, wrappedScript, wrappedUrl, interpreterHash, program, globalName, , clientExperimentsStateBlob] = challengeData;
  const privateDoNotAccessOrElseSafeScriptWrappedValue = Array.isArray(wrappedScript) ? wrappedScript.find((value) => value && typeof value === "string") : void 0;
  const privateDoNotAccessOrElseTrustedResourceUrlWrappedValue = Array.isArray(wrappedUrl) ? wrappedUrl.find((value) => value && typeof value === "string") : void 0;
  const clientSideBgChallenge = {
    messageId,
    interpreterHash,
    program,
    globalName,
    clientExperimentsStateBlob
  };
  if (privateDoNotAccessOrElseSafeScriptWrappedValue) {
    clientSideBgChallenge.interpreterJavascript = {
      privateDoNotAccessOrElseSafeScriptWrappedValue
    };
  }
  if (privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
    clientSideBgChallenge.interpreterUrl = {
      privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
    };
  }
  return clientSideBgChallenge;
}
function descrambleChallenge(scrambledChallenge) {
  const buffer = base64ToU8(scrambledChallenge);
  if (buffer.length)
    return new TextDecoder().decode(buffer.map((b) => b + 97));
}

// .local-tests/youtube-po-proof/node_modules/bgutils-js/dist/core/WebPoMinter.js
var WebPoMinter = class _WebPoMinter {
  mintCallback;
  constructor(mintCallback) {
    this.mintCallback = mintCallback;
  }
  /**
   * Factory method to create a WebPoMinter instance.
   * @param integrityTokenResponse - The integrity token response object.
   * @param webPoSignalOutput - The output array containing the minter function.
   */
  static async create(integrityTokenResponse, webPoSignalOutput) {
    const getMinter = webPoSignalOutput[0];
    if (!getMinter)
      throw new BgError("PMD:Undefined");
    if (!integrityTokenResponse.integrityToken)
      throw new BgError("No integrity token provided", { integrityTokenResponse });
    const mintCallback = await getMinter(base64ToU8(integrityTokenResponse.integrityToken));
    if (!(mintCallback instanceof Function))
      throw new BgError("APF:Failed");
    return new _WebPoMinter(mintCallback);
  }
  /**
   * Mints a proof and returns it as a web-safe base64 string.
   * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
   */
  async mintAsWebsafeString(contentBinding) {
    return u8ToBase64(await this.mint(contentBinding), true);
  }
  /**
   * Mints a proof and returns it as a Uint8Array.
   * @param contentBinding - A Visitor ID, Video ID, or Data Sync ID.
   */
  async mint(contentBinding) {
    const result = await this.mintCallback(new TextEncoder().encode(contentBinding));
    if (!result)
      throw new BgError("YNJ:Undefined");
    if (!(result instanceof Uint8Array))
      throw new BgError("ODM:Invalid");
    return result;
  }
};

// .local-tests/youtube-po-proof/hosted-test.js
var $ = (s) => document.querySelector(s);
var status = $("#status");
var run = $("#run");
var download = $("#download");
var secretResult = null;
var botguard = null;
var controller = null;
var requestKey = "O43z0dpjhgX20SCx4KAo";
function cleanError(error) {
  return String(error?.message || error).replace(/https?:\/\/\S+/g, "[upstream URL]").slice(0, 400);
}
function render(data) {
  status.textContent = JSON.stringify(data, null, 2);
}
function deadline(promise, milliseconds, label) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds))]);
}
run.addEventListener("click", async () => {
  const videoId = $("#video").value.trim();
  if (!/^[\w-]{11}$/.test(videoId)) {
    render({ error: "Use one 11-character public YouTube video ID." });
    return;
  }
  if (botguard) try {
    await botguard.shutdown();
  } catch {
  }
  botguard = null;
  secretResult = null;
  download.disabled = true;
  run.disabled = true;
  controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), 6e4);
  const started = performance.now(), requests = [];
  let stage = "challenge";
  const useYouTubeAPI = $("#service").value === "youtube";
  const progress = () => render({ stage, videoId, elapsedSeconds: +((performance.now() - started) / 1e3).toFixed(2), requests });
  const fetchFunction = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const response = await fetch(input, { ...init, credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    requests.push({ host: url.host, path: url.pathname, status: response.status });
    progress();
    return response;
  };
  try {
    progress();
    const challenge = await getChallenge({ requestKey, fetchFunction, useYouTubeAPI });
    if (!challenge.program || !challenge.globalName) throw new Error("Challenge omitted program/global name.");
    stage = "load Google interpreter";
    progress();
    const script = document.createElement("script");
    script.dataset.proofInterpreter = "true";
    const inline = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (inline) {
      script.textContent = inline;
      document.head.append(script);
    } else {
      const raw = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
      if (!raw) throw new Error("Challenge omitted interpreter.");
      const url = new URL(raw, "https://www.youtube.com");
      if (url.protocol !== "https:" || !["www.youtube.com", "www.google.com", "www.gstatic.com", "jnn-pa.googleapis.com"].includes(url.hostname)) throw new Error("Interpreter host not allowed in this proof.");
      await deadline(new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error("Google interpreter script failed to load."));
        script.src = url.href;
        document.head.append(script);
      }), 15e3, "Interpreter load");
    }
    if (!window[challenge.globalName]) throw new Error("Google interpreter did not expose its expected VM.");
    stage = "initialize BotGuard";
    progress();
    botguard = await deadline(BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObject: window, userInteractionElement: run }), 15e3, "BotGuard initialization");
    stage = "take browser snapshot";
    progress();
    const webPoSignalOutput = [];
    const snapshot = await deadline(botguard.snapshot({ webPoSignalOutput }, 15e3), 17e3, "Browser snapshot");
    stage = "request integrity response";
    progress();
    const response = await fetchFunction(buildURL("GenerateIT", useYouTubeAPI), { method: "POST", headers: getHeaders(), body: JSON.stringify([requestKey, snapshot]) });
    if (!response.ok) throw new Error(`Integrity response returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data) || typeof data[0] !== "string" || !data[0]) throw new Error("Integrity response omitted a token.");
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = data;
    stage = "mint video-bound proof";
    progress();
    const minter = await deadline(WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput), 1e4, "Minter initialization");
    const playerPoToken = await deadline(minter.mintAsWebsafeString(videoId), 1e4, "Proof minting");
    if (!playerPoToken || playerPoToken.length < 8) throw new Error("Minter returned an empty or unexpectedly short proof.");
    const elapsedSeconds = +((performance.now() - started) / 1e3).toFixed(3);
    secretResult = { schemaVersion: 1, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), videoId, contentBinding: videoId, context: "player", clientFamily: "WEB", library: "bgutils-js@4.0.3", playerPoToken, estimatedTtlSecs, mintRefreshThreshold, userAgent: navigator.userAgent, origin: location.origin, elapsedSeconds };
    render({ success: true, meaning: "A proof was minted. YouTube player/media acceptance has not been tested.", videoId, contentBinding: videoId, proofCharacters: playerPoToken.length, estimatedTtlSecs, mintRefreshThreshold, elapsedSeconds, requests });
    stage = "test hosted player and audio";
    progress();
    const audio = await fetch("/api/youtube/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}`, proof: playerPoToken }), signal: controller.signal });
    if (!audio.ok) {
      const error = await audio.json();
      throw new Error(error.error || `Hosted importer returned ${audio.status}`);
    }
    const bytes = (await audio.arrayBuffer()).byteLength;
    render({ success: true, meaning: "Hosted audio downloaded with browser proof.", videoId, audioBytes: bytes, mime: audio.headers.get("Content-Type"), elapsedSeconds: +((performance.now() - started) / 1e3).toFixed(3) });
    download.disabled = false;
  } catch (error) {
    secretResult = null;
    render({ success: false, stage, videoId, error: cleanError(error), elapsedSeconds: +((performance.now() - started) / 1e3).toFixed(3), requests });
  } finally {
    clearTimeout(cancel);
    run.disabled = false;
  }
});
download.addEventListener("click", () => {
  if (!secretResult) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(secretResult, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `private-youtube-po-${secretResult.videoId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
});
window.addEventListener("pagehide", () => {
  controller?.abort();
  secretResult = null;
  botguard?.shutdown().catch(() => {
  });
});
