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
    const { L, W, H } = size;
    const c = new THREE.Vector3(L / 2, H / 2, W / 2);
    const dir = { '3d': [0.55, 0.62, 0.95], top: [0, 1, 0.0001], side: [0, 0.08, 1], door: [1, 0.12, 0] }[name];
    const v = new THREE.Vector3(...dir).normalize();
    // fit what this view shows (its two visible extents) in both fields of view
    const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const ext = { '3d': [Math.hypot(L, W) * 0.95, H + W * 0.6, Math.max(L, W)], top: [L, W, H], side: [L, H, W], door: [W, H, L] }[name];
    const dist = Math.max(ext[0] / 2 / Math.tan(hf / 2), ext[1] / 2 / Math.tan(vf / 2)) * 1.08 + ext[2] / 2;
    camera.position.copy(c).addScaledVector(v, dist); camera.up.set(0, 1, 0);
    controls.target.copy(c); controls.update(); draw();
  }

  function setPlan({ cont, boxes, colors, keepCamera }) {
    const same = keepCamera && size.L === cont.L && size.W === cont.W && size.H === cont.H;
    scene.remove(group); group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    group = new THREE.Group(); scene.add(group); meshes = []; order = [];
    size = { L: cont.L, W: cont.W, H: cont.H };
    // container outline and floor
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(cont.L, cont.H, cont.W)), new THREE.LineBasicMaterial({ color: 0xb7c4cd }));
    edges.position.set(cont.L / 2, cont.H / 2, cont.W / 2); group.add(edges);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(cont.L, cont.W), new THREE.MeshBasicMaterial({ color: 0x2a3a4c, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cont.L / 2, -1, cont.W / 2); group.add(floor);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(cont.W, cont.H), new THREE.MeshBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    door.rotation.y = Math.PI / 2; door.position.set(cont.L, cont.H / 2, cont.W / 2); group.add(door);
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

  // show only the first n boxes in loading order
  function setStep(n) {
    for (const { mesh, idxs } of meshes) {
      // instances are stored in loading order inside each mesh, so a count cut-off works
      let c = 0; for (const bi of idxs) if (bi < n) c++;
      mesh.count = c;
    }
    draw();
  }

  return {
    setPlan, setStep, aim, draw, snapshot: () => renderer.domElement.toDataURL('image/png'),
    onPick: (fn) => { pickCb = fn; },
    setSelected: (b) => { selObj = b; paintExtra(); },
    setSpots: (list) => { ghostList = list || []; paintExtra(); },
  };
}
