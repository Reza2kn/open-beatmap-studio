import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Stage } from "../src/preview.js";
import { PRACTICE_LIMITS, assessPracticeCut, projectPracticeBox, sweepMovingBox } from "../src/practice.js";

const box = { minX: 90, minY: 90, maxX: 110, maxY: 110 };
const cut = overrides => assessPracticeCut({ from: { x: 100, y: 50, time: 4.97 },
  to: { x: 100, y: 150, time: 5.03 }, before: box, after: box,
  attackTime: 5, direction: 1, ...overrides });

test("a fast swipe crosses a cube even when both sampled endpoints miss", () => {
  assert.deepEqual(sweepMovingBox({ x: 0, y: 100 }, { x: 200, y: 100 }, box, box), { enter: .45, exit: .55 });
  assert.equal(cut().hit, true);
  assert.equal(cut().timingError, 0);
});

test("swept contact follows a target that moves and grows between input samples", () => {
  const before = { minX: 20, maxX: 40, minY: 80, maxY: 120 };
  const after = { minX: 150, maxX: 190, minY: 70, maxY: 130 };
  // At the halfway point the cursor and the moving target meet. Testing
  // against either endpoint target alone would miss this vertical stroke.
  const contact = sweepMovingBox({ x: 100, y: 0 }, { x: 100, y: 200 }, before, after);
  assert.ok(contact && contact.enter < .5 && contact.exit > .5);
  assert.equal(sweepMovingBox({ x: 0, y: 0 }, { x: 20, y: 20 }, before, after), null);
});

test("all eight visible arrow directions accept their matching screen-space swipe", () => {
  const vectors = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [direction, [x,y]] of vectors.entries()) {
    const from = { x: 100 - x * 50, y: 100 - y * 50, time: 4.97 };
    const to = { x: 100 + x * 50, y: 100 + y * 50, time: 5.03 };
    assert.equal(cut({ direction, from, to }).hit, true, `direction ${direction}`);
    assert.equal(cut({ direction, from: { ...to, time: 4.97 }, to: { ...from, time: 5.03 } }).hit, false, `reverse ${direction}`);
  }
  assert.equal(cut({ direction: 8, from: { x: 50, y: 100, time: 4.97 }, to: { x: 150, y: 100, time: 5.03 } }).hit, true);
});

test("desktop tolerance still rejects stationary, distant, wrong-direction and mistimed cuts", () => {
  assert.equal(cut({ from: { x: 100, y: 100, time: 4.97 }, to: { x: 100, y: 100, time: 5.03 } }).reason, "still");
  assert.equal(cut({ from: { x: 10, y: 50, time: 4.97 }, to: { x: 10, y: 150, time: 5.03 } }).reason, "position");
  assert.equal(cut({ direction: 0 }).reason, "direction");
  assert.equal(cut({ from: { x: 100, y: 50, time: 4.5 }, to: { x: 100, y: 150, time: 4.55 } }).reason, "timing");
  assert.equal(cut({ from: { x: 100, y: 50, time: 5.3 }, to: { x: 100, y: 150, time: 5.35 } }).reason, "timing");
  assert.equal(cut({ from: { x: 100, y: 50, time: 4 }, to: { x: 100, y: 150, time: 5 } }).reason, "stale");
});

test("timing is judged at geometric contact rather than only at the event endpoint", () => {
  const tiny = { minX: 98, maxX: 102, minY: 98, maxY: 102 };
  const limits = { ...PRACTICE_LIMITS, padding: 0 };
  assert.equal(cut({ limits, before: tiny, after: tiny,
    from: { x: 100, y: 0, time: 4.64 }, to: { x: 100, y: 1000, time: 4.76 } }).hit, false);
  assert.equal(cut({ from: { x: 100, y: 50, time: 5.19 }, to: { x: 100, y: 150, time: 5.23 } }).hit, true);
});

test("one default mouse action can cut red and blue, without ignoring explicit strict-color mode", () => {
  for (const noteColor of [0,1]) assert.equal(cut({ noteColor, selectedColor: 0 }).hit, true);
  assert.equal(cut({ noteColor: 1, selectedColor: 0, colorMode: "single" }).reason, "color");
  assert.equal(cut({ kind: "bomb", direction: 0 }).hit, true, "bomb contact has no arrow requirement");
});

function cameraFor(rect) {
  const camera = new THREE.PerspectiveCamera(58, rect.width / rect.height, .1, 150);
  camera.position.set(0, 2.7, 6.6); camera.lookAt(0, 1.55, -13); camera.updateMatrixWorld();
  return camera;
}
function project(point, camera, rect) {
  const p = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
}

test("a swipe through the actual early cube works where the old fixed-plane proxy misses", () => {
  const rect = { left: 130, top: 80, width: 850, height: 480 };
  const camera = cameraFor(rect);
  const center = { x: 1.5, y: .65, z: -1.4 };
  const visible = project(center, camera, rect);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((visible.x-rect.left)/rect.width*2-1, 1-(visible.y-rect.top)/rect.height*2), camera);
  const oldProxy = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1), -1), new THREE.Vector3());
  assert.ok(Math.hypot(oldProxy.x-center.x, oldProxy.y-center.y) > .52, "the former hit proxy rejects a cursor directly over this cube");
  const bounds = projectPracticeBox(center, .36, point => project(point, camera, rect));
  assert.equal(assessPracticeCut({ from: { x: visible.x, y: visible.y-25, time: 4.76 },
    to: { x: visible.x, y: visible.y+25, time: 4.77 }, before: bounds, after: bounds, attackTime: 5, direction: 1 }).hit, true);
});

