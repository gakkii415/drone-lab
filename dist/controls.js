// Keep unchanged labels stable while a finger is on a control.
export function updateFlightStats(root, stats) {
  for (const [id, value] of [
    ['altitude', stats.altitude.toFixed(1)],
    ['speed', stats.speed.toFixed(1)],
    ['energy', String(Math.round(stats.percent))],
  ]) {
    const node = root.querySelector('#' + id)?.firstChild;
    if (node && node.nodeValue !== value) node.nodeValue = value;
  }
  for (const [id, value] of [
    ['flight-toast', stats.status],
    ['launch', stats.running ? '一時停止' : stats.altitude > 0 ? '再開' : '離陸'],
  ]) {
    const element = root.querySelector('#' + id);
    if (element && element.textContent !== value) element.textContent = value;
  }
}

// Handle touch/pen activation directly; ignore the subsequent synthetic click.
// Mouse and keyboard activation retain the native button click behavior.
export function bindFlightAction(button, action) {
  let pointer = null, lastTouch = -Infinity;
  button.addEventListener('pointerdown', event => {
    if (button.disabled || event.pointerType === 'mouse' || event.button !== 0 || pointer) return;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
  });
  button.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) pointer = null;
  });
  button.addEventListener('pointercancel', event => {
    if (event.pointerType !== 'mouse') lastTouch = performance.now();
    pointer = null;
  });
  button.addEventListener('pointerup', event => {
    // A rejected touch must not be revived by its compatibility click either.
    if (event.pointerType !== 'mouse') lastTouch = performance.now();
    if (pointer?.id !== event.pointerId) return;
    const start = pointer;
    pointer = null;
    const rect = button.getBoundingClientRect();
    if (button.disabled || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
        event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.preventDefault();
    action();
  });
  button.addEventListener('click', event => {
    if (button.disabled) return;
    if (event.detail !== 0 && performance.now() - lastTouch < 700) {
      event.preventDefault();
      return;
    }
    action();
  });
}

export function applyFlightInput(scene, axis, value) {
  if (!scene) return;
  if (axis === 'ly' && value > .08 && !scene.flight.running && scene.flight.position.y === 0) scene.start();
  scene.input[axis] = value;
}
