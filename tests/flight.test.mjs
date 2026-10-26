import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from '../dist/vendor/three.module.min.js';
import { calculate, defaults, parts, presets } from '../dist/model.js';
import { applyFlightInput } from '../dist/controls.js';
import { createFlightWorld } from '../dist/world.js';

// Run the production scene and physics with real Three.js geometry and math.
// Only the browser rendering/scheduling boundary is replaced for Node.
const sceneSource = readFileSync(new URL('../dist/scene.js', import.meta.url), 'utf8');
assert.match(sceneSource, /import \* as T from ['"]\.\/vendor\/three\.module\.min\.js['"]/);
const loadScene = new Function(
  'T', 'createFlightWorld', 'devicePixelRatio', 'performance', 'requestAnimationFrame', 'ResizeObserver',
  sceneSource
    .replace(/import \* as T from ['"]\.\/vendor\/three\.module\.min\.js['"];?/, '')
    .replace(/import \{createFlightWorld\} from ['"]\.\/world\.js\?v=\d+['"];?/, '')
    .replace('export function createScene', 'function createScene') + '\nreturn createScene;',
);

function simulator(config = defaults, initialViewport = { width: 800, height: 600 }) {
  let now = 0;
  let pendingFrames = [];
  let renderedScene, renderedCamera, resizeCallback;
  const viewport = { ...initialViewport };
  const snapshots = [];
  class Renderer {
    shadowMap = {};
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
    render(scene, camera) { renderedScene = scene; renderedCamera = camera; }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; resizeCallback = callback; }
    observe() { this.callback(); }
  }
  const canvas = {
    addEventListener() {},
    parentElement: { getBoundingClientRect: () => viewport },
  };
  const createScene = loadScene(
    { ...THREE, WebGLRenderer: Renderer },
    createFlightWorld,
    1,
    { now: () => now },
    callback => pendingFrames.push(callback),
    ResizeObserver,
  );
  const scene = createScene(canvas, stats => snapshots.push(stats));
  const metrics = calculate(config);
  scene.setMode('fly');
  scene.setMetrics(metrics);
  scene.setConfiguration(config);
  scene.update(new Set(), '', metrics.propSize);
  return {
    scene, metrics, snapshots,
    resize(width, height) { Object.assign(viewport, { width, height }); resizeCallback(); },
    projectedAircraft() {
      assert.ok(renderedScene, 'render at least one frame before measuring');
      renderedScene.updateMatrixWorld(true);
      renderedCamera.updateMatrixWorld(true);
      const drone = renderedScene.getObjectByName('drone');
      const point = new THREE.Vector3();
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, nearest: Infinity, farthest: -Infinity };
      drone.traverseVisible(object => {
        if (!object.isMesh) return;
        const positions = object.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(renderedCamera);
          const x = (point.x + 1) * viewport.width / 2;
          const y = (1 - point.y) * viewport.height / 2;
          bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
          bounds.nearest = Math.min(bounds.nearest, point.z); bounds.farthest = Math.max(bounds.farthest, point.z);
        }
      });
      return { ...bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top,
        centerX: (bounds.left + bounds.right) / 2 / viewport.width,
        centerY: (bounds.top + bounds.bottom) / 2 / viewport.height,
        scale: drone.scale.toArray(),
        parkVisible: renderedScene.getObjectByName('flight-world').visible,
      };
    },
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

test('park scenery is finite, metre-scaled and batched for mobile rendering', () => {
  const world = createFlightWorld(THREE);
  assert.equal(world.group.visible, false, 'scenery starts hidden in assembly mode');
  assert.ok(world.group.userData.treeCount >= 20);
  assert.ok(world.group.userData.personCount >= 6);
  assert.equal(world.group.userData.metres, true);
  let meshes = 0, triangles = 0;
  world.group.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  assert.ok(meshes < 180, 'scenery must use instancing rather than hundreds of draw calls');
  assert.ok(triangles < 350000, 'scenery must remain within the mobile geometry budget');
  world.group.getObjectByName('paths').traverse(object => {
    if (!object.isMesh || object.isInstancedMesh) return;
    const normals = object.geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > .9, 'paths must face up');
  });
  for (const time of [0, 1, 30, 300]) {
    world.update(time);
    world.group.getObjectByName('people').traverse(object => {
      if (!object.isInstancedMesh) return;
      assert.ok(object.count <= object.instanceMatrix.count);
      assert.ok(Array.from(object.instanceMatrix.array).every(Number.isFinite));
    });
  }
});

test('mobile flight camera keeps the actual airframe readable and centred throughout flight', () => {
  const viewports = [125, 150, 180, 220, 270].map(height => ({ width: 369, height }));
  viewports.push({ width: 361, height: 152.390625 }, { width: 361, height: 223 });
  for (const { width, height } of viewports) {
    const sim = simulator(defaults, { width, height });
    function visible(label) {
      const p = sim.projectedAircraft();
      const context = `${label} at ${width}×${height}: ${JSON.stringify(p)}`;
      assert.ok(p.width >= 72 && p.width < 150, `aircraft needs a readable pixel span; ${context}`);
      assert.ok(p.centerX > .46 && p.centerX < .54, `aircraft stays horizontally centred; ${context}`);
      assert.ok(p.centerY > .48 && p.centerY < .62, `aircraft stays near the vertical centre; ${context}`);
      assert.ok(p.left > 10 && p.right < width - 10 && p.top > 10 && p.bottom < height - 10, `the complete airframe stays inside the canvas; ${context}`);
      assert.ok(p.nearest > -1 && p.farthest < 1, `the airframe stays inside camera clipping planes; ${context}`);
      assert.deepEqual(p.scale, [.24, .24, .24], 'visibility must not enlarge the drone relative to people and trees');
      assert.equal(p.parkVisible, true);
    }
    function sample(seconds, label) {
      for (let i = 0; i < Math.round(seconds * 5); i++) { sim.advance(.2); visible(label); }
    }
    sim.advance(1 / 60);
    visible('first ground frame');
    sim.scene.start(); sample(6, 'launch and hover');
    applyFlightInput(sim.scene, 'ry', 1); sample(2, 'forward acceleration');
    applyFlightInput(sim.scene, 'rx', 1); sample(2, 'combined forward and lateral control');
    applyFlightInput(sim.scene, 'lx', 1); sample(2, 'yaw while moving');
    applyFlightInput(sim.scene, 'ly', 1); sample(1, 'combined climb and turn');
    sim.scene.pause(); sample(.4, 'pause');
    sim.scene.reset(); sim.advance(1 / 60); visible('reset first frame');
    sim.scene.setMode('build'); sim.advance(1 / 60);
    sim.scene.setMode('fly'); sim.advance(1 / 60); visible('return to flight first frame');
  }
});

test('flight camera refits immediately when a mobile canvas changes height', () => {
  const sim = simulator(defaults, { width: 369, height: 180 });
  sim.scene.start(); sim.advance(5);
  sim.scene.pause();
  const before = sim.projectedAircraft();
  sim.resize(369, 270); sim.advance(1 / 60);
  const taller = sim.projectedAircraft();
  assert.ok(Math.abs(taller.width - before.width) < 15, 'increasing canvas height must not make the airframe disproportionately large');
  assert.ok(taller.centerY > .48 && taller.centerY < .62);
  sim.resize(369, 180); sim.advance(1 / 60);
  const shorter = sim.projectedAircraft();
  assert.ok(shorter.width >= 72 && shorter.centerY < .62, 'a short canvas must retain a centred and readable aircraft immediately');
  sim.resize(0, 0); sim.resize(369, 180); sim.advance(1 / 60);
  assert.ok(Number.isFinite(sim.projectedAircraft().width), 'a temporarily hidden canvas must not corrupt the camera');
});
