import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';
import { storagePlacement } from './storageArea.js';

// ============================================================
//  공·작은 용기구 정의
//   r: 반지름(m), mass: kg, e: 튀는 정도, f: 마찰, ld/ad: 공기저항·회전저항
//   hold: 들기 자세 ('one' 한손, 'two' 두손, 'racket', null=못 듦)
//   throwSpeed: [최소, 최대] 던지는 속도, kick: 차는 속도 [앞, 위]
// ============================================================
export const ITEM_DEFS = {
  basketball: { name: '농구공', r: 0.12, mass: 0.6, e: 0.82, f: 0.7, ld: 0, ad: 0.3,
    hold: 'one', throwSpeed: [4, 13], kick: [7, 2.5], dribble: true },
  futsal: { name: '풋살공', r: 0.105, mass: 0.42, e: 0.45, f: 0.8, ld: 0.05, ad: 0.6,
    hold: 'one', throwSpeed: [4, 11], kick: [13, 3] },
  football: { name: '플래그풋볼 공', r: 0.09, mass: 0.4, e: 0.45, f: 0.8, ld: 0.02, ad: 0.8,
    hold: 'one', throwSpeed: [5, 17], kick: [9, 5], spiral: true },
  dodgeball: { name: '피구공', r: 0.1, mass: 0.28, e: 0.5, f: 0.9, ld: 0.08, ad: 0.6,
    hold: 'one', throwSpeed: [4, 14], kick: [8, 3] },
  volleyball: { name: '배구공', r: 0.105, mass: 0.27, e: 0.7, f: 0.6, ld: 0.04, ad: 0.4,
    hold: 'one', throwSpeed: [4, 13], kick: [8, 3], toss: true, spike: true },
  bigvolley: { name: '빅발리볼 공', r: 0.39, mass: 0.15, e: 0.6, f: 0.6, ld: 0.45, ad: 0.5,
    hold: 'two', throwSpeed: [3, 9], kick: [5, 4], toss: true, spike: true },
  kinball: { name: '킨볼 공', r: 0.6, mass: 1.0, e: 0.6, f: 0.6, ld: 0.3, ad: 0.4,
    hold: null, lift: [3, 7.5] },
  frisbee: { name: '플라잉디스크', r: 0.135, mass: 0.175, e: 0.3, f: 0.5, ld: 0.02, ad: 0.5,
    hold: 'one', throwSpeed: [5, 15], glide: true },
  shuttle: { name: '셔틀콕', r: 0.035, mass: 0.005, e: 0.2, f: 0.6, ld: 0, ad: 0.9,
    hold: 'one', throwSpeed: [3, 9], shuttle: true },
  racket: { name: '배드민턴 라켓', r: 0.12, mass: 0.09, e: 0.2, f: 0.8, ld: 0.05, ad: 0.9,
    hold: 'racket', racket: true },
  jumprope: { name: '줄넘기', r: 0.16, mass: 0.25, e: 0.1, f: 0.9, ld: 0.3, ad: 0.9,
    hold: 'rope', rope: true },
  hulahoop: { name: '훌라후프', r: 0.42, mass: 0.3, e: 0.3, f: 0.6, ld: 0.1, ad: 0.6,
    hold: 'hoop', hoop: true, noPerson: true }, // 바닥의 후프는 사람과 부딪히지 않음 (안에 서도 됨)
};

// 작은 공·원반은 아바타 비율에 맞게 키움 (config.js 의 ballScale)
// 킨볼·빅발리볼은 원래 커서 그대로 둔다
const SCALED = ['basketball', 'futsal', 'football', 'dodgeball', 'volleyball', 'frisbee'];
for (const k of SCALED) ITEM_DEFS[k].r *= CONFIG.equipment.ballScale;
const FRISBEE_H = 0.03 * CONFIG.equipment.ballScale;

// 처음 놓이는 자리: 보관 구역 칸 (storageArea.js)
const PLACEMENT = storagePlacement();

