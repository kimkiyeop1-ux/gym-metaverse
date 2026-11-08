import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

// 3단계 고정·이동 기구: 배구 고정 지주·네트, 배구 이동식 지주(자동 네트), 추크볼 골대
//
// 충돌 그룹: 네트는 공(그룹 1)하고만 부딪힌다. 아바타(그룹 2)는 네트 아래로 지나갈 수 있음.
export const GROUP = { DEFAULT: 1, PERSON: 2, NET: 4 };

const lambert = (color) => new THREE.MeshLambertMaterial({ color });

// 격자 그물 텍스처 (공용)
let netTex = null;
function netTexture() {
  if (netTex) return netTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(25,25,25,0.95)';
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  netTex = new THREE.CanvasTexture(c);
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  return netTex;
}

function netMaterial(repeatX, repeatY) {
  const t = netTexture().clone();
  t.needsUpdate = true;
  t.repeat.set(repeatX, repeatY);
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false });
}

// 배구 네트 한 장 (메시). 폭 w, 높이 1m, 위·아래 흰 띠
function makeVolleyNet(w) {
  const g = new THREE.Group();
  const net = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), netMaterial(w * 5, 5));
  const top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 0.015), lambert('#ffffff'));
  top.position.y = 0.465;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.015), lambert('#ffffff'));
  bottom.position.y = -0.475;
  g.add(net, top, bottom);
  g.userData.setWidth = (width) => {
    net.scale.x = width;
    top.scale.x = width;
    bottom.scale.x = width;
    net.material.map.repeat.x = width * 5;
  };
  g.userData.setWidth(w);
  return g;
}

// 회전하지 않게 매 계산마다 똑바로 세우기 (fixedRotation 은 밀리지 않는 문제가 있음)
function keepUpright(world, body) {
  world.addEventListener('preStep', () => {
    body.quaternion.set(0, 0, 0, 1);
    body.angularVelocity.set(0, 0, 0);
  });
}

// ------------------------------------------------------------
// 배구 고정 지주 + 네트 (가운데 배구 코트, x = 0 에 z 방향으로)
// ------------------------------------------------------------
export class VolleyballFixedNet {
  constructor(scene, physics) {
    const H = CONFIG.equipment.volleyNetHeight;
    const postZ = 5.5;
    const postH = H + 0.25;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, postH, 8), lambert('#d9dde2'));
      post.position.set(0, postH / 2, s * postZ);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 10), lambert('#2a5bd7'));
      pad.position.set(0, 0.8, s * postZ);
      scene.add(post, pad);
      physics.addStaticBox(0, postH / 2, s * postZ, 0.13, postH / 2, 0.13);
    }
    const w = postZ * 2 - 0.2;
    const net = makeVolleyNet(w);
    net.rotation.y = Math.PI / 2;
    net.position.set(0, H - 0.5, 0);
    scene.add(net);

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: physics.materials.net });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.02, 0.5, w / 2)));
    body.position.set(0, H - 0.5, 0);
    body.collisionFilterGroup = GROUP.NET;
    body.collisionFilterMask = GROUP.DEFAULT;
    physics.world.addBody(body);
  }
}

// ------------------------------------------------------------
// 배구 이동식 지주 2개: 각각 밀 수 있음. 거리가 5~11m 가 되면 네트가 자동으로 걸림
// ------------------------------------------------------------
export class MovableVolleyPosts {
  constructor(scene, physics, homes) {
    this.homes = homes; // [{x,z},{x,z}]
    this.H = CONFIG.equipment.volleyNetHeight;
    const postH = this.H + 0.25;
    this.posts = homes.map((h) => {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, postH, 8), lambert('#e9ecef'));
      pole.position.y = 0.12 + postH / 2;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), lambert('#e07a1f'));
      base.position.y = 0.1;
      g.add(pole, base);
      for (const [wx, wz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8), lambert('#222'));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.05, wz);
        g.add(wheel);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), lambert('#e07a1f'));
      cap.position.y = 0.12 + postH;
      g.add(cap);
      scene.add(g);

      const body = new CANNON.Body({ mass: 25, linearDamping: 0.9, material: physics.materials.equipment, allowSleep: false });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.3, 0.08, 0.3)), new CANNON.Vec3(0, 0.08, 0));
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.07, postH / 2, 0.07)), new CANNON.Vec3(0, 0.12 + postH / 2, 0));
      body.position.set(h.x, 0.001, h.z);
      physics.world.addBody(body);
      keepUpright(physics.world, body);
      return { group: g, body };
    });

    // 두 지주 사이 네트
    this.net = makeVolleyNet(6);
    this.net.visible = false;
    scene.add(this.net);
    this.netShape = new CANNON.Box(new CANNON.Vec3(3, 0.5, 0.02));
    this.netBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: physics.materials.net });
    this.netBody.addShape(this.netShape);
    this.netBody.collisionFilterGroup = GROUP.NET;
    this.netBody.collisionFilterMask = 0; // 걸렸을 때만 켬
    this.netBody.position.set(0, -50, 0);
    physics.world.addBody(this.netBody);
    this.lastW = 6;
  }

  get connected() {
    return this.net.visible;
  }

  update() {
    for (const p of this.posts) {
      const q = p.body.interpolatedPosition;
      p.group.position.set(q.x, 0, q.z);
    }
    const a = this.posts[0].body.position, b = this.posts[1].body.position;
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const on = d >= 5 && d <= 11;
    this.net.visible = on;
    if (!on) {
      this.netBody.collisionFilterMask = 0;
      this.netBody.position.set(0, -50, 0);
      return;
    }
    const w = d - 0.16;
    const yaw = -Math.atan2(dz, dx);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, y = this.H - 0.5;
    this.net.userData.setWidth(w);
    this.net.position.set(mx, y, mz);
    this.net.rotation.y = yaw;
    if (Math.abs(w - this.lastW) > 0.05) {
      this.netShape.halfExtents.set(w / 2, 0.5, 0.02);
      this.netShape.updateConvexPolyhedronRepresentation();
      this.netShape.updateBoundingSphereRadius();
      this.netBody.updateBoundingRadius();
      this.lastW = w;
    }
    this.netBody.position.set(mx, y, mz);
    this.netBody.quaternion.setFromEuler(0, yaw, 0);
    this.netBody.aabbNeedsUpdate = true;
    this.netBody.collisionFilterMask = GROUP.DEFAULT;
  }

  reset() {
    this.posts.forEach((p, i) => {
      p.body.position.set(this.homes[i].x, 0.001, this.homes[i].z);
      p.body.velocity.set(0, 0, 0);
    });
  }
}

