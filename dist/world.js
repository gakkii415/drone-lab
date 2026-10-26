// A deterministic, metre-scaled neighbourhood park. All assets are generated locally.
// Instancing keeps the scenery inexpensive even when the flight camera sees the whole park.
export function createFlightWorld(T) {
  const group = new T.Group();
  group.name = 'flight-world';
  group.visible = false;
  const parts = {};
  for (const name of ['ground', 'paths', 'trees', 'people', 'furniture', 'buildings', 'hills']) {
    parts[name] = new T.Group();
    parts[name].name = name;
    group.add(parts[name]);
  }
  const groundY = -0.09;
  let seed = 840327;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  const between = (a, b) => a + random() * (b - a);
  const material = (color, extra = {}) => new T.MeshStandardMaterial({color, roughness: 0.96, metalness: 0, ...extra});
  const stone = material(0xffffff);
  const bark = material(0xffffff);
  const leaves = material(0xffffff, {vertexColors: true});
  const metal = material(0xffffff, {roughness: 0.72, metalness: 0.3});
  const figureMaterial = material(0xffffff, {roughness: 0.87});
  const cube = new T.BoxGeometry(1, 1, 1);
  const cylinder = new T.CylinderGeometry(0.78, 1, 1, 9);
  const round = new T.SphereGeometry(1, 12, 9);
  const up = new T.Vector3(0, 1, 0);
  const object = new T.Object3D();
  const direction = new T.Vector3();
  const color = new T.Color();
  const batches = [];

  function batch(parent, name, geometry, mat, castShadow = true, receiveShadow = true) {
    const result = {parent, name, geometry, mat, castShadow, receiveShadow, entries: []};
    batches.push(result);
    return result;
  }
  function add(target, x, y, z, sx, sy, sz, tint, rx = 0, ry = 0, rz = 0) {
    object.position.set(x, y, z);
    object.rotation.set(rx, ry, rz);
    object.scale.set(sx, sy, sz);
    object.updateMatrix();
    target.entries.push({matrix: object.matrix.clone(), tint});
  }
  function branch(target, ax, ay, az, bx, by, bz, radius, tint) {
    direction.set(bx - ax, by - ay, bz - az);
    const length = direction.length();
    object.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    object.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length));
    object.scale.set(radius, length, radius);
    object.updateMatrix();
    target.entries.push({matrix: object.matrix.clone(), tint});
  }
  function finishBatches() {
    for (const b of batches) {
      if (!b.entries.length) continue;
      const mesh = new T.InstancedMesh(b.geometry, b.mat, b.entries.length);
      mesh.name = b.name;
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      b.entries.forEach((entry, i) => {
        mesh.setMatrixAt(i, entry.matrix);
        mesh.setColorAt(i, color.set(entry.tint));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      b.parent.add(mesh);
    }
  }

  // Fine grass/gravel grain, combined with broad vertex-colour patches, avoids a flat green board.
  function surfaceTexture(base, spread, size = 128) {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const grain = between(-spread, spread);
      for (let channel = 0; channel < 3; channel++) data[i * 4 + channel] = Math.max(0, Math.min(255, base[channel] + grain));
      data[i * 4 + 3] = 255;
    }
    const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  }
  const grassTexture = surfaceTexture([155, 168, 124], 18);
  grassTexture.repeat.set(54, 54);
  const grassGeometry = new T.PlaneGeometry(240, 240, 80, 80);
  grassGeometry.rotateX(-Math.PI / 2);
  const groundVertices = grassGeometry.attributes.position;
  const grassColors = new Float32Array(groundVertices.count * 3);
  for (let i = 0; i < groundVertices.count; i++) {
    const x = groundVertices.getX(i), z = groundVertices.getZ(i);
    const patch = 0.94 + Math.sin(x * 0.17 + Math.sin(z * 0.13)) * 0.065 + Math.cos(z * 0.3 - x * 0.11) * 0.035;
    color.set(0x81975b).multiplyScalar(patch);
    color.toArray(grassColors, i * 3);
  }
  grassGeometry.setAttribute('color', new T.BufferAttribute(grassColors, 3));
  const grass = new T.Mesh(grassGeometry, material(0xffffff, {map: grassTexture, vertexColors: true}));
  grass.name = '240m-lawn';
  grass.position.y = groundY;
  grass.receiveShadow = true;
  parts.ground.add(grass);

  const gravelTexture = surfaceTexture([212, 204, 184], 15);
  gravelTexture.repeat.set(0.75, 0.75);
  const pathMaterial = material(0xffffff, {map: gravelTexture});
  const edging = batch(parts.paths, 'stone-path-edges', cube, stone, false);
  function path(points, width, name, gapSegment = -1) {
    const vertices = [], uvs = [], indices = [];
    let distance = 0;
    for (let i = 0; i < points.length; i++) {
      const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      const dx = next[0] - previous[0], dz = next[1] - previous[1], length = Math.hypot(dx, dz);
      if (i) distance += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      const nx = -dz / length, nz = dx / length;
      for (const side of [-1, 1]) {
        vertices.push(points[i][0] + nx * width * side / 2, groundY + 0.018, points[i][1] + nz * width * side / 2);
        uvs.push((side + 1) * width / 2, distance);
      }
      if (i && i !== gapSegment) {
        const k = i * 2;
        indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, pathMaterial);
    mesh.name = name;
    mesh.receiveShadow = true;
    parts.paths.add(mesh);
  }
  path([[-85, -12], [75, -12]], 3.5, 'east-west-walk');
  // The cross-path owns the junction, avoiding two coplanar surfaces fighting for depth.
  path([[16, 65], [16, -10.25], [16, -13.75], [16, -85]], 3.1, 'north-south-walk', 2);
  const curvedPoints = [];
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-42, 0, -12), new T.Vector3(-32, 0, -26),
    new T.Vector3(-14, 0, -37), new T.Vector3(16, 0, -41), new T.Vector3(39, 0, -50)
  ]);
  for (let i = 0; i <= 45; i++) { const p = curve.getPoint(i / 45); curvedPoints.push([p.x, p.z]); }
  path(curvedPoints, 2.5, 'garden-walk');
  // Small stone margins give useful height cues without forming raised obstacles.
  for (const z of [-13.82, -10.18]) {
    for (const [left, right] of [[-83, 14.3], [17.7, 73]]) add(edging, (left + right) / 2, groundY + 0.025, z, right - left, 0.055, 0.14, 0xb4b3a2);
  }
  for (const x of [14.38, 17.62]) {
    for (const [back, front] of [[-82, -14], [-10, 62]]) add(edging, x, groundY + 0.025, (back + front) / 2, 0.14, 0.055, front - back, 0xb4b3a2);
  }

  const pad = new T.Mesh(new T.CircleGeometry(1.1, 64), material(0xb8734c));
  pad.name = 'launch-pad';
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = groundY + 0.025;
  pad.receiveShadow = true;
  parts.ground.add(pad);
  const padRing = new T.Mesh(new T.RingGeometry(0.94, 0.985, 64), material(0xe4dcca));
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.y = groundY + 0.028;
  parts.ground.add(padRing);
  const padMark = batch(parts.ground, 'launch-pad-H', cube, stone, false);
  add(padMark, -0.28, groundY + 0.03, 0, 0.1, 0.004, 0.78, 0xe9e4d7);
  add(padMark, 0.28, groundY + 0.03, 0, 0.1, 0.004, 0.78, 0xe9e4d7);
  add(padMark, 0, groundY + 0.03, 0, 0.48, 0.004, 0.1, 0xe9e4d7);

  // Irregular crowns have many overlapping, non-spherical lobes rather than one ball per tree.
  function crownGeometry(variant) {
    const geometry = new T.SphereGeometry(1, 11, 8);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const shape = 1 + 0.095 * Math.sin(x * 9 + z * 6 + variant) * Math.sin(y * 8 - z * 7) + 0.06 * Math.cos(z * 14 + x * 3);
      positions.setXYZ(i, x * shape, y * shape, z * shape);
      const shade = 0.82 + (y + 1) * 0.07 + 0.08 * Math.sin(x * 8 + z * 13 + variant);
      colors.set([shade, shade, shade], i * 3);
    }
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
  const crownGeometries = [0, 1, 2].map(crownGeometry);
  const foliage = crownGeometries.map((geometry, i) => batch(parts.trees, 'leaf-clusters-' + i, geometry, leaves));
  const trunks = batch(parts.trees, 'trunks-and-branches', cylinder, bark);
  const rootBeds = batch(parts.trees, 'root-soil', new T.CircleGeometry(1, 16), stone, false);
  const treePositions = [
    [-8.6, -8.0], [9.3, -8.3], [-17.4, -16.8], [7.2, -19.2], [23.5, -17.8], [-28, -8],
    [-8, -25], [-23, -29], [27, -29], [8, -32], [-34, -21], [-39, -6], [35, -6],
    [-13, 7], [13, 8], [-25, 17], [29, 14], [41, 24], [-43, 30], [5, 29],
    [-40, -43], [-26, -46], [-11, -47], [3, -51], [27, -46], [41, -38], [47, -21],
    [-55, -30], [-60, -9], [57, -8], [59, -38], [-54, -54], [47, -58], [-31, 41],
    [20, 44], [-5, 48], [-61, 24], [61, 29], [-34, -63], [7, -64], [32, -67]
  ];
  const leafColors = [0x536d3f, 0x607648, 0x4c6840, 0x6b7949, 0x57734b];
  treePositions.forEach(([x, z], index) => {
    const height = between(5.5, 9.3), radius = between(1.9, 3.2), leanX = between(-0.3, 0.3), leanZ = between(-0.3, 0.3);
    const crownY = height * 0.69, trunkTop = height * 0.7, tint = leafColors[index % leafColors.length];
    branch(trunks, x, groundY, z, x + leanX, trunkTop, z + leanZ, between(0.16, 0.29), 0x786752);
    add(rootBeds, x, groundY + 0.006, z, 0.65, 0.65, 1, 0x6c684e, -Math.PI / 2);
    for (let limb = 0; limb < 5; limb++) {
      const angle = limb * 2.399 + index * 0.8, reach = radius * between(0.48, 0.85);
      const bx = x + Math.cos(angle) * reach, bz = z + Math.sin(angle) * reach, by = height * between(0.61, 0.79);
      branch(trunks, x + leanX * 0.6, height * between(0.34, 0.49), z + leanZ * 0.6, bx, by, bz, 0.075 + height * 0.006, 0x756550);
      branch(trunks, bx, by, bz, bx + Math.cos(angle + 0.8) * 0.7, by + 0.8, bz + Math.sin(angle + 0.8) * 0.7, 0.05, 0x7b6a56);
    }
    // Offset lower, outer and upper lobes leave glimpses through to the branches.
    for (let clump = 0; clump < 19; clump++) {
      const angle = clump * 2.399 + index, radial = clump < 13 ? radius * between(0.4, 0.88) : radius * between(0.1, 0.5);
      const cx = x + leanX + Math.cos(angle) * radial;
      const cz = z + leanZ + Math.sin(angle) * radial * between(0.75, 1.15);
      const cy = crownY + (clump < 13 ? between(-0.5, 0.65) : between(0.7, 1.55));
      const scale = radius * between(0.36, 0.58);
      add(foliage[(index + clump) % 3], cx, cy, cz, scale * between(0.85, 1.4), scale * between(0.8, 1.3), scale * between(0.8, 1.35), tint, between(-0.4, 0.4), between(0, 6.28), between(-0.3, 0.3));
      if (clump < 12) {
        const fringe = scale * between(0.38, 0.55);
        add(foliage[(index + clump + 1) % 3], cx + Math.cos(angle) * scale * 0.88,
          cy + between(-0.4, 0.45) * scale, cz + Math.sin(angle) * scale * 0.88,
          fringe * between(0.9, 1.2), fringe, fringe * between(0.9, 1.3), tint,
          between(-0.6, 0.6), angle, between(-0.5, 0.5));
      }
    }
  });
  parts.trees.userData.treeCount = treePositions.length;

  const shrubs = batch(parts.trees, 'low-shrubs', crownGeometries[1], leaves);
  const shrubBeds = [[-6.5, -17], [-22, -8.6], [21, -23], [30, -9], [-31, -34], [20, 6], [-17, 15], [-3, -39]];
  for (const [x, z] of shrubBeds) {
    for (let i = 0; i < 9; i++) {
      const dx = between(-2.0, 2.0), dz = between(-0.85, 0.85), scale = between(0.4, 0.72);
      add(shrubs, x + dx, groundY + scale * 0.7, z + dz, scale * 1.15, scale, scale, leafColors[i % 5]);
    }
  }

  // A few tufts at lawn edges add scale at low altitude, while the launch clearing stays open.
  const bladePositions = [], bladeColors = [];
  for (let i = 0; i < 1900; i++) {
    const x = between(-58, 58), z = between(-55, 46);
    if (Math.hypot(x, z) < 6 || Math.abs(z + 12) < 2.2 || Math.abs(x - 16) < 2.0) continue;
    const h = between(0.08, 0.2), w = between(0.025, 0.055), angle = between(0, Math.PI);
    for (let side = 0; side < 2; side++) {
      const dx = Math.cos(angle + side * Math.PI / 2) * w, dz = Math.sin(angle + side * Math.PI / 2) * w;
      bladePositions.push(x - dx, groundY, z - dz, x + dx, groundY, z + dz, x + w * 0.6, groundY + h, z);
      color.set(i % 3 ? 0x7b8d55 : 0x919866);
      for (let vertex = 0; vertex < 3; vertex++) color.toArray(bladeColors, bladeColors.length);
    }
  }
  const bladesGeometry = new T.BufferGeometry();
  bladesGeometry.setAttribute('position', new T.Float32BufferAttribute(bladePositions, 3));
  bladesGeometry.setAttribute('color', new T.Float32BufferAttribute(bladeColors, 3));
  bladesGeometry.computeVertexNormals();
  const blades = new T.Mesh(bladesGeometry, material(0xffffff, {vertexColors: true, side: T.DoubleSide}));
  blades.name = 'grass-tufts';
  blades.receiveShadow = true;
  parts.ground.add(blades);

  const timber = batch(parts.furniture, 'bench-timber', cube, stone);
  const iron = batch(parts.furniture, 'park-metalwork', cube, metal);
  const poles = batch(parts.furniture, 'lamp-posts-and-bins', cylinder, metal);
  const lampGlass = batch(parts.furniture, 'lamp-glass', round, stone, false);
  function bench(x, z, yaw) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const piece = (target, px, py, pz, sx, sy, sz, tint, tilt = 0) => add(target, x + px * co + pz * si, py + groundY, z - px * si + pz * co, sx, sy, sz, tint, tilt, yaw);
    for (let slat = 0; slat < 5; slat++) piece(timber, 0, 0.46, -0.24 + slat * 0.115, 1.95, 0.055, 0.088, slat % 2 ? 0x907358 : 0x9c7c5c);
    for (let slat = 0; slat < 4; slat++) piece(timber, 0, 0.66 + slat * 0.115, 0.26 + slat * 0.018, 1.95, 0.086, 0.046, slat % 2 ? 0x967557 : 0x896d52, -0.15);
    for (const side of [-0.72, 0.72]) {
      piece(iron, side, 0.22, 0, 0.07, 0.44, 0.47, 0x46504b);
      piece(iron, side, 0.69, 0.29, 0.055, 0.64, 0.055, 0x46504b, -0.15);
      piece(iron, side, 0.68, 0, 0.045, 0.045, 0.56, 0x46504b);
      piece(iron, side, 0.58, -0.23, 0.045, 0.22, 0.045, 0x46504b);
    }
  }
  bench(-5.8, -15.6, 0);
  bench(22.4, -15.6, 0);
  bench(-22, -8.5, Math.PI);
  bench(20.4, -28.4, Math.PI / 2);
  bench(-23, -34.1, -0.6);
  const lampPositions = [[-24, -14.9], [-1, -14.9], [27, -14.9], [13.1, -29], [13.1, 10], [-43, -14.9], [13.1, -52]];
  for (const [x, z] of lampPositions) {
    add(poles, x, groundY + 1.95, z, 0.075, 3.9, 0.075, 0x4d5953);
    add(poles, x, groundY + 0.13, z, 0.15, 0.26, 0.15, 0x4d5953);
    add(iron, x + 0.24, groundY + 3.9, z, 0.6, 0.075, 0.08, 0x4d5953);
    add(iron, x + 0.5, groundY + 3.92, z, 0.4, 0.06, 0.3, 0x4d5953);
    add(lampGlass, x + 0.5, groundY + 3.85, z, 0.16, 0.045, 0.12, 0xe7e6d7);
  }
  for (const [x, z] of [[-4.1, -15.8], [24, -15.7], [20.3, -30]]) {
    add(poles, x, groundY + 0.4, z, 0.24, 0.8, 0.24, 0x566354);
    add(poles, x, groundY + 0.82, z, 0.27, 0.08, 0.27, 0x3d4740);
  }
  // A low park boundary separates the distant homes from the flying lawn.
  for (let x = -49; x <= 49; x += 3.5) add(iron, x, groundY + 0.58, -55.5, 0.055, 1.16, 0.055, 0x677064);
  add(iron, 0, groundY + 0.95, -55.5, 98, 0.04, 0.04, 0x677064);
  add(iron, 0, groundY + 0.4, -55.5, 98, 0.04, 0.04, 0x677064);

  // Neighbourhood silhouettes: actual window/roof proportions remain readable from the air.
  const walls = batch(parts.buildings, 'house-walls', cube, stone);
  const windows = batch(parts.buildings, 'window-glass', cube, material(0xffffff, {roughness: 0.35, metalness: 0.12}));
  const trim = batch(parts.buildings, 'window-trim-and-chimneys', cube, stone);
  const roofGeometry = new T.BufferGeometry();
  roofGeometry.setAttribute('position', new T.Float32BufferAttribute([
    -0.5,0,-0.5, 0,1,-0.5, 0.5,0,-0.5, -0.5,0,0.5, 0.5,0,0.5, 0,1,0.5,
    -0.5,0,-0.5, -0.5,0,0.5, 0,1,-0.5, -0.5,0,0.5, 0,1,0.5, 0,1,-0.5,
    0.5,0,-0.5, 0,1,-0.5, 0.5,0,0.5, 0.5,0,0.5, 0,1,-0.5, 0,1,0.5
  ], 3));
  roofGeometry.computeVertexNormals();
  const roofs = batch(parts.buildings, 'pitched-roofs', roofGeometry, stone);
  const homes = [[-57,-77],[-42,-81],[-25,-76],[-7,-83],[11,-79],[32,-82],[52,-77],[-74,-52],[75,-49],[-77,-26],[78,-20],[-72,13],[75,18]];
  const facadeColors = [0xc2bcae, 0xd2ccbc, 0xb5b4aa, 0xc2b3a5, 0xc6c5b9];
  homes.forEach(([x, z], index) => {
    const width = between(7.5, 11.5), depth = between(7, 9), floors = index % 4 === 1 ? 3 : 2;
    const height = floors * 2.8, tint = facadeColors[index % facadeColors.length];
    add(walls, x, groundY + height / 2, z, width, height, depth, tint);
    add(roofs, x, groundY + height, z, width + 0.65, 2.0, depth + 0.65, index % 3 ? 0x727572 : 0x8d7467);
    add(trim, x + width * 0.25, groundY + height + 1.4, z + 1.5, 0.6, 1.5, 0.7, 0xa9a69b);
    add(trim, x, groundY + 0.15, z, width + 0.18, 0.3, depth + 0.18, 0xa5a397);
    const columns = Math.floor(width / 2.4);
    for (let floor = 0; floor < floors; floor++) {
      for (let column = 0; column < columns; column++) {
        const wx = x + (column - (columns - 1) / 2) * 2.35, wy = groundY + 1.55 + floor * 2.8;
        for (const side of [-1, 1]) {
          add(trim, wx, wy, z + side * (depth / 2 + 0.025), 1.18, 1.52, 0.06, 0xe0ddd1);
          add(windows, wx, wy + 0.01, z + side * (depth / 2 + 0.065), 0.94, 1.25, 0.035, (floor + column) % 3 ? 0x667879 : 0x88928a);
          add(trim, wx, wy, z + side * (depth / 2 + 0.09), 0.045, 1.28, 0.04, 0xc4c6bc);
        }
      }
      for (let side = -1; side <= 1; side += 2) {
        for (const dz of [-2, 2]) {
          add(trim, x + side * (width / 2 + 0.025), groundY + 1.55 + floor * 2.8, z + dz, 0.06, 1.52, 1.18, 0xdedbcf);
          add(windows, x + side * (width / 2 + 0.065), groundY + 1.56 + floor * 2.8, z + dz, 0.035, 1.25, 0.94, 0x6d7c7b);
        }
      }
    }
  });
  parts.buildings.userData.buildingCount = homes.length;

  const hillGeometry = new T.SphereGeometry(1, 30, 14);
  const hillPosition = hillGeometry.attributes.position;
  for (let i = 0; i < hillPosition.count; i++) {
    const x = hillPosition.getX(i), y = hillPosition.getY(i), z = hillPosition.getZ(i);
    hillPosition.setY(i, y * (0.91 + 0.09 * Math.sin(x * 6 + z * 3)));
  }
  hillGeometry.computeVertexNormals();
  const hills = batch(parts.hills, 'distant-wooded-hills', hillGeometry, stone, false, false);
  add(hills, -88, -7, -128, 62, 24, 42, 0x7f8f79);
  add(hills, -10, -10, -155, 80, 31, 40, 0x879680);
  add(hills, 85, -9, -133, 65, 30, 47, 0x7d8e78);
  add(hills, -133, -12, -10, 47, 27, 83, 0x89967d);
  add(hills, 135, -11, 12, 48, 28, 88, 0x82927a);
  finishBatches();

  // Shared, animated human instances: normal adult proportions, varied dress, and quiet walking.
  const humanShapes = {
    round: new T.InstancedMesh(round, figureMaterial, 8 * 8),
    limb: new T.InstancedMesh(new T.CylinderGeometry(0.83, 1, 1, 8), figureMaterial, 8 * 8),
    torso: new T.InstancedMesh(new T.CylinderGeometry(1, 0.76, 1, 9), figureMaterial, 8)
  };
  for (const [name, mesh] of Object.entries(humanShapes)) {
    mesh.name = 'people-' + name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // Instances move; their modest total bounds do not need per-frame rebuilding.
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    parts.people.add(mesh);
  }
  const walkers = [
    {x:-10.5,z:-11.7,yaw:-Math.PI/2,walk:1,axis:0,shirt:0x9a6954,pants:0x444e55,skin:0xc39775,hair:0x4b3c31,scale:1.03},
    {x:8.8,z:-12.4,yaw:Math.PI/2,walk:1,axis:0,shirt:0x576c7b,pants:0x52504a,skin:0xd5ad8b,hair:0x6c5747,scale:1.01},
    {x:-18.2,z:-11.8,yaw:-0.7,walk:0,axis:0,shirt:0xaaa18b,pants:0x46566a,skin:0xa87958,hair:0x302f2b,scale:0.96},
    {x:-17.3,z:-12.4,yaw:2.4,walk:0,axis:0,shirt:0x697660,pants:0x3d4545,skin:0xd5a47f,hair:0x484039,scale:1.05},
    {x:16.2,z:-24,yaw:0,walk:1,axis:1,shirt:0xb1a28c,pants:0x555e68,skin:0x9f7153,hair:0x3b332c,scale:1.02},
    {x:15.7,z:-18.0,yaw:Math.PI,walk:0,axis:1,shirt:0x777184,pants:0x4d5655,skin:0xc69874,hair:0x655342,scale:0.98},
    {x:19.5,z:-11.8,yaw:1.4,walk:0,axis:0,shirt:0xc0b9a5,pants:0x716450,skin:0x825b43,hair:0x2e2c2a,scale:1.04},
    {x:-7.4,z:-12.6,yaw:-Math.PI/2,walk:1,axis:0,shirt:0x536d6d,pants:0x6e6a60,skin:0xd3a17a,hair:0x443a31,scale:0.94}
  ];
  parts.people.userData.personCount = walkers.length;
  const counts = {round: 0, limb: 0, torso: 0};
  let personX = 0, personZ = 0, personScale = 1, personCos = 1, personSin = 0;
  function humanPart(kind, x, y, z, sx, sy, sz, tint, tilt = 0) {
    object.position.set(personX + (x * personCos + z * personSin) * personScale, groundY + y * personScale, personZ + (-x * personSin + z * personCos) * personScale);
    object.rotation.set(0, 0, 0);
    object.rotation.y = Math.atan2(personSin, personCos);
    object.rotateX(tilt);
    object.scale.set(sx * personScale, sy * personScale, sz * personScale);
    object.updateMatrix();
    const mesh = humanShapes[kind], index = counts[kind]++;
    mesh.setMatrixAt(index, object.matrix);
    mesh.setColorAt(index, color.set(tint));
  }
  function humanLimb(x, ay, az, by, bz, radius, tint) {
    const dy = by - ay, dz = bz - az;
    humanPart('limb', x, (ay + by) / 2, (az + bz) / 2, radius, Math.hypot(dy, dz), radius, tint, Math.atan2(dz, dy));
  }
  let lastTime = null;
  function update(elapsed) {
    const time = Number.isFinite(elapsed) ? elapsed : 0;
    if (time === lastTime) return;
    lastTime = time;
    counts.round = counts.limb = counts.torso = 0;
    for (let index = 0; index < walkers.length; index++) {
      const p = walkers[index], phase = time * 0.19 + index * 1.7;
      const displacement = p.walk ? Math.sin(phase) * 2.2 : 0;
      const transverse = p.walk ? Math.cos(phase) * 0.22 : 0;
      personX = p.x + (p.axis ? transverse : displacement);
      personZ = p.z + (p.axis ? displacement : transverse);
      const yaw = p.walk ? Math.atan2(-(p.axis ? -Math.sin(phase) * 0.22 : Math.cos(phase) * 2.2), -(p.axis ? Math.cos(phase) * 2.2 : -Math.sin(phase) * 0.22)) : p.yaw;
      personCos = Math.cos(yaw); personSin = Math.sin(yaw); personScale = p.scale;
      const stride = p.walk ? Math.sin(time * 3.6 + index * 1.4) * 0.23 * Math.abs(Math.cos(phase)) : 0;
      const bob = p.walk ? Math.abs(stride) * 0.025 : Math.sin(time * 0.8 + index) * 0.004;
      humanPart('torso', 0, 1.115 + bob, 0, 0.205, 0.48, 0.126, p.shirt);
      humanPart('round', 0, 0.865 + bob, 0, 0.163, 0.12, 0.118, p.pants);
      humanPart('round', 0, 1.415 + bob, 0, 0.061, 0.085, 0.06, p.skin);
      humanPart('round', 0, 1.56 + bob, -0.008, 0.107, 0.135, 0.109, p.skin);
      humanPart('round', 0, 1.625 + bob, 0.016, 0.109, 0.085, 0.101, p.hair);
      for (let side = -1; side <= 1; side += 2) {
        const leg = stride * side, ankleZ = Math.sin(leg) * 0.72, kneeZ = Math.sin(leg) * 0.36 - Math.max(0, -leg) * 0.24;
        const ankleY = 0.1 + Math.max(0, -leg) * 0.13;
        humanLimb(side * 0.093, 0.87 + bob, 0, 0.48 + bob, kneeZ, 0.082, p.pants);
        humanLimb(side * 0.093, 0.48 + bob, kneeZ, ankleY, ankleZ, 0.062, p.pants);
        humanPart('round', side * 0.093, ankleY - 0.037, ankleZ - 0.055, 0.073, 0.057, 0.14, 0x3e423f);
        const armZ = -leg * 0.62, elbowZ = armZ * 0.5 - 0.035;
        humanLimb(side * 0.215, 1.32 + bob, 0, 1.075 + bob, elbowZ, 0.066, p.shirt);
        humanLimb(side * 0.215, 1.075 + bob, elbowZ, 0.86 + bob, armZ - 0.045, 0.041, p.skin);
        humanPart('round', side * 0.215, 0.84 + bob, armZ - 0.045, 0.041, 0.06, 0.037, p.skin);
      }
    }
    for (const name in humanShapes) {
      humanShapes[name].count = counts[name];
      humanShapes[name].instanceMatrix.needsUpdate = true;
      humanShapes[name].instanceColor.needsUpdate = true;
    }
  }
  update(0);
  group.userData = {metres: true, groundY, clearLaunchRadius: 6, treeCount: treePositions.length, personCount: walkers.length, buildingCount: homes.length};
  return {group, update};
}
