import test from "node:test";
import assert from "node:assert/strict";
import { crossedAttack } from "../src/preview.js";
test("autoplay cuts a block on its attack and never bursts already-passed notes after a seek", () => {
  const attack = 10.25;
  assert.equal(crossedAttack(10.23, 10.247, attack), false);
  assert.equal(crossedAttack(10.247, 10.263, attack), true);
  assert.equal(crossedAttack(10.263, 10.28, attack), false);
  assert.equal(crossedAttack(0, 30, attack), false);
  assert.equal(crossedAttack(undefined, 10.26, attack), false);
});