// ------------------------------------------------------------
// 추크볼 골대: 55도로 기울어진 1m 트램펄린 그물. 공이 맞으면 탄력 있게 튕겨 나옴.
// facing: 그물이 바라보는 방향 (+1 이면 +x 쪽)
// ------------------------------------------------------------
export class ChukballFrame {
  constructor(scene, physics, x, z, facing = 1) {
    this.home = { x, z };
    const g = new THREE.Group();
    scene.add(g);
    this.group = g;
    const tilt = (35 * Math.PI) / 180; // 그물 법선이 수평에서 35° 위 = 바닥과 55°
    const cy = 0.75;
    // 그물면 그룹 (로컬 +x 가 앞면)
    const face = new THREE.Group();
    face.position.set(0, cy, 0);
    // (Euler XYZ: 먼저 z 로 기울이고, 뒤를 볼 땐 y 로 돌림)
    face.rotation.set(0, facing > 0 ? 0 : Math.PI, tilt);
    g.add(face);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), netMaterial(6, 6));
    net.rotation.y = Math.PI / 2;
    face.add(net);
    const frameMat = lambert('#e63946');
    for (const [w, h, d, py, pz] of [[0.05, 0.06, 1.06, 0.5, 0], [0.05, 0.06, 1.06, -0.5, 0], [0.05, 1.0, 0.06, 0, 0.5], [0.05, 1.0, 0.06, 0, -0.5]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      m.position.set(0, py, pz);
      face.add(m);
    }
    // 다리
    const legMat = lambert('#3d4752');
    for (const s of [-1, 1]) {
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), legMat);
      front.position.set(facing * 0.3, 0.21, s * 0.5);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.05), legMat);
      back.position.set(-facing * 0.32, 0.6, s * 0.5);
      back.rotation.z = facing * 0.35;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.06), legMat);
      foot.position.set(0, 0.02, s * 0.5);
      g.add(front, back, foot);
    }

    const tq = new THREE.Quaternion().setFromEuler(face.rotation);
    const q = new CANNON.Quaternion(tq.x, tq.y, tq.z, tq.w);

    const body = new CANNON.Body({ mass: 15, linearDamping: 0.9, material: physics.materials.equipment, allowSleep: false });
    const bed = new CANNON.Box(new CANNON.Vec3(0.03, 0.5, 0.5));
    bed.material = physics.materials.trampoline;
    body.addShape(bed, new CANNON.Vec3(0, cy, 0), q);
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.05, 0.5)), new CANNON.Vec3(0, 0.05, 0));
    body.position.set(x, 0.001, z);
    physics.world.addBody(body);
    keepUpright(physics.world, body);
    this.body = body;
    this.bed = bed;
    // 앞면 방향 (월드)
    this.normal = new CANNON.Vec3(facing * Math.cos(tilt), Math.sin(tilt), 0);

    // 공이 그물에 닿으면 앞쪽으로 힘을 더해 탄력 있게 튕겨냄
    const cooldown = new Map();
    physics.world.addEventListener('postStep', () => {
      const now = physics.world.time;
      for (const c of physics.world.contacts) {
        if (c.si !== bed && c.sj !== bed) continue;
        const other = c.bi === body ? c.bj : c.bi;
        if (other.type !== CANNON.Body.DYNAMIC || other.mass > 2) continue;
        if ((cooldown.get(other) || 0) > now) continue;
        cooldown.set(other, now + 0.25);
        const v = other.velocity;
        const n = this.normal;
        const vn = v.x * n.x + v.y * n.y + v.z * n.z;
        // 들어오는 속도의 반대 방향으로 반사 + 추가 탄력
        const out = Math.max(Math.abs(vn) * 0.9, 4) + 2.5;
        v.x += n.x * (out - vn);
        v.y += n.y * (out - vn);
        v.z += n.z * (out - vn);
        if (this.onBounce) this.onBounce(other);
      }
    });
  }

  update() {
    const p = this.body.interpolatedPosition;
    this.group.position.set(p.x, 0, p.z);
  }

  reset() {
    this.body.position.set(this.home.x, 0.001, this.home.z);
    this.body.velocity.set(0, 0, 0);
  }
}
