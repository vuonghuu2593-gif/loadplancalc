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

  function setPlan({ cont, boxes, colors }) {
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
    aim(view);
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

  return { setPlan, setStep, aim, draw, snapshot: () => renderer.domElement.toDataURL('image/png') };
}
