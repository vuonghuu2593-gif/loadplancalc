// 3D view of a load plan (three.js). Draws only when something changes.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createView(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x1b2b40);
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1.6, 10, 200000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-0.6, 1, 0.8); scene.add(sun);
  let group = new THREE.Group(); scene.add(group);
  let meshes = [], order = [], size = { L: 1, W: 1, H: 1 }, view = '3d';
  // extra space the drawing takes beyond the load space (the tractor in front of the back wall, the chassis below)
  let pad = { x0: 0, y0: 0 };
  let stepBox = null; // the last box shown by the loading step, outlined
  // hand editing: a highlighted box, green free spots, and taps reported to the page
  const extra = new THREE.Group(); scene.add(extra);
  let ghostMesh = null, ghostList = [], selObj = null, pickCb = null;
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || !pickCb) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const quick = Date.now() - down.t < 600; down = null;
    if (moved > 6 || !quick) return;
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    if (ghostMesh) { const h = ray.intersectObject(ghostMesh, false)[0]; if (h && h.instanceId != null) { pickCb({ kind: 'spot', index: h.instanceId }); return; } }
    const hit = ray.intersectObjects(meshes.map((m) => m.mesh), false)[0];
    if (hit && hit.instanceId != null) { const m = meshes.find((x) => x.mesh === hit.object); pickCb({ kind: 'box', index: m.idxs[hit.instanceId] }); return; }
    pickCb(null);
  });
  function paintExtra() {
    extra.traverse((o) => { if (o !== extra) { o.geometry?.dispose(); o.material?.dispose?.(); } });
    extra.clear(); ghostMesh = null;
    if (selObj) {
      const b = selObj;
      const box = new THREE.Mesh(new THREE.BoxGeometry(b.dx + 16, b.dz + 16, b.dy + 16), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.35, depthWrite: false }));
      box.position.set(b.x + b.dx / 2, b.z + b.dz / 2, b.y + b.dy / 2); extra.add(box);
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.dx + 16, b.dz + 16, b.dy + 16)), new THREE.LineBasicMaterial({ color: 0xffe14d }));
      ed.position.copy(box.position); extra.add(ed);
    }
    if (ghostList.length) {
      ghostMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3fd47a, transparent: true, opacity: 0.32, depthWrite: false }), ghostList.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      ghostList.forEach((b, j) => { const g = Math.min(12, Math.min(b.dx, b.dy, b.dz) * 0.04); s.set(b.dx - g, b.dz - g, b.dy - g); p.set(b.x + b.dx / 2, b.z + b.dz / 2, b.y + b.dy / 2); m.compose(p, q, s); ghostMesh.setMatrixAt(j, m); });
      extra.add(ghostMesh);
      const pts = []; // outline the spots so they read as boxes
      for (const b of ghostList.slice(0, 600)) {
        const x0 = b.x, x1 = b.x + b.dx, y0 = b.z, y1 = b.z + b.dz, z0 = b.y, z1 = b.y + b.dy;
        const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        for (const [a, d] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c[a], ...c[d]);
      }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      extra.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3fd47a })));
    }
    draw();
  }
  const draw = () => renderer.render(scene, camera);
  controls.addEventListener('change', draw);

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); aim(view);
  }
  new ResizeObserver(resize).observe(host);

  function aim(name) {
    view = name;
    const { W } = size;
    // the tractor and chassis only matter in the 3D and side views; top and door views keep the load space framed
    const withVeh = name === '3d' || name === 'side';
    const L = size.L + (withVeh ? pad.x0 : 0), H = size.H + (withVeh ? pad.y0 : 0);
    const c = new THREE.Vector3(size.L - L / 2, size.H - H / 2, W / 2);
    const dir = { '3d': [0.55, 0.62, 0.95], top: [0, 1, 0.0001], side: [0, 0.08, 1], door: [1, 0.12, 0] }[name];
    const v = new THREE.Vector3(...dir).normalize();
    // fit what this view shows (its two visible extents) in both fields of view
    const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const ext = { '3d': [Math.hypot(L, W) * 0.95, H + W * 0.6, Math.max(L, W)], top: [L, W, H], side: [L, H, W], door: [W, H, L] }[name];
    const dist = Math.max(ext[0] / 2 / Math.tan(hf / 2), ext[1] / 2 / Math.tan(vf / 2)) * 1.08 + ext[2] / 2;
    camera.position.copy(c).addScaledVector(v, dist); camera.up.set(0, 1, 0);
    controls.target.copy(c); controls.update(); draw();
  }

  function setPlan({ cont, boxes, colors, keepCamera, pallet = null, offset = 0 }) {
    const same = keepCamera && size.L === cont.L && size.W === cont.W && size.H === cont.H;
    scene.remove(group); group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    group = new THREE.Group(); scene.add(group); meshes = []; order = []; stepBox = null;
    size = { L: cont.L, W: cont.W, H: cont.H };
    // container outline and floor
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cont.L, cont.H, cont.W)), new THREE.LineBasicMaterial({ color: 0xb7c4cd }));
    edges.position.set(cont.L / 2, cont.H / 2, cont.W / 2); group.add(edges);
    if (pallet) { // the pallet as a wooden slab under the load space (offset = overhang per side)
      const ph = Math.max(pallet.H, 20);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pallet.L, ph, pallet.W), new THREE.MeshLambertMaterial({ color: 0xa8865a }));
      slab.position.set(offset + pallet.L / 2, -ph / 2 - 1, offset + pallet.W / 2); group.add(slab);
      const se = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(pallet.L, ph, pallet.W)), new THREE.LineBasicMaterial({ color: 0x5c4630 }));
      se.position.copy(slab.position); group.add(se);
    } else {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(cont.L, cont.W), new THREE.MeshBasicMaterial({ color: 0x2a3a4c, side: THREE.DoubleSide }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(cont.L / 2, -1, cont.W / 2); group.add(floor);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(cont.W, cont.H), new THREE.MeshBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      door.rotation.y = Math.PI / 2; door.position.set(cont.L, cont.H / 2, cont.W / 2); group.add(door);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(cont.W, cont.H)), new THREE.LineBasicMaterial({ color: 0xf08a24 }));
      frame.rotation.y = Math.PI / 2; frame.position.copy(door.position); group.add(frame);
      group.add(label('DOOR', cont.L + 40, cont.H + Math.max(250, cont.H * 0.12), cont.W / 2, cont.W));
      drawVehicle(cont);
    }
    pad = pallet ? { x0: 0, y0: 0 } : { x0: tractorLen(cont) , y0: chassisH(cont) };
    // boxes: one instanced mesh per box type, a small gap so neighbours stay visible
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const byK = new Map();
    boxes.forEach((b, i) => { if (!byK.has(b.k)) byK.set(b.k, []); byK.get(b.k).push(i); });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [k, idxs] of byK) {
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: colors[k % colors.length] }), idxs.length);
      idxs.forEach((bi, j) => {
        const b = boxes[bi]; const g = Math.min(12, Math.min(b.dx, b.dy, b.dz) * 0.04);
        s.set(b.dx - g, b.dz - g, b.dy - g); p.set(b.x + b.dx / 2, b.z + b.dz / 2, b.y + b.dy / 2);
        m.compose(p, q, s); mesh.setMatrixAt(j, m);
        order[bi] = { mesh, j };
      });
      mesh.count = idxs.length; group.add(mesh); meshes.push({ mesh, idxs });
    }
    if (same) draw(); else aim(view);
  }

  // A simple tractor unit in front of the back wall and a chassis under the load space, so the closed end and the
  // door end read at a glance. Purely a drawing: sizes scale with the load space and are not to any vehicle's spec.
  const chassisH = (c) => Math.min(1400, Math.max(600, c.H * 0.5));
  const tractorLen = (c) => Math.min(3400, Math.max(1600, c.W * 1.25)) + 250;
  function drawVehicle(c) {
    const ground = -chassisH(c), wr = Math.min(520, -ground * 0.42), dark = new THREE.MeshLambertMaterial({ color: 0x20262e });
    const add = (geo, mat, x, y, z, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.y = ry; o.rotation.z = rz; group.add(o); return o; };
    // chassis beams under the load space
    for (const z of [c.W * 0.3, c.W * 0.7]) add(new THREE.BoxGeometry(c.L, 120, 140), dark, c.L / 2, -80, z);
    // trailer wheels near the door end, tractor wheels under the cab
    const wheel = new THREE.CylinderGeometry(wr, wr, Math.min(320, c.W * 0.14), 20);
    const tireMat = new THREE.MeshLambertMaterial({ color: 0x111418 });
    const wheelAt = (x) => { for (const z of [c.W * 0.12, c.W * 0.88]) add(wheel, tireMat, x, ground + wr, z, 0, 0).rotation.x = Math.PI / 2; };
    wheelAt(c.L - wr * 1.6); if (c.L > 4000) wheelAt(c.L - wr * 3.9);
    const tl = tractorLen(c) - 250, cabH = Math.min(3200, Math.max(1800, c.H * 1.15)), cabW = c.W * 0.96;
    const x0 = -250 - tl; // tractor from x0 to -250 (a gap before the back wall)
    const body = new THREE.MeshLambertMaterial({ color: 0x8796a6 }); // neutral grey: never one of the box colours
    // frame and fifth-wheel area, then the cab at the far end
    add(new THREE.BoxGeometry(tl, 160, cabW * 0.7), dark, x0 + tl / 2, ground + wr * 1.15, c.W / 2);
    const cabL = tl * 0.62;
    add(new THREE.BoxGeometry(cabL, cabH, cabW), body, x0 + cabL / 2, ground + wr * 1.3 + cabH / 2, c.W / 2);
    // windscreen on the outer face (facing away from the load), so the cab clearly points forward
    const glass = new THREE.MeshLambertMaterial({ color: 0x1b2b40 });
    add(new THREE.BoxGeometry(20, cabH * 0.35, cabW * 0.82), glass, x0 - 8, ground + wr * 1.3 + cabH * 0.68, c.W / 2);
    wheelAt(x0 + cabL * 0.45); wheelAt(x0 + tl - wr * 1.4);
    // ground line
    const gl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(c.L + tl + 900, c.W + 600)), new THREE.LineBasicMaterial({ color: 0x4d5f73 }));
    gl.rotation.x = -Math.PI / 2; gl.position.set((x0 + c.L) / 2, ground, c.W / 2); group.add(gl);
  }
  // a text label that always faces the camera
  function label(text, x, y, z, width) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d'); g.fillStyle = '#f08a24'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    const w = Math.max(1400, width * 1.1); sp.scale.set(w, w / 4, 1); sp.position.set(x, y, z); return sp;
  }

  // show only the first n boxes in loading order
  function setStep(n) {
    for (const { mesh, idxs } of meshes) {
      // instances are stored in loading order inside each mesh, so a count cut-off works
      let c = 0; for (const bi of idxs) if (bi < n) c++;
      mesh.count = c;
    }
    draw();
  }
  // outline one box (the last one the loading step shows), or none
  function setStepBox(b) {
    if (stepBox) { group.remove(stepBox); stepBox.geometry.dispose(); stepBox.material.dispose(); stepBox = null; }
    if (b) {
      stepBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.dx + 10, b.dz + 10, b.dy + 10)), new THREE.LineBasicMaterial({ color: 0xffffff }));
      stepBox.position.set(b.x + b.dx / 2, b.z + b.dz / 2, b.y + b.dy / 2); group.add(stepBox);
    }
    draw();
  }

  // Pictures for the loading list: for each entry { n, x0, x1 } the plan with its first n boxes, seen from the
  // door side in the 3D view, with the section x0..x1 framed in orange (no frame when x0 is null). Drawn at a
  // fixed size on the same canvas, then the view is put back exactly as it was. Returns JPEG data URLs.
  function shots(list, w = 640, h = 400) {
    const keep = { pos: camera.position.clone(), tgt: controls.target.clone(), view, pr: renderer.getPixelRatio(), counts: meshes.map((m) => m.mesh.count), sb: stepBox ? stepBox.visible : null, ex: extra.visible };
    renderer.setPixelRatio(1); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    aim('3d'); extra.visible = false; if (stepBox) stepBox.visible = false;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xf08a24 }));
    group.add(frame);
    const out = list.map(({ n, x0, x1 }) => {
      for (const { mesh, idxs } of meshes) { let c = 0; for (const bi of idxs) if (bi < n) c++; mesh.count = c; }
      frame.visible = x0 != null;
      if (frame.visible) { frame.scale.set(Math.max(1, x1 - x0), size.H + 20, size.W + 20); frame.position.set((x0 + x1) / 2, size.H / 2, size.W / 2); }
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/jpeg', 0.82);
    });
    group.remove(frame); frame.geometry.dispose(); frame.material.dispose();
    meshes.forEach((m, i) => { m.mesh.count = keep.counts[i]; });
    if (stepBox && keep.sb != null) stepBox.visible = keep.sb;
    extra.visible = keep.ex;
    renderer.setPixelRatio(keep.pr);
    const cw = host.clientWidth || w, ch = host.clientHeight || h;
    renderer.setSize(cw, ch, false); camera.aspect = cw / ch; camera.updateProjectionMatrix();
    view = keep.view; camera.position.copy(keep.pos); controls.target.copy(keep.tgt); controls.update(); draw();
    return out;
  }

  return {
    setPlan, setStep, setStepBox, aim, draw, shots, snapshot: () => renderer.domElement.toDataURL('image/png'),
    onPick: (fn) => { pickCb = fn; },
    setSelected: (b) => { selObj = b; paintExtra(); },
    setSpots: (list) => { ghostList = list || []; paintExtra(); },
  };
}
