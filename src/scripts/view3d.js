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

  function setPlan({ cont, boxes, colors, keepCamera, pallet = null, offset = 0, vehicle = 'tractor', inner = null }) {
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
      drawVehicle(cont, vehicle);
    }
    pad = pallet ? { x0: 0, y0: 0 } : { x0: frontOf(cont, vehicle), y0: chassisH(cont) };
    // boxes: one instanced mesh per box type, a small gap so neighbours stay visible
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const byK = new Map();
    boxes.forEach((b, i) => { if (!byK.has(b.k)) byK.set(b.k, []); byK.get(b.k).push(i); });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [k, idxs] of byK) {
      // a loaded pallet (cartons on pallets first): its wooden deck and every carton on it, turned with the pallet
      const lay = inner ? inner(k) : null;
      if (lay && lay.boxes && lay.boxes.length) {
        const slab = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xa8865a }), idxs.length);
        const cart = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: colors[k % colors.length] }), idxs.length * lay.boxes.length);
        const sIdx = [], cIdx = []; let j = 0;
        idxs.forEach((bi, si) => {
          const b = boxes[bi]; const turned = Math.abs(b.dx - lay.L) > 1 && Math.abs(b.dx - lay.W) < 1;
          s.set(b.dx - 6, Math.max(1, lay.ph - 2), b.dy - 6); p.set(b.x + b.dx / 2, b.z + lay.ph / 2, b.y + b.dy / 2);
          m.compose(p, q, s); slab.setMatrixAt(si, m); sIdx.push(bi);
          for (const [lx, ly, lz, ldx, ldy, ldz] of lay.boxes) {
            const x = turned ? ly : lx, y = turned ? lay.L - lx - ldx : ly, dx = turned ? ldy : ldx, dy = turned ? ldx : ldy;
            const g = Math.min(12, Math.min(dx, dy, ldz) * 0.04);
            s.set(dx - g, ldz - g, dy - g); p.set(b.x + x + dx / 2, b.z + lay.ph + lz + ldz / 2, b.y + y + dy / 2);
            m.compose(p, q, s); cart.setMatrixAt(j++, m); cIdx.push(bi);
          }
          order[bi] = { mesh: slab, j: si };
        });
        slab.count = idxs.length; cart.count = j;
        group.add(slab); group.add(cart); meshes.push({ mesh: slab, idxs: sIdx }); meshes.push({ mesh: cart, idxs: cIdx });
        continue;
      }
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

  // The vehicle under and in front of the load space, so the closed end and the door end read at a glance:
  // a conventional tractor unit (hood, sloped windscreen, roof fairing, fifth wheel, steer axle and a tandem of
  // dual wheels) with a chassis, landing gear and rear axles under a container or trailer, or, for a box truck,
  // a cab fixed in front of the body. Purely a drawing: proportions follow a typical truck, scaled to the load
  // space, and are not to any vehicle's specification. x runs from the back wall toward the door, so the
  // vehicle's front points to -x.
  const scaleOf = (c) => Math.min(1.05, Math.max(0.72, c.W / 2400));
  const chassisH = (c) => Math.round(Math.min(1400, Math.max(900, c.H * 0.5)));
  const frontOf = (c, kind) => (kind === 'truck' ? 3650 : 4500) * scaleOf(c); // bumper's distance in front of the back wall
  const M = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  function drawVehicle(c, kind) {
    const S = scaleOf(c), g = -chassisH(c), cz = c.W / 2;
    const paint = M(0xe9edf1), trim = M(0x3a434d), dark = M(0x1f252c), chrome = M(0xc3ccd5), glass = M(0x22384f), tire = M(0x111418), rim = M(0x9aa4ae), lamp = M(0xfff4c9, { emissive: 0x6b6040 }), red = M(0xc0392b, { emissive: 0x301010 });
    const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); group.add(o); return o; };
    const box = (mat, x0, x1, y0, y1, z0, z1) => put(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    // a side profile (points as [u forward-to-back, v up], in mm of a full-size truck) extruded across the width
    const prism = (pts, xf, width, mat, bevel = 40, zc = cz) => {
      const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(xf + u * S, g + v * S)));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel * S, bevelSize: bevel * S, bevelSegments: 2, curveSegments: 6 });
      return put(geo, mat, 0, 0, zc - width / 2);
    };
    const R = 520 * S, TW = 280 * S; // tyre radius and width
    const wheel = (x, z, dual) => {
      for (const side of [-1, 1]) {
        const zs = side < 0 ? z.lo : z.hi;
        const offs = dual ? [0, side * (TW + 30 * S)] : [0];
        for (const o of offs) {
          const zz = zs + o;
          put(new THREE.CylinderGeometry(R, R, TW, 28), tire, x, g + R, zz, Math.PI / 2);
          put(new THREE.CylinderGeometry(R * 0.36, R * 0.36, TW + 12, 18), rim, x, g + R, zz + side * 6, Math.PI / 2);
        }
        put(new THREE.CylinderGeometry(R * 0.12, R * 0.12, TW + 40, 10), chrome, x, g + R, zs + side * 30, Math.PI / 2);
      }
    };
    const track = (half) => ({ lo: cz - half, hi: cz + half });
    const cabW = Math.min(2450 * S, c.W * 1.02);

    // ---- under the load space: the container chassis / trailer frame, rear axles, bumper, lights, landing gear
    for (const z of [cz - c.W * 0.22, cz + c.W * 0.22]) box(dark, 0, c.L, -260 * S, -20, z - 70 * S, z + 70 * S);
    box(trim, 0, c.L, -60 * S, 0, 0, c.W); // side rails along the floor edge
    const rearAxles = kind === 'truck' ? [c.L - Math.min(c.L * 0.28, 1700 * S)] : c.L > 9000 ? [c.L - 1500 * S - R, c.L - 1500 * S - R * 3.4] : [c.L - 1200 * S - R];
    for (const x of rearAxles) wheel(x, track(c.W / 2 - TW * 1.3), true);
    for (const x of rearAxles) for (const zs of [-1, 1]) box(dark, x - R * 1.15, x + R * 1.15, g + R * 2 + 40 * S, g + R * 2 + 70 * S, cz + zs * (c.W / 2 - TW * 1.3) - TW * 1.4, cz + zs * (c.W / 2 - TW * 1.3) + TW * 1.4); // mudguard tops
    box(dark, c.L - 120 * S, c.L - 20 * S, g + 450 * S, g + 580 * S, c.W * 0.06, c.W * 0.94); // rear under-ride bar
    for (const z of [c.W * 0.04, c.W * 0.96]) box(red, c.L + 1, c.L + 30, -260 * S, -120 * S, z - 90 * S, z + 90 * S); // tail lights
    if (kind !== 'truck' && c.L > 4000) for (const z of [cz - c.W * 0.3, cz + c.W * 0.3]) { // landing gear, behind the tractor
      const x = 3100 * S;
      box(rim, x - 60 * S, x + 60 * S, g + 60 * S, -260 * S, z - 60 * S, z + 60 * S);
      box(dark, x - 180 * S, x + 180 * S, g, g + 60 * S, z - 140 * S, z + 140 * S);
    }

    // ---- the cab (shared by the tractor and the box truck)
    const xf = -frontOf(c, kind); // front bumper
    // hood and grille
    prism([[150, 820], [150, 1660], [320, 1790], [1560, 1880], [1560, 820]], xf, 1250 * S, paint);
    box(chrome, xf + 105 * S, xf + 160 * S, g + 900 * S, g + 1620 * S, cz - 470 * S, cz + 470 * S);
    for (let k = 0; k < 6; k++) box(dark, xf + 95 * S, xf + 110 * S, g + (960 + k * 110) * S, g + (1000 + k * 110) * S, cz - 430 * S, cz + 430 * S);
    for (const zs of [-1, 1]) box(lamp, xf + 110 * S, xf + 200 * S, g + 1150 * S, g + 1330 * S, cz + zs * 560 * S - 120 * S, cz + zs * 560 * S + 120 * S);
    // bumper
    box(chrome, xf, xf + 220 * S, g + 520 * S, g + 820 * S, cz - cabW / 2, cz + cabW / 2);
    // cab body: back wall, roof, sloped windscreen
    const cabBack = kind === 'truck' ? 3300 : 3350;
    prism([[1520, 950], [1520, 1880], [1960, 2960], [2120, 3060], [cabBack, 3060], [cabBack, 950]], xf, cabW - 80 * S, paint);
    // windscreen: a thin pane along the slope, just outside the body
    {
      const a = [1520, 1960], b2 = [1945, 2905], len = Math.hypot(b2[0] - a[0], b2[1] - a[1]);
      const ang = Math.atan2(b2[1] - a[1], b2[0] - a[0]);
      const pane = put(new THREE.BoxGeometry(len * S * 0.94, 24, cabW - 300 * S), glass, xf + ((a[0] + b2[0]) / 2 - 40 * Math.sin(ang) - 20) * S, g + ((a[1] + b2[1]) / 2 + 40 * Math.cos(ang)) * S, cz);
      pane.rotation.z = ang;
    }
    // side windows and doors
    for (const zs of [-1, 1]) {
      const zFace = cz + zs * ((cabW - 80 * S) / 2 + 40 * S + 6);
      const win = prism([[1760, 2060], [2080, 2830], [2900, 2830], [2900, 2060]], xf, 14, glass, 0, zFace);
      win.position.z = zFace - 7;
      box(trim, xf + 1700 * S, xf + 2960 * S, g + 1000 * S, g + 1012 * S, zFace - 8, zFace + 8); // door bottom line
      box(trim, xf + 2960 * S, xf + 2972 * S, g + 1000 * S, g + 2830 * S, zFace - 8, zFace + 8); // door rear line
      // mirror on an arm
      box(dark, xf + 1700 * S, xf + 1760 * S, g + 2350 * S, g + 2380 * S, zFace, zFace + zs * 260 * S);
      box(dark, xf + 1660 * S, xf + 1760 * S, g + 2100 * S, g + 2600 * S, zFace + zs * 230 * S, zFace + zs * 300 * S);
      // step and fuel tank below the door
      put(new THREE.CylinderGeometry(300 * S, 300 * S, 1100 * S, 20), chrome, xf + 2300 * S, g + 700 * S, cz + zs * (cabW / 2 - 300 * S), 0, 0, Math.PI / 2);
      // front fender over the steer wheel
      put(new THREE.CylinderGeometry(R + 90 * S, R + 90 * S, 380 * S, 24, 1, true, Math.PI / 2, Math.PI), M(0xe9edf1, { side: THREE.DoubleSide }), xf + 1050 * S, g + R, cz + zs * (cabW / 2 - 190 * S), Math.PI / 2);
    }
    wheel(xf + 1050 * S, track(cabW / 2 - 190 * S), false);
    if (kind === 'truck') {
      box(dark, xf + 200 * S, -10, g + 720 * S, g + 960 * S, cz - 450 * S, cz + 450 * S); // frame up to the body
    } else {
      // roof fairing up toward the trailer's front wall, exhaust stacks, frame, fifth wheel and the drive tandem
      prism([[2150, 3060], [cabBack - 100, Math.min(3950, (chassisH(c) + c.H - 120) / S)], [cabBack, Math.min(3950, (chassisH(c) + c.H - 120) / S)], [cabBack, 3060]], xf, cabW - 260 * S, paint);
      for (const zs of [-1, 1]) put(new THREE.CylinderGeometry(70 * S, 70 * S, 3000 * S, 12), chrome, xf + (cabBack + 120) * S, g + 2500 * S, cz + zs * (cabW / 2 - 120 * S));
      const xr = xf + 6900 * S; // end of the tractor frame, under the trailer
      for (const zs of [-1, 1]) box(dark, xf + 200 * S, xr, g + 780 * S, g + 1060 * S, cz + zs * 430 * S - 60 * S, cz + zs * 430 * S + 60 * S);
      const x5 = xf + 5650 * S; // fifth wheel
      put(new THREE.CylinderGeometry(560 * S, 560 * S, 90 * S, 24), dark, x5, -20 - 45 * S, cz);
      for (const x of [xf + 5000 * S, xf + 6350 * S]) wheel(x, track(cabW / 2 - TW * 1.2), true);
      for (const zs of [-1, 1]) box(dark, xr - 40 * S, xr, g + 150 * S, g + 800 * S, cz + zs * (cabW / 2 - TW * 1.2) - TW * 1.1, cz + zs * (cabW / 2 - TW * 1.2) + TW * 1.1); // mud flaps
    }
    // ground outline
    const len = c.L - xf + 600;
    const gl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(len, c.W + 1400 * S)), new THREE.LineBasicMaterial({ color: 0x4d5f73 }));
    gl.rotation.x = -Math.PI / 2; gl.position.set(xf - 300 + len / 2, g, cz); group.add(gl);
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