// ---------- 텍스처 (작은 캔버스, 모바일 부담 적게) ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX = {};
function textures() {
  if (TEX.basketball) return TEX;
  TEX.basketball = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#e8762b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a1a10'; g.lineWidth = 2.5;
    for (const x of [0, w / 4, w / 2, (3 * w) / 4]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  TEX.futsal = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#222';
    const spots = [[16, 14], [48, 30], [80, 14], [112, 30], [16, 48], [80, 48], [48, 6], [112, 58]];
    for (const [x, y] of spots) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  });
  TEX.volleyball = canvasTex(64, 64, (g, w, h) => {
    const cols = ['#ffd23f', '#ffffff', '#2a5bd7', '#ffffff', '#ffd23f', '#ffffff', '#2a5bd7', '#ffffff'];
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, (i * h) / cols.length, w, h / cols.length + 1); });
  });
  TEX.bigvolley = canvasTex(64, 64, (g, w, h) => {
    const cols = ['#ff9fb2', '#fff2a8', '#9fd8ff', '#fff2a8'];
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect((i * w) / 4, 0, w / 4 + 1, h); });
  });
  TEX.kinball = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#ff5fa2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d63f82'; g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, (i * h) / 4); g.lineTo(w, (i * h) / 4); g.stroke(); }
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo((i * w) / 4, 0); g.lineTo((i * w) / 4, h); g.stroke(); }
  });
  TEX.football = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#8b4a24'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(0, h * 0.12, w, 4); g.fillRect(0, h * 0.84, w, 4);
    g.fillRect(w / 2 - 2, h * 0.35, 4, h * 0.3);
    for (let i = 0; i < 4; i++) g.fillRect(w / 2 - 6, h * 0.38 + i * 5, 12, 2);
  });
  TEX.hoop = canvasTex(64, 8, (g, w, h) => {
    const cols = ['#ff5fa2', '#ffd23f', '#2ec4b6', '#ffd23f'];
    for (let i = 0; i < 16; i++) { g.fillStyle = cols[i % 4]; g.fillRect((i * w) / 16, 0, w / 16 + 1, h); }
  });
  return TEX;
}

const lambert = (opts) => new THREE.MeshLambertMaterial(opts);

// 공유하지 않는 모양만 필요할 때 (예: 배드민턴 경기장의 '내 라켓')
export function makeItemMesh(type) {
  return makeMesh(type, ITEM_DEFS[type]);
}

