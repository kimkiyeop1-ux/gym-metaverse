import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

// 3단계 고정·이동 기구: 배구 고정 지주·네트, 추크볼 골대
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

// 공간(로비·경기장)에 따라 기구를 놓거나 치우기: 화면 물체 + 물리 몸체
function setPresent(world, objects, bodies, on) {
  for (const o of objects) o.visible = on;
  for (const b of bodies) {
    if (on && !b.world) world.addBody(b);
    if (!on && b.world) world.removeBody(b);
  }
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
    this.world = physics.world;
    this.objects = [];
    this.bodies = [];
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, postH, 8), lambert('#d9dde2'));
      post.position.set(0, postH / 2, s * postZ);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.6, 10), lambert('#2a5bd7'));
      pad.position.set(0, 0.8, s * postZ);
      scene.add(post, pad);
      this.objects.push(post, pad);
      this.bodies.push(physics.addStaticBox(0, postH / 2, s * postZ, 0.13, postH / 2, 0.13));
    }
    const w = postZ * 2 - 0.2;
    const net = makeVolleyNet(w);
    net.rotation.y = Math.PI / 2;
    net.position.set(0, H - 0.5, 0);
    scene.add(net);
    this.objects.push(net);

    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: physics.materials.net });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.02, 0.5, w / 2)));
    body.position.set(0, H - 0.5, 0);
    body.collisionFilterGroup = GROUP.NET;
    body.collisionFilterMask = GROUP.DEFAULT;
    physics.world.addBody(body);
    this.bodies.push(body);
  }

  setActive(on) {
    setPresent(this.world, this.objects, this.bodies, on);
  }
}

// ------------------------------------------------------------
// 풋살 골대 (경기장 전용): 폭 3m, 높이 2m, 깊이 0.8m. facing = 골문이 바라보는 방향(-1 이면 -x 쪽)
// ------------------------------------------------------------
export const FUTSAL_GOAL = { halfW: 1.5, h: 2, depth: 0.8 };
export class FutsalGoal {
  constructor(scene, physics, x, facing) {
    const { halfW, h, depth } = FUTSAL_GOAL;
    this.world = physics.world;
    this.x = x;          // 골라인 위치
    this.facing = facing;
    const g = new THREE.Group();
    scene.add(g);
    this.objects = [g];
    this.bodies = [];
    const white = lambert('#ffffff');
    const r = 0.05;
    const back = x - facing * depth; // 골대 뒤쪽 x
    const add = (w, hh, d, px, py, pz, mat = white) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
      m.position.set(px, py, pz);
      g.add(m);
    };
    // 골포스트·크로스바
    for (const s of [-1, 1]) add(r * 2, h, r * 2, x, h / 2, s * halfW);
    add(r * 2, r * 2, halfW * 2 + r * 2, x, h, 0);
    // 뒤쪽 받침
    for (const s of [-1, 1]) add(depth, 0.05, 0.05, (x + back) / 2, 0.03, s * halfW, lambert('#cfd4da'));
    add(0.05, 0.05, halfW * 2, back, 0.03, 0, lambert('#cfd4da'));
    // 그물 (뒤·위·양옆)
    const netMat = netMaterial(halfW * 4, h * 2);
    const backNet = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, h), netMat);
    backNet.position.set(back, h / 2, 0);
    backNet.rotation.y = Math.PI / 2;
    const topNet = new THREE.Mesh(new THREE.PlaneGeometry(depth, halfW * 2), netMaterial(depth * 4, halfW * 4));
    topNet.position.set((x + back) / 2, h, 0);
    topNet.rotation.x = -Math.PI / 2;
    g.add(backNet, topNet);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(depth, h), netMaterial(depth * 4, h * 2));
      side.position.set((x + back) / 2, h / 2, s * halfW);
      g.add(side);
    }
    // 물리: 포스트·크로스바·그물(공만 막고 사람은 막지 않게 하면 골키퍼가 들어갈 수 있음 → 사람도 막음)
    const box = (px, py, pz, hx, hy, hz) => this.bodies.push(physics.addStaticBox(px, py, pz, hx, hy, hz));
    for (const s of [-1, 1]) box(x, h / 2, s * halfW, r, h / 2, r);
    box(x, h, 0, r, r, halfW);
    box(back - facing * 0.03, h / 2, 0, 0.03, h / 2, halfW);
    box((x + back) / 2, h + 0.03, 0, depth / 2, 0.03, halfW);
    for (const s of [-1, 1]) box((x + back) / 2, h / 2, s * (halfW + 0.03), depth / 2, h / 2, 0.03);
  }

  setActive(on) {
    setPresent(this.world, this.objects, this.bodies, on);
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
    this.world = physics.world;
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

  setActive(on) {
    if (on) this.reset();
    setPresent(this.world, [this.group], [this.body], on);
  }
}
