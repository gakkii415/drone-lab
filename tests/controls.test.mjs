import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindFlightAction, updateFlightStats} from '../dist/controls.js';

class Button extends EventTarget {
  disabled = false;
  getBoundingClientRect() { return {left: 0, top: 0, right: 100, bottom: 44}; }
  fire(type, properties = {}) {
    const event = new Event(type, {cancelable: true});
    Object.assign(event, {pointerType: 'touch', pointerId: 1, button: 0, clientX: 20, clientY: 20, detail: 1}, properties);
    this.dispatchEvent(event);
  }
}

test('touch activates on release even without a synthetic click, exactly once per tap', () => {
  const button = new Button(); let actions = 0;
  bindFlightAction(button, () => actions++);
  button.fire('pointerdown');
  assert.equal(actions, 0);
  button.fire('pointerup');
  assert.equal(actions, 1);
  // Safari may label the compatibility click as mouse, so dedup cannot use pointerType.
  button.fire('click', {pointerType: 'mouse'});
  assert.equal(actions, 1);
  button.fire('pointerdown'); button.fire('pointerup'); button.fire('click');
  assert.equal(actions, 2);
  button.fire('click', {detail: 0}); // keyboard / accessibility activation
  assert.equal(actions, 3);
});

test('canceled, dragged-out, secondary and disabled touches do not activate', () => {
  const button = new Button(); let actions = 0;
  bindFlightAction(button, () => actions++);
  button.fire('pointerdown'); button.fire('pointercancel'); button.fire('pointerup'); button.fire('click');
  button.fire('pointerdown'); button.fire('pointermove', {clientX: 120}); button.fire('pointerup', {clientX: 120}); button.fire('click');
  button.fire('pointerdown', {clientX: 98}); button.fire('pointerup', {clientX: 102}); button.fire('click');
  button.fire('pointerdown'); button.fire('pointerup', {pointerId: 2});
  assert.equal(actions, 0);
  button.fire('pointercancel'); button.disabled = true;
  button.fire('pointerdown'); button.fire('pointerup'); button.fire('click');
  assert.equal(actions, 0);
});

test('mouse and keyboard retain native click activation', () => {
  const button = new Button(); let actions = 0;
  bindFlightAction(button, () => actions++);
  button.fire('pointerdown', {pointerType: 'mouse'}); button.fire('pointerup', {pointerType: 'mouse'});
  assert.equal(actions, 0);
  button.fire('click', {pointerType: 'mouse'}); button.fire('click', {detail: 0});
  assert.equal(actions, 2);
});

test('idle telemetry does not replace button text; updates preserve unit elements', () => {
  const elements = {};
  for (const [id, value] of [['altitude', '0.0'], ['speed', '0.0'], ['energy', '100']]) {
    elements[id] = {firstChild: {nodeValue: value}, unit: {tagName: 'SMALL'}};
  }
  let writes = 0;
  for (const [id, initial] of [['launch', '離陸'], ['flight-toast', '離陸できます']]) {
    let text = initial;
    elements[id] = {get textContent() {return text;}, set textContent(value) {text = value; writes++;}};
  }
  const root = {querySelector: selector => elements[selector.slice(1)]};
  const idle = {altitude: 0, speed: 0, percent: 100, running: false, status: '離陸できます'};
  for (let i = 0; i < 20; i++) updateFlightStats(root, idle);
  assert.equal(writes, 0);
  const altitudeText = elements.altitude.firstChild, unit = elements.altitude.unit;
  updateFlightStats(root, {...idle, altitude: 2.5, speed: .2, percent: 99, running: true, status: '高度アシスト ON'});
  assert.equal(elements.launch.textContent, '一時停止');
  assert.equal(elements.altitude.firstChild, altitudeText);
  assert.equal(elements.altitude.unit, unit);
  assert.equal(altitudeText.nodeValue, '2.5');
  assert.equal(elements.energy.firstChild.nodeValue, '99');
  updateFlightStats(root, {...idle, altitude: 2.5, status: '一時停止'});
  assert.equal(elements.launch.textContent, '再開');
  updateFlightStats(root, idle);
  assert.equal(elements.launch.textContent, '離陸');
});