function makeStage(objects) {
  const rect = { left: 130, top: 80, width: 850, height: 480, right: 980, bottom: 560 };
  const capture = new Set(), hits = [];
  const stage = Object.create(Stage.prototype);
  let time = 0, playing = true;
  Object.assign(stage, {
    objects, practice: true, dragging: false, activePointerId: null,
    pointer: [], lastPointer: null, strokeAnchor: null, pointerInside: false,
    hit: new Set(), missed: new Set(), wallHits: new Set(), color: 0,
    mouse: new THREE.Vector2(), projected: new THREE.Vector3(), raycaster: new THREE.Raycaster(),
    camera: cameraFor(rect), cursor: { position: new THREE.Vector3(), material: { color: new THREE.Color() } },
    renderer: { domElement: { focus() {}, getBoundingClientRect: () => rect,
      setPointerCapture: id => capture.add(id), hasPointerCapture: id => capture.has(id), releasePointerCapture: id => capture.delete(id) } },
    getTime: () => time, isPlaying: () => playing, onHit: hit => hits.push(hit), burst() {},
  });
  return { stage, rect, hits, capture, setTime: value => { time = value; }, setPlaying: value => { playing = value; } };
}
const object = (time, color = 0, direction = 1, x = 0, y = 1.65) => ({
  kind: "note", time, data: { color, direction }, mesh: { position: new THREE.Vector3(x,y,0) },
});
const event = (point, timeStamp, extra = {}) => ({ clientX: point.x, clientY: point.y,
  pointerId: 7, button: 0, timeStamp, preventDefault() {}, ...extra });

test("twenty real Stage pointer-down/up swipes cut alternating colors across all lanes and rows", () => {
  const objects = Array.from({ length: 20 }, (_, i) => object(2 + i * .7, i%2, i%8, i%4-1.5, i%3+.65));
  const { stage, rect, hits, setTime } = makeStage(objects);
  const directions = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [index, note] of objects.entries()) {
    const [dx,dy] = directions[note.data.direction];
    const before = project({ x: note.mesh.position.x, y: note.mesh.position.y, z: .2 }, stage.camera, rect);
    const after = project({ x: note.mesh.position.x, y: note.mesh.position.y, z: 1.2 }, stage.camera, rect);
    setTime(note.time-.08);
    stage.pointerDown(event({ x: before.x-dx*65, y: before.y-dy*65 }, 1000+index*500));
    setTime(note.time+.02);
    // No pointermove: the final sample arrives with release, a common fast swipe.
    stage.pointerUp(event({ x: after.x+dx*65, y: after.y+dy*65 }, 1100+index*500));
  }
  assert.equal(hits.length, 20);
  assert.equal(hits.filter(hit=>hit.note.color===1).length, 10, "primary-button input also cuts blue notes");
  assert.equal(stage.hit.size, 20);
  assert.equal(stage.activePointerId, null);
});

test("Stage uses coalesced motion and accumulates small input deltas into a real cut", () => {
  const note = object(5,1,1);
  const { stage, rect, hits, setTime } = makeStage([note]);
  const center = project({x:0,y:1.65,z:1},stage.camera,rect);
  setTime(4.99);stage.pointerDown(event({x:center.x,y:center.y-1},1000));
  setTime(5);stage.pointerMove(event({x:center.x,y:center.y},1010));
  assert.equal(hits.length,0,"one pixel of click noise is not a slash");
  setTime(5.02);stage.pointerMove(event({x:center.x,y:center.y+3},1030,{getCoalescedEvents:()=>[
    event({x:center.x,y:center.y+1},1020),event({x:center.x,y:center.y+2},1025),event({x:center.x,y:center.y+3},1030),
  ]}));
  assert.equal(hits.length,1);
  stage.pointerMove(event({x:center.x,y:center.y+30},1050));
  assert.equal(hits.length,1,"one note scores only once");
});

test("hover, pause, release, and a reset cannot leave an invisible active saber", () => {
  const note = object(5,1,1);
  const { stage, rect, hits, setTime, setPlaying, capture } = makeStage([note]);
  const center = project({x:0,y:1.65,z:1},stage.camera,rect);
  setTime(5);
  stage.pointerMove(event({x:center.x,y:center.y-80},1000));
  stage.pointerMove(event({x:center.x,y:center.y+80},1010));
  assert.equal(hits.length,0,"hovering does not score");
  setPlaying(false);stage.pointerDown(event({x:center.x,y:center.y-80},1020));
  stage.pointerMove(event({x:center.x,y:center.y+80},1030));
  assert.equal(hits.length,0,"paused motion does not score");
  assert.ok(capture.has(7));
  stage.reset();
  assert.equal(stage.dragging,false);assert.equal(capture.size,0);assert.equal(stage.strokeAnchor,null);
  setPlaying(true);stage.pointerMove(event({x:center.x,y:center.y-80},1040));
  assert.equal(hits.length,0,"reset motion cannot teleport an old stroke through a note");
});
