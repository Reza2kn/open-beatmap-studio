import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
const RED = 0xff584f,
  BLUE = 0x51bbef;
const angles = {
  0: Math.PI,
  1: 0,
  2: -Math.PI / 2,
  3: Math.PI / 2,
  4: -Math.PI * 0.75,
  5: Math.PI * 0.75,
  6: -Math.PI * 0.25,
  7: Math.PI * 0.25,
};
function arrowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(64, 100);
  g.lineTo(27, 53);
  g.lineTo(47, 53);
  g.lineTo(47, 24);
  g.lineTo(81, 24);
  g.lineTo(81, 53);
  g.lineTo(101, 53);
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}
export class Stage {
  constructor(
    container,
    { getTime, isPlaying, onHit, onMiss, onWall, onCue } = {},
  ) {
    this.container = container;
    this.getTime = getTime;
    this.isPlaying = isPlaying;
    this.onHit = onHit;
    this.onMiss = onMiss;
    this.onWall = onWall;
    this.onCue = onCue;
    this.practice = false;
    this.color = 0;
    this.hit = new Set();
    this.missed = new Set();
    this.wallHits = new Set();
    this.particles = [];
    this.pointer = [];
    this.lastPointer = null;
    this.disposed = false;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#080d13");
    this.scene.fog = new THREE.FogExp2("#080d13", 0.027);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 150);
    this.camera.position.set(0, 2.7, 6.6);
    this.camera.lookAt(0, 1.55, -13);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D beatmap preview. Use Play or Mouse practice below.",
    );
    this.renderer.domElement.tabIndex = 0;
    this.scene.add(new THREE.AmbientLight("#dbe6fa", 2));
    const key = new THREE.DirectionalLight("#ffffff", 3);
    key.position.set(3, 6, 8);
    this.scene.add(key);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 110),
      new THREE.MeshStandardMaterial({
        color: 0x0c1520,
        roughness: 0.5,
        metalness: 0.6,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.1, -43);
    this.scene.add(floor);
    const grid = new THREE.GridHelper(100, 80, 0x1d3549, 0x132333);
    grid.position.set(0, -0.08, -40);
    this.scene.add(grid);
    this.rails = [];
    for (const x of [-2.4, 2.4]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.025, 100),
        new THREE.MeshBasicMaterial({ color: x < 0 ? RED : BLUE }),
      );
      rail.position.set(x, 0, -45);
      this.scene.add(rail);
    }
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x203b4d,
      transparent: true,
      opacity: 0.65,
    });
    for (let i = 0; i < 12; i++) {
      const z = -8 - i * 7;
      const points = [
        [-7, 0, z],
        [-7, 6, z],
        [-4, 8, z],
        [4, 8, z],
        [7, 6, z],
        [7, 0, z],
      ].map((p) => new THREE.Vector3(...p));
      this.scene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          lineMat,
        ),
      );
    }
    this.beams = [];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? -1 : 1,
        z = -9 - Math.floor(i / 2) * 8;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(side * 5, 0, z),
        new THREE.Vector3(-side * 1.7, 9, z - 10),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: side < 0 ? RED : BLUE,
        transparent: true,
        opacity: 0.45,
      });
      const beam = new THREE.Line(geometry, mat);
      this.scene.add(beam);
      this.beams.push(beam);
    }
    this.noteGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72);
    this.arrowGeometry = new THREE.PlaneGeometry(0.55, 0.55);
    this.texture = arrowTexture();
    this.noteMaterials = [RED, BLUE].map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.26,
          metalness: 0.15,
          emissive: color,
          emissiveIntensity: 0.28,
        }),
    );
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
    });
    this.buildLightRig();
    this.objects = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.projected = new THREE.Vector3();
    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 12),
      new THREE.MeshBasicMaterial({ color: RED }),
    );
    this.scene.add(this.cursor);
    this.cursor.visible = false;
    this.saberTrail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: RED,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.scene.add(this.saberTrail);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(800, 400),
      0.65,
      0.55,
      0.7,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.move = (e) => this.pointerMove(e);
    this.down = (e) => {
      if (!this.practice) return;
      e.preventDefault();
      this.color = e.button === 2 ? 1 : 0;
      this.dragging = true;
      this.lastPointer = null;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.pointerMove(e);
    };
    this.up = () => {
      this.dragging = false;
      this.lastPointer = null;
    };
    this.contextmenu = (e) => e.preventDefault();
    this.renderer.domElement.addEventListener("pointermove", this.move);
    this.renderer.domElement.addEventListener("pointerdown", this.down);
    this.renderer.domElement.addEventListener("pointerup", this.up);
    this.renderer.domElement.addEventListener("pointercancel", this.up);
    this.renderer.domElement.addEventListener("contextmenu", this.contextmenu);
    this.key = (e) => {
      if (!this.practice || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))
        return;
      if (e.key === "1" || e.key === "2") {
        this.color = Number(e.key) - 1;
        this.cursor.material.color.setHex(this.color ? BLUE : RED);
      }
    };
    window.addEventListener("keydown", this.key);
    this.frame = () => {
      if (this.disposed) return;
      this.render();
      this.raf = requestAnimationFrame(this.frame);
    };
    this.frame();
  }
  buildLightRig() {
    this.fixtures = [];
    for (let group = 0; group < 16; group++)
      for (let j = 0; j < (group === 12 || group === 13 ? 12 : 8); j++) {
        const count = group === 12 || group === 13 ? 12 : 8,
          u = j / (count - 1),
          side = group % 4,
          z = -7 - Math.floor(group / 4) * 10;
        const origin = new THREE.Vector3(
          side === 0 ? -5.8 : side === 1 ? 5.8 : -5.8 + u * 11.6,
          side < 2 ? 0.25 + u * 6 : side === 2 ? 6.6 : 0.05,
          z,
        );
        this.fixtures.push({ group, j, u, side, origin });
      }
    const count = this.fixtures.length;
    this.lightRig = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.026, 0.006, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      count,
    );
    this.lightGlow = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.1, 0.02, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      count,
    );
    this.lightTips = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      count,
    );
    this.lightRig.frustumCulled =
      this.lightGlow.frustumCulled =
      this.lightTips.frustumCulled =
        false;
    for (const mesh of [this.lightRig, this.lightGlow, this.lightTips])
      this.scene.add(mesh);
    this.lightDummy = new THREE.Object3D();
    this.lightTarget = new THREE.Vector3();
    this.lightDirection = new THREE.Vector3();
    this.lightColor = new THREE.Color();
    this.upVector = new THREE.Vector3(0, 1, 0);
  }
  setLightshow(show) {
    this.renderDirty = true;
    this.lightshow = show;
    this.cues = show?.previewCues || [];
    const active = this.cues.length > 0;
    this.lightRig.visible =
      this.lightGlow.visible =
      this.lightTips.visible =
        active;
    for (const b of this.beams) b.visible = !show;
  }
  renderLightshow(now) {
    if (!this.cues?.length) return;
    let lo = 0,
      hi = this.cues.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >>> 1;
      if (this.cues[m].time <= now + 0.0001) lo = m + 1;
      else hi = m - 1;
    }
    const cue = this.cues[Math.max(0, hi)];
    if (this.currentCue !== cue) {
      this.currentCue = cue;
      this.onCue?.(cue);
    }
    const elapsed = Math.max(0, now - cue.time),
      period = 60 / (this.bpm || 128),
      beat = (now - (this.offset || 0)) / period;
    const decay = Math.exp(-elapsed / (period * 0.8)),
      brightness = cue.brightness * (0.25 + 0.75 * decay),
      motion = cue.motion;
    const activeGroups = new Set(cue.groups),
      travel = beat * 0.12 * motion;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i],
        phase = f.u * Math.PI * 2 + travel,
        bankActive = activeGroups.has(f.group),
        strength = brightness * (bankActive ? 1 : 0.18);
      const color = (cue.color + (f.group % 2)) % 2 ? BLUE : RED;
      this.lightColor.setHex(color);
      if (cue.treble > 0.6 && f.j % 3 === 0)
        this.lightColor.lerp(new THREE.Color(0xd5eeff), cue.treble * 0.6);
      this.lightColor.multiplyScalar(Math.max(0.015, strength * 2));
      let x = 0,
        y = 3,
        z = f.origin.z - 12;
      switch (cue.pattern) {
        case "ribbon":
          x = Math.sin(phase + f.group * 0.4) * 4 * motion;
          y = 2 + Math.cos(phase * 0.7) * 3 * motion;
          break;
        case "orbit":
          x = Math.cos(phase) * 5 * motion;
          y = 3 + Math.sin(phase) * 4 * motion;
          break;
        case "fan":
          x = (f.u - 0.5) * 14 * cue.fan;
          y = 3 + Math.sin(travel + f.group) * 3 * motion;
          break;
        case "helix":
          x = Math.cos(phase + f.group * 0.5) * 5 * motion;
          y = 3 + Math.sin(phase + f.group * 0.5) * 4 * motion;
          break;
        case "tunnel":
          x = f.origin.x * 0.35;
          y = 3 + (f.origin.y - 3) * 0.35;
          z = f.origin.z - 25;
          break;
        case "diagonal":
          x = (f.u - 0.5) * 11 * motion;
          y = 1 + f.u * 6;
          break;
        case "rise":
          x = (f.u - 0.5) * 9 * motion;
          y = 2 + cue.phraseProgress * 8;
          break;
        case "bloom":
          x = (f.u - 0.5) * 17 * cue.fan;
          y = 3 + Math.sin(phase) * 6 * cue.fan;
          break;
        case "breath":
          x = f.origin.x * 0.8;
          y = 4;
          break;
      }
      if (motion === 0) {
        x = 0;
        y = 3;
        z = f.origin.z - 12;
      }
      x += cue.sweep * 2;
      this.lightTarget.set(x, y, z);
      this.lightDirection.copy(this.lightTarget).sub(f.origin);
      const length = this.lightDirection.length();
      this.lightDummy.position
        .copy(f.origin)
        .add(this.lightTarget)
        .multiplyScalar(0.5);
      this.lightDummy.quaternion.setFromUnitVectors(
        this.upVector,
        this.lightDirection.normalize(),
      );
      this.lightDummy.scale.set(1, length, 1);
      this.lightDummy.updateMatrix();
      this.lightRig.setMatrixAt(i, this.lightDummy.matrix);
      this.lightGlow.setMatrixAt(i, this.lightDummy.matrix);
      this.lightRig.setColorAt(i, this.lightColor);
      this.lightGlow.setColorAt(i, this.lightColor);
      this.lightDummy.position.copy(f.origin);
      this.lightDummy.scale.setScalar(0.6 + strength * 2);
      this.lightDummy.quaternion.identity();
      this.lightDummy.updateMatrix();
      this.lightTips.setMatrixAt(i, this.lightDummy.matrix);
      this.lightTips.setColorAt(i, this.lightColor);
    }
    for (const mesh of [this.lightRig, this.lightGlow, this.lightTips]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderDirty = true;
  }
  reset() {
    this.renderDirty = true;
    this.hit.clear();
    this.missed.clear();
    this.wallHits.clear();
    // Seeking starts a fresh practice window; earlier notes are skipped.
    const now = this.getTime?.() || 0;
    for (const o of this.objects || []) {
      if (o.kind === "note" && o.time < now - 0.18) this.missed.add(o);
    }
  }
  setMap(map, bpm, offset) {
    for (const o of this.objects) {
      this.scene.remove(o.mesh);
      o.mesh.traverse((c) => {
        if (c.userData.disposable) {
          c.material?.dispose();
          c.geometry?.dispose();
        }
      });
    }
    this.objects = [];
    this.map = map;
    this.bpm = bpm;
    this.offset = offset;
    this.reset();
    for (const [index, n] of map.notes.entries()) {
      const mesh = new THREE.Group(),
        cube = new THREE.Mesh(this.noteGeometry, this.noteMaterials[n.color]);
      mesh.add(cube);
      const arrow = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
      arrow.position.z = 0.367;
      if (n.direction === 8) {
        arrow.scale.set(0.33, 0.33, 1);
      } else arrow.rotation.z = angles[n.direction] || 0;
      mesh.add(arrow);
      mesh.position.set(n.x - 1.5, n.y + 0.65, 0);
      this.scene.add(mesh);
      this.objects.push({
        kind: "note",
        data: n,
        index,
        time: offset + (n.beat * 60) / bpm,
        mesh,
      });
    }
    const bombGeo = new THREE.IcosahedronGeometry(0.36, 1);
    for (const [index, n] of map.bombs.entries()) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x20272f,
        emissive: 0xff6352,
        emissiveIntensity: 0.2,
        wireframe: true,
      });
      const mesh = new THREE.Mesh(bombGeo, mat);
      mesh.userData.disposable = true;
      mesh.position.set(n.x - 1.5, n.y + 0.65, 0);
      this.scene.add(mesh);
      this.objects.push({
        kind: "bomb",
        index,
        data: n,
        time: offset + (n.beat * 60) / bpm,
        mesh,
      });
    }
    for (const [index, w] of map.obstacles.entries()) {
      const depth = ((w.duration * 60) / bpm) * 10;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w.width, w.height, depth),
        new THREE.MeshBasicMaterial({
          color: 0xe86c54,
          wireframe: true,
          transparent: true,
          opacity: 0.4,
        }),
      );
      mesh.userData.disposable = true;
      mesh.position.set(w.x - 2 + w.width / 2, w.y + w.height / 2 - 0.1, 0);
      this.scene.add(mesh);
      this.objects.push({
        kind: "wall",
        index,
        data: w,
        depth,
        time: offset + (w.beat * 60) / bpm,
        mesh,
      });
    }
    this.objects.sort((a, b) => a.time - b.time);
  }
  setPractice(active) {
    this.practice = active;
    this.cursor.visible = active;
    this.renderer.domElement.style.cursor = active ? "crosshair" : "default";
    this.reset();
  }
  pointerMove(e) {
    if (!this.practice) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -1),
      p,
    );
    this.cursor.position.copy(p);
    this.cursor.material.color.setHex(this.color ? BLUE : RED);
    this.pointer.push({ p: p.clone(), at: performance.now() });
    this.pointer = this.pointer.slice(-12);
    if (this.dragging && this.isPlaying()) {
      const from = this.lastPointer || p;
      const segment = new THREE.Line3(from, p),
        closest = new THREE.Vector3(),
        movement = p.clone().sub(from);
      for (const o of this.objects) {
        if (Math.abs(o.time - this.getTime()) > 0.18 || this.hit.has(o))
          continue;
        if (o.kind === "wall") continue;
        segment.closestPointToPoint(
          new THREE.Vector3(o.mesh.position.x, o.mesh.position.y, 1),
          true,
          closest,
        );
        if (
          closest.distanceTo(
            new THREE.Vector3(o.mesh.position.x, o.mesh.position.y, 1),
          ) > 0.52
        )
          continue;
        if (o.kind === "bomb") {
          this.hit.add(o);
          this.onHit?.({ bomb: true });
          this.burst(o.mesh.position, 0xffa05c);
          continue;
        }
        if (o.data.color !== this.color || movement.length() < 0.035) continue;
        const vectors = {
          0: [0, 1],
          1: [0, -1],
          2: [-1, 0],
          3: [1, 0],
          4: [-1, 1],
          5: [1, 1],
          6: [-1, -1],
          7: [1, -1],
        };
        const v = vectors[o.data.direction];
        if (
          v &&
          new THREE.Vector2(movement.x, movement.y)
            .normalize()
            .dot(new THREE.Vector2(...v).normalize()) < 0.15
        )
          continue;
        this.hit.add(o);
        this.onHit?.({ note: o.data });
        this.burst(o.mesh.position, o.data.color ? BLUE : RED);
      }
    }
    this.lastPointer = p.clone();
  }
  burst(position, color) {
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.08),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        life: 1,
        v: new THREE.Vector3(
          (Math.random() - 0.5) * 0.13,
          Math.random() * 0.1,
          (Math.random() - 0.5) * 0.1,
        ),
      });
    }
  }
  render() {
    const now = this.getTime?.() || 0;
    if (
      this.lastRenderedTime === now &&
      !this.renderDirty &&
      !this.particles.length &&
      !this.pointer.length
    )
      return;
    this.lastRenderedTime = now;
    this.renderDirty = false;
    this.time = now;
    const playing = this.isPlaying?.();
    this.renderLightshow(now);
    if (this.map) {
      const beat = ((now - this.offset) * this.bpm) / 60;
      let flash = 0.12;
      const events = this.map.events;
      let last = null;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].beat <= beat) {
          last = events[i];
          break;
        }
      }
      if (last && last.value !== 0)
        flash = Math.max(
          0.12,
          Math.min(
            0.85,
            (last.floatValue || 1) * 0.35 * Math.exp(-(beat - last.beat) * 0.8),
          ),
        );
      for (const b of this.beams) b.material.opacity = flash;
      for (const o of this.objects) {
        const dt = o.time - now;
        const end =
          o.kind === "wall" ? (-o.data.duration * 60) / this.bpm - 0.5 : -0.25;
        o.mesh.visible =
          dt < 5.5 && dt > end && !this.hit.has(o) && !this.lightshowOnly;
        o.mesh.position.z = 1 - dt * 10 - (o.depth || 0) / 2;
        if (
          this.practice &&
          playing &&
          o.kind === "note" &&
          dt < -0.18 &&
          !this.hit.has(o) &&
          !this.missed.has(o)
        ) {
          this.missed.add(o);
          this.onMiss?.();
        }
        if (
          this.practice &&
          playing &&
          o.kind === "wall" &&
          dt < 0 &&
          dt > (-o.data.duration * 60) / this.bpm &&
          !this.wallHits.has(o) &&
          this.cursor.visible &&
          Math.abs(this.cursor.position.x - o.mesh.position.x) <
            o.data.width / 2 + 0.1
        ) {
          this.wallHits.add(o);
          this.onWall?.();
        }
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= 0.035;
      p.mesh.position.add(p.v);
      p.mesh.rotation.x += 0.1;
      p.mesh.material.opacity = p.life;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    this.pointer = this.pointer.filter((p) => performance.now() - p.at < 140);
    this.saberTrail.geometry.dispose();
    this.saberTrail.geometry = new THREE.BufferGeometry().setFromPoints(
      this.pointer.map((p) => p.p),
    );
    this.saberTrail.material.color.setHex(this.color ? BLUE : RED);
    this.composer.render();
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.key);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material)
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          m.dispose(),
        );
    });
    this.texture.dispose();
    this.composer.dispose();
    this.bloom.dispose();
    this.renderer.dispose();
  }
}
