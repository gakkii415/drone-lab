import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from '../dist/vendor/three.module.min.js';
import { calculate, defaults, parts, presets } from '../dist/model.js';
import { applyFlightInput } from '../dist/controls.js';

// Run the production scene and physics with real Three.js geometry and math.
// Only the browser rendering/scheduling boundary is replaced for Node.
const sceneSource = readFileSync(new URL('../dist/scene.js', import.meta.url), 'utf8');
assert.match(sceneSource, /import \* as T from ['"]\.\/vendor\/three\.module\.min\.js['"]/);
const loadScene = new Function(
  'T', 'devicePixelRatio', 'performance', 'requestAnimationFrame', 'ResizeObserver',
  sceneSource
    .replace(/import \* as T from ['"]\.\/vendor\/three\.module\.min\.js['"];?/, '')
    .replace('export function createScene', 'function createScene') + '\nreturn createScene;',
);

function simulator(config = defaults) {
  let now = 0;
  let pendingFrames = [];
  const snapshots = [];
  class Renderer {
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    render() {}
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  }
  const canvas = {
    addEventListener() {},
    parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
  };
  const createScene = loadScene(
    { ...THREE, WebGLRenderer: Renderer },
    1,
    { now: () => now },
    callback => pendingFrames.push(callback),
    ResizeObserver,
  );
  const scene = createScene(canvas, stats => snapshots.push(stats));
  const metrics = calculate(config);
  scene.setMode('fly');
  scene.setMetrics(metrics);
  return {
    scene, metrics, snapshots,
    advance(seconds) {
      for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
        now += 1000 / 60;
        const callbacks = pendingFrames;
        pendingFrames = [];
        assert.equal(callbacks.length, 1, 'the animation loop must keep running');
        callbacks[0](now);
      }
    },
  };
}

test('all 81 configurations calculate finite values and all three presets are valid', () => {
  let combinations = 0;
  for (let frame = 0; frame < parts.frame.length; frame++) {
    for (let motor = 0; motor < parts.motor.length; motor++) {
      for (let prop = 0; prop < parts.prop.length; prop++) {
        for (let battery = 0; battery < parts.battery.length; battery++) {
          const config = { frame, motor, prop, battery };
          const metrics = calculate(config);
          for (const [name, value] of Object.entries(metrics)) {
            if (typeof value === 'number') {
              assert.ok(Number.isFinite(value), `${JSON.stringify(config)}: ${name} must be finite`);
              assert.ok(value > 0, `${JSON.stringify(config)}: ${name} must be positive`);
            }
          }
          for (const throttle of [0, 0.5, 1]) {
            assert.ok(Number.isFinite(metrics.power(throttle)));
            assert.ok(metrics.power(throttle) > 0);
          }
          assert.ok(Array.isArray(metrics.errors));
          combinations++;
        }
      }
    }
  }
  assert.equal(combinations, 81);
  assert.equal(presets.length, 3);
  for (const preset of presets) {
    assert.deepEqual(calculate(preset.config).errors, [], preset.name);
  }
});

test('stock launch climbs visibly and settles at about 2.5 m without stick input', () => {
  const { scene, metrics, advance, snapshots } = simulator();
  assert.equal(scene.start(), true);
  advance(1);
  assert.ok(scene.flight.position.y > 0.5, 'launch must lift the aircraft visibly');
  advance(7);
  assert.ok(Math.abs(scene.flight.position.y - 2.5) < 0.15);
  assert.ok(Math.abs(scene.flight.velocity.y) < 0.1);
  assert.equal(scene.flight.running, true);
  assert.ok(scene.flight.energy < metrics.energy, 'flight consumes energy');
  assert.ok(scene.flight.energy > 0);
  assert.ok(snapshots.at(-1).altitude > 2.3, 'telemetry must report the airborne state');
});

test('pause freezes flight and clears input; resume completes the climb', () => {
  const { scene, advance } = simulator();
  scene.start();
  advance(1);
  scene.input.rx = 1;
  scene.pause();
  const position = scene.flight.position.toArray();
  const velocity = scene.flight.velocity.toArray();
  const energy = scene.flight.energy;
  const elapsed = scene.flight.elapsed;
  advance(2);
  assert.equal(scene.flight.running, false);
  assert.deepEqual(scene.flight.position.toArray(), position);
  assert.deepEqual(scene.flight.velocity.toArray(), velocity);
  assert.equal(scene.flight.energy, energy);
  assert.equal(scene.flight.elapsed, elapsed);
  assert.ok(Object.values(scene.input).every(value => value === 0));
  assert.equal(scene.start(), true);
  advance(7);
  assert.equal(scene.flight.running, true);
  assert.ok(Math.abs(scene.flight.position.y - 2.5) < 0.15);
});

test('manual ascent and horizontal input move an airborne aircraft', () => {
  const { scene, advance } = simulator();
  scene.start();
  advance(6);
  const hoverAltitude = scene.flight.position.y;
  scene.input.ly = 1;
  advance(2);
  assert.ok(scene.flight.position.y > hoverAltitude + 2);
  scene.input.ly = 0;
  scene.input.rx = 1;
  advance(2);
  assert.ok(Math.hypot(scene.flight.position.x, scene.flight.position.z) > 1);
});

test('automatic landing stops at the ground and reset restores launch readiness', () => {
  const { scene, metrics, advance } = simulator();
  scene.start();
  advance(6);
  scene.land();
  advance(8);
  assert.equal(scene.flight.position.y, 0);
  assert.equal(scene.flight.running, false);
  assert.deepEqual(scene.flight.velocity.toArray(), [0, 0, 0]);
  assert.ok(scene.flight.energy < metrics.energy);
  scene.input.ly = 1;
  scene.reset();
  assert.deepEqual(scene.flight.position.toArray(), [0, 0, 0]);
  assert.deepEqual(scene.flight.velocity.toArray(), [0, 0, 0]);
  assert.equal(scene.flight.energy, metrics.energy);
  assert.equal(scene.flight.elapsed, 0);
  assert.equal(scene.flight.running, false);
  assert.ok(Object.values(scene.input).every(value => value === 0));
  assert.equal(scene.start(), true, 'reset aircraft must be able to launch again');
  advance(4);
  assert.ok(scene.flight.position.y > 2.3);
});

test('an incompatible configuration cannot launch', () => {
  const { scene, metrics, advance } = simulator({ ...defaults, frame: 0, prop: 2 });
  assert.ok(metrics.errors.length > 0);
  assert.equal(scene.start(), false);
  scene.input.ly = 1;
  advance(2);
  assert.equal(scene.flight.position.y, 0);
  assert.equal(scene.flight.running, false);
  assert.equal(scene.flight.energy, metrics.energy);
});

test('upward control input launches the real scene from the ground', () => {
  const { scene, advance } = simulator();
  applyFlightInput(scene, 'ly', 1);
  assert.equal(scene.flight.running, true);
  assert.equal(scene.input.ly, 1);
  advance(2);
  assert.ok(scene.flight.position.y > 2, 'holding up must cause visible ascent');
});

test('horizontal, downward and neutral control input do not launch a grounded aircraft', () => {
  const { scene, advance } = simulator();
  for (const [axis, value] of [['lx', 1], ['rx', -1], ['ry', 1], ['ly', -1], ['ly', 0], ['ly', 0.08]]) {
    applyFlightInput(scene, axis, value);
    advance(0.5);
    assert.equal(scene.flight.running, false, `${axis}=${value} must not launch`);
    assert.equal(scene.flight.position.y, 0);
  }
});

test('upward control input does not resume an aircraft paused in the air', () => {
  const { scene, advance } = simulator();
  scene.start();
  advance(4);
  scene.pause();
  const altitude = scene.flight.position.y;
  applyFlightInput(scene, 'ly', 1);
  advance(2);
  assert.equal(scene.flight.running, false);
  assert.equal(scene.flight.position.y, altitude);
});

test('upward control input still respects invalid aircraft configuration', () => {
  const { scene, metrics, advance } = simulator({ ...defaults, frame: 0, prop: 2 });
  assert.ok(metrics.errors.length > 0);
  applyFlightInput(scene, 'ly', 1);
  advance(2);
  assert.equal(scene.flight.running, false);
  assert.equal(scene.flight.position.y, 0);
  assert.equal(scene.flight.energy, metrics.energy);
});

test('launch, pause, land and reset publish telemetry before the next animation frame', () => {
  const { scene, snapshots } = simulator();
  let count = snapshots.length;
  scene.start();
  assert.equal(snapshots.length, ++count);
  assert.equal(snapshots.at(-1).running, true);
  assert.equal(snapshots.at(-1).status, '自動離陸中');
  assert.ok(snapshots.at(-1).altitude > 0);

  scene.pause();
  assert.equal(snapshots.length, ++count);
  assert.equal(snapshots.at(-1).running, false);
  assert.equal(snapshots.at(-1).status, '一時停止');

  scene.land();
  assert.equal(snapshots.length, ++count);
  assert.equal(snapshots.at(-1).running, true);
  assert.equal(snapshots.at(-1).status, '着陸中');

  scene.reset();
  assert.equal(snapshots.length, ++count);
  assert.equal(snapshots.at(-1).running, false);
  assert.equal(snapshots.at(-1).altitude, 0);
  assert.equal(snapshots.at(-1).percent, 100);
  assert.equal(snapshots.at(-1).status, '離陸できます');
});