function makeMesh(type, def) {
  const T = textures();
  switch (type) {
    case 'basketball':
    case 'futsal':
    case 'volleyball':
    case 'bigvolley':
    case 'kinball':
      return new THREE.Mesh(new THREE.SphereGeometry(def.r, 14, 10), lambert({ map: T[type] }));
    case 'dodgeball':
      return new THREE.Mesh(new THREE.SphereGeometry(def.r, 14, 10), lambert({ color: '#e84a5f' }));
    case 'football': {
      // 타원형: 긴 축이 z
      const m = new THREE.Mesh(new THREE.SphereGeometry(def.r, 12, 10), lambert({ map: T.football }));
      m.geometry.rotateX(Math.PI / 2);
      m.scale.set(1, 1, 1.6);
      const g = new THREE.Group();
      g.add(m);
      return g;
    }
    case 'frisbee': {
      const g = new THREE.Group();
      const top = new THREE.Mesh(new THREE.CylinderGeometry(def.r, def.r * 0.95, FRISBEE_H, 18), lambert({ color: '#2ec4b6' }));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(def.r, FRISBEE_H * 0.4, 5, 18), lambert({ color: '#ffffff' }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -FRISBEE_H * 0.33;
      g.add(top, rim);
      return g;
    }
    case 'shuttle': {
      // 코르크가 로컬 -y 쪽
      const g = new THREE.Group();
      const cork = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), lambert({ color: '#f2e6d0' }));
      cork.position.y = -0.03;
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.033, 0.013, 0.06, 10, 1, true),
        lambert({ color: '#ffffff', side: THREE.DoubleSide })
      );
      skirt.position.y = 0.005;
      g.add(cork, skirt);
      g.scale.setScalar(1.6); // 화면에서 잘 보이도록 조금 크게
      return g;
    }
    case 'racket': {
      // 손잡이가 원점. 안쪽 그룹에서 헤드가 +y, 바깥에서 눕혀 헤드가 -z (바닥에 누운 모양)
      const outer = new THREE.Group();
      const g = new THREE.Group();
      g.rotation.x = -Math.PI / 2;
      g.position.y = 0.02;
      outer.add(g);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.03), lambert({ color: '#333a55' }));
      grip.position.y = 0.06;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.26, 0.012), lambert({ color: '#cccccc' }));
      shaft.position.y = 0.28;
      const head = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.009, 5, 18), lambert({ color: '#e63946' }));
      head.scale.set(1, 1.25, 1);
      head.position.y = 0.53;
      const strings = new THREE.Mesh(
        new THREE.CircleGeometry(0.1, 14),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, side: THREE.DoubleSide })
      );
      strings.scale.set(1, 1.25, 1);
      strings.position.y = 0.53;
      g.add(grip, shaft, head, strings);
      return outer;
    }
    case 'jumprope': {
      // 바닥에 둘둘 말린 줄 + 손잡이 2개
      const g = new THREE.Group();
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 5, 16), lambert({ color: '#2a5bd7' }));
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 0.012;
      const coil2 = coil.clone();
      coil2.scale.setScalar(0.8);
      coil2.position.y = 0.03;
      g.add(coil, coil2);
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.15), lambert({ color: '#e63946' }));
        h.position.set(s * 0.06, 0.03, 0.14);
        h.rotation.y = s * 0.3;
        g.add(h);
      }
      return g;
    }
    case 'hulahoop': {
      // 바깥 그룹: 평평하게 누운 고리 (회전은 코드에서 조합)
      const g = new THREE.Group();
      const t = new THREE.Mesh(new THREE.TorusGeometry(def.r, 0.02, 6, 32), lambert({ map: T.hoop }));
      t.rotation.x = Math.PI / 2;
      g.add(t);
      return g;
    }
  }
  return new THREE.Mesh(new THREE.SphereGeometry(def.r, 10, 8), lambert({ color: '#ccc' }));
}

// 훌라후프 자세: 방향(yaw) · 세운 정도(stand: 0=누움, π/2=섬) · 굴림(roll)
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
export function hoopQuaternion(out, yaw, stand, roll) {
  out.setFromAxisAngle(_Y, yaw);
  out.multiply(_qa.setFromAxisAngle(_Z, stand));
  out.multiply(_qb.setFromAxisAngle(_Y, roll));
  return out;
}

function makeShape(type, def) {
  if (type === 'frisbee') return new CANNON.Cylinder(def.r, def.r, FRISBEE_H, 10);
  if (type === 'racket') return new CANNON.Box(new CANNON.Vec3(0.06, 0.02, 0.3));
  if (type === 'jumprope') return new CANNON.Box(new CANNON.Vec3(0.14, 0.03, 0.2));
  if (type === 'hulahoop') return new CANNON.Cylinder(def.r, def.r, 0.04, 12);
  return new CANNON.Sphere(def.r);
}

// ============================================================
export class Items {
  constructor(scene, physics, gym, { onGoal, onImpact } = {}) {
    this.scene = scene;
    this.physics = physics;
    this.hoops = gym.hoops;
    this.onGoal = onGoal;
    this.list = [];
    this.tmp = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();

    const mats = {};
    for (const [type, def] of Object.entries(ITEM_DEFS)) {
      mats[type] = physics.addItemMaterial({ friction: def.f, restitution: def.e });
    }

    for (const [type, x, z] of PLACEMENT) {
      const def = ITEM_DEFS[type];
      const mesh = makeMesh(type, def);
      scene.add(mesh);
      const body = new CANNON.Body({
        mass: def.mass,
        material: mats[type],
        shape: makeShape(type, def),
        linearDamping: def.ld,
        angularDamping: def.ad,
        allowSleep: true,
        sleepSpeedLimit: 0.15,
        sleepTimeLimit: 0.6,
      });
      const FLAT_Y = { frisbee: FRISBEE_H / 2 + 0.005, racket: 0.025, jumprope: 0.035, hulahoop: 0.025 };
      const y = FLAT_Y[type] ?? def.r;
      body.position.set(x, y, z);
      if (type === 'racket') body.quaternion.setFromEuler(0, 0.5, 0);
      physics.world.addBody(body);
      const item = {
        type, def, mesh, body,
        home: { x, y, z },
        origHome: { x, y, z },
        held: false,
        prevY: y, prevX: x, prevZ: z,
        spin: 0,        // 원반·풋볼 회전 표시용
        flying: false,  // 던져져 날아가는 중
        restYaw: 0,
      };
      body.userData = { item };
      // 부딪힐 때 소리 (너무 자주 나지 않게 0.08초 간격)
      let lastHit = 0;
      body.addEventListener('collide', (e) => {
        if (!onImpact || item.held) return;
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        const now = performance.now();
        if (v > 1.0 && now - lastHit > 80) {
          lastHit = now;
          onImpact(item, v);
        }
      });
      if (def.noPerson) body.collisionFilterMask = 1;
      this.list.push(item);
    }


    // 원반 활공, 셔틀콕 공기저항 등은 물리 계산 단계마다 적용
    physics.world.addEventListener('preStep', () => this.applyForces());
  }

  applyForces() {
    for (const it of this.list) {
      if (it.held || it.remote || it.body.sleepState === CANNON.Body.SLEEPING) continue;
      const b = it.body, v = b.velocity;
      const speed = v.length();
      if (it.def.shuttle && speed > 0.01) {
        // 공기저항 ∝ 속도² (종단 속도 약 6.8m/s)
        const c = (b.mass * 9.82) / (6.8 * 6.8);
        b.applyForce(new CANNON.Vec3(-c * speed * v.x, -c * speed * v.y, -c * speed * v.z));
      }
      if (it.def.glide && it.flying) {
        const vh = Math.hypot(v.x, v.z);
        // 수평 속도가 빠를수록 위로 뜨는 힘 (중력의 최대 90%)
        const lift = b.mass * 9.82 * Math.min(0.9, (vh / 10) ** 2);
        b.applyForce(new CANNON.Vec3(-0.012 * v.x * speed, lift - 0.02 * v.y * Math.abs(v.y), -0.012 * v.z * speed));
        b.angularVelocity.set(0, b.angularVelocity.y, 0);
        it.spin += 0;
      }
    }
  }

  // 가장 가까운 아이템 (조건 함수로 거르기)
  nearest(pos, maxDist, filter) {
    let best = null, bestD = maxDist;
    for (const it of this.list) {
      if (it.held || it.busy || it.remoteHolder || (filter && !filter(it))) continue;
      const p = it.body.position;
      const dx = p.x - pos.x, dz = p.z - pos.z;
      const dy = Math.max(0, Math.abs(p.y - (pos.y + 0.7)) - 0.9); // 몸 높이 범위 밖일 때만 높이 차 반영
      const d = Math.hypot(dx, dz, dy) - it.def.r;
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  setHeld(it, held) {
    it.held = held;
    const b = it.body;
    if (held) {
      b.collisionFilterMask = 0;
      b.collisionFilterGroup = 0;
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.sleep();
      it.flying = false;
    } else {
      b.collisionFilterMask = it.def.noPerson ? 1 : -1;
      b.collisionFilterGroup = 1;
      b.wakeUp();
      if (it.mesh.parent !== this.scene) this.scene.add(it.mesh);
    }
  }

  // 던지기·차기 등: 속도 주기
  launch(it, vx, vy, vz, spin = 0) {
    if (it.held) this.setHeld(it, false);
    const b = it.body;
    b.wakeUp();
    b.velocity.set(vx, vy, vz);
    b.angularVelocity.set(0, spin, 0);
    it.flying = true;
    if (it.def.glide) b.quaternion.set(0, 0, 0, 1);
  }

  reset() {
    for (const it of this.list) {
      if (it.held) this.setHeld(it, false);
      it.busy = false;
      it.rolling = null;
      it.mesh.visible = true;
      if (it.mesh.parent !== this.scene) this.scene.add(it.mesh);
      const b = it.body, h = it.home;
      b.collisionFilterGroup = 1;
      b.collisionFilterMask = it.def.noPerson ? 1 : -1;
      b.position.set(h.x, h.y, h.z);
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.quaternion.set(0, 0, 0, 1);
      if (it.type === 'racket') b.quaternion.setFromEuler(0, 0.5, 0);
      it.flying = false;
      it.prevY = h.y;
      it.prevX = h.x;
      it.prevZ = h.z;
      b.sleep();
    }
  }

  // 훌라후프 굴리기: 물리 대신 직접 움직임 (세워서 굴러가다 느려지면 쓰러짐)
  startRolling(it, dirX, dirZ, speed, from) {
    if (it.held) this.setHeld(it, false);
    const b = it.body;
    b.collisionFilterMask = 0;
    b.collisionFilterGroup = 0;
    b.sleep();
    it.busy = true;
    it.rolling = { x: from.x, z: from.z, dx: dirX, dz: dirZ, v: speed, roll: 0, stand: Math.PI / 2 };
    if (it.mesh.parent !== this.scene) this.scene.add(it.mesh);
  }

  updateRolling(it, dt) {
    const r = it.rolling;
    const R = it.def.r;
    if (r.v > 0.9) {
      r.v -= 1.1 * dt;
    } else {
      // 느려지면 옆으로 쓰러짐
      r.v = Math.max(0, r.v - 1.5 * dt);
      r.stand -= dt * 2.6;
    }
    r.x += r.dx * r.v * dt;
    r.z += r.dz * r.v * dt;
    // 벽에 닿으면 튕김
    if (r.x < -16.5 + R || r.x > 16.6 - R) { r.dx *= -1; r.x = THREE.MathUtils.clamp(r.x, -16.5 + R, 16.6 - R); }
    if (r.z < -10.6 + R || r.z > 10.6 - R) { r.dz *= -1; r.z = THREE.MathUtils.clamp(r.z, -10.6 + R, 10.6 - R); }
    r.roll += (r.v / R) * dt;
    const stand = Math.max(0, r.stand);
    const yaw = Math.atan2(r.dx, r.dz);
    const y = 0.025 + Math.sin(stand) * R;
    it.mesh.position.set(r.x, y, r.z);
    hoopQuaternion(it.mesh.quaternion, yaw + Math.PI / 2, stand, r.roll);
    if (r.stand <= 0) {
      // 다 쓰러짐 → 다시 물리로
      it.busy = false;
      it.rolling = null;
      const b = it.body;
      b.position.set(r.x, 0.03, r.z);
      b.velocity.set(0, 0, 0);
      b.quaternion.set(0, 0, 0, 1);
      b.collisionFilterMask = it.def.noPerson ? 1 : -1;
      b.collisionFilterGroup = 1;
      b.wakeUp();
    }
  }

  // 공간 바꾸기: pick = null 이면 모든 기구(자유 체육관),
  // [[종류, x, z], ...] 이면 그 기구만 그 자리에 두고 나머지는 치움 (경기장)
  setSpace(pick) {
    const all = (this.all ||= this.list.slice());
    let used = all;
    if (pick) {
      used = [];
      for (const [type, x, z] of pick) {
        const it = all.find((i) => i.type === type && !used.includes(i));
        if (!it) continue;
        it.home = { x, y: it.origHome.y, z };
        used.push(it);
      }
    }
    for (const it of all) {
      if (it.held) this.setHeld(it, false);
      it.remote = false;
      it.remoteHolder = null;
      const on = used.includes(it);
      if (!pick) it.home = { ...it.origHome };
      if (on && !it.body.world) this.physics.world.addBody(it.body);
      if (!on && it.body.world) this.physics.world.removeBody(it.body);
      if (it.mesh.parent !== this.scene) this.scene.add(it.mesh);
      it.mesh.visible = on;
    }
    this.list = used;
    this.reset();
    for (const it of this.list) it.mesh.position.set(it.home.x, it.home.y, it.home.z);
  }

  // 매 프레임: 화면 동기화, 골 판정, 셔틀콕·풋볼 방향
  update(dt) {
    for (const it of this.list) {
      if (it.rolling) { this.updateRolling(it, dt); continue; }
      if (it.held || it.busy || it.remote) continue; // remote: 친구 기기가 계산 중
      const b = it.body;
      const p = b.interpolatedPosition;
      const v = b.velocity;
      const speed = v.length();

      // 너무 멀리 나가거나 바닥 밑으로 빠지면 제자리로
      if (p.y < -3) {
        b.position.set(it.home.x, it.home.y + 0.5, it.home.z);
        b.velocity.set(0, 0, 0);
      }

      it.mesh.position.set(p.x, p.y, p.z);

      if (it.flying && (speed < 1.2 || (p.y < it.def.r + 0.05 && Math.abs(v.y) < 0.5))) it.flying = false;

      if (it.def.shuttle) {
        // 코르크(로컬 -y)가 날아가는 방향을 향하게
        if (speed > 0.6) {
          this.tmp.set(v.x, v.y, v.z).normalize();
          this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.tmp);
          it.mesh.quaternion.slerp(this.tmpQ, Math.min(1, 12 * dt));
        } else if (p.y < 0.1) {
          it.mesh.quaternion.slerp(this.tmpQ.identity(), Math.min(1, 6 * dt));
        }
      } else if (it.def.spiral) {
        if (it.flying) {
          // 긴 축을 날아가는 방향으로, 그 축을 중심으로 회전(나선)
          it.spin += dt * 18;
          this.tmp.set(v.x, v.y, v.z).normalize();
          this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.tmp);
          const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.spin);
          it.mesh.quaternion.copy(this.tmpQ).multiply(roll);
          it.restYaw = Math.atan2(v.x, v.z);
        } else {
          // 바닥에서는 눕힌 채로 굴러감
          const vh = Math.hypot(v.x, v.z);
          if (vh > 0.2) it.restYaw = Math.atan2(v.x, v.z);
          it.spin += vh * dt / 0.09;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, it.restYaw, 0));
          const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.spin);
          it.mesh.quaternion.copy(q).multiply(roll);
        }
      } else if (it.def.glide && it.flying) {
        it.spin += dt * 20;
        it.mesh.quaternion.setFromEuler(new THREE.Euler(0, it.spin, 0));
      } else {
        const q = b.interpolatedQuaternion;
        it.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }

      // 농구 골 판정: 림 높이를 위→아래로 통과하고, 림 안쪽이면 골
      if (it.type === 'basketball') {
        for (const h of this.hoops) {
          if (it.prevY > h.y && b.position.y <= h.y && v.y < 0) {
            // 프레임 사이에 림 높이를 지난 정확한 지점 (빠른 공도 놓치지 않게)
            const t = (it.prevY - h.y) / (it.prevY - b.position.y);
            const cx = it.prevX + (b.position.x - it.prevX) * t;
            const cz = it.prevZ + (b.position.z - it.prevZ) * t;
            const d = Math.hypot(cx - h.x, cz - h.z);
            if (d < h.r - 0.02) {
              h.goals++;
              h.netWobble = 1;
              if (this.onGoal) this.onGoal(h, it);
            }
          }
        }
      }
      it.prevY = b.position.y;
      it.prevX = b.position.x;
      it.prevZ = b.position.z;
    }

    // 그물 흔들림
    for (const h of this.hoops) {
      if (!h.netWobble) continue;
      h.netWobble = Math.max(0, h.netWobble - dt * 1.5);
      const w = h.netWobble;
      h.net.scale.set(1 - 0.15 * w * Math.sin(w * 30), 1 + 0.35 * w, 1 - 0.15 * w * Math.cos(w * 30));
      h.net.position.y = h.netY - 0.08 * w;
    }
  }
}
