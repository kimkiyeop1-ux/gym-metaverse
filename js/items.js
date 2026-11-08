import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

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
};

// 작은 공·원반은 아바타 비율에 맞게 키움 (config.js 의 ballScale)
// 킨볼·빅발리볼은 원래 커서 그대로 둔다
const SCALED = ['basketball', 'futsal', 'football', 'dodgeball', 'volleyball', 'frisbee'];
for (const k of SCALED) ITEM_DEFS[k].r *= CONFIG.equipment.ballScale;
const FRISBEE_H = 0.03 * CONFIG.equipment.ballScale;

// 처음 놓이는 자리 (공 바구니 옆, -z 벽 쪽)
const PLACEMENT = [
  ['basketball', -3.4, -9.4],
  ['basketball', -2.8, -9.4],
  ['futsal', -2.0, -9.4],
  ['dodgeball', -1.3, -9.4],
  ['volleyball', -0.6, -9.4],
  ['football', 0.1, -9.4],
  ['frisbee', 0.8, -9.4],
  ['bigvolley', 2.0, -9.2],
  ['kinball', 6.0, -8.4],
  ['racket', 4.1, 1.2],
  ['shuttle', 4.5, 1.6],
];

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
  return TEX;
}

const lambert = (opts) => new THREE.MeshLambertMaterial(opts);

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
      // 손잡이가 로컬 원점, 헤드가 +y 방향
      const g = new THREE.Group();
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
      return g;
    }
  }
  return new THREE.Mesh(new THREE.SphereGeometry(def.r, 10, 8), lambert({ color: '#ccc' }));
}

function makeShape(type, def) {
  if (type === 'frisbee') return new CANNON.Cylinder(def.r, def.r, FRISBEE_H, 10);
  if (type === 'racket') return new CANNON.Box(new CANNON.Vec3(0.06, 0.02, 0.3));
  return new CANNON.Sphere(def.r);
}

// ============================================================
export class Items {
  constructor(scene, physics, gym, { onGoal } = {}) {
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
      const y = type === 'frisbee' ? FRISBEE_H / 2 + 0.005 : type === 'racket' ? 0.025 : def.r;
      body.position.set(x, y, z);
      if (type === 'racket') body.quaternion.setFromEuler(0, 0.5, 0);
      physics.world.addBody(body);
      const item = {
        type, def, mesh, body,
        home: { x, y, z },
        held: false,
        prevY: y, prevX: x, prevZ: z,
        spin: 0,        // 원반·풋볼 회전 표시용
        flying: false,  // 던져져 날아가는 중
        restYaw: 0,
      };
      body.userData = { item };
      this.list.push(item);
    }

    this.buildCart(scene, physics);

    // 원반 활공, 셔틀콕 공기저항 등은 물리 계산 단계마다 적용
    physics.world.addEventListener('preStep', () => this.applyForces());
  }

  // 공 바구니 (공들 뒤, 벽 쪽)
  buildCart(scene, physics) {
    const x = -0.7, z = -10.35, w = 3.4, d = 0.6, h = 0.55;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const frame = new THREE.MeshLambertMaterial({ color: '#8f9aa6' });
    const add = (bw, bh, bd, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), frame);
      m.position.set(px, py, pz);
      g.add(m);
    };
    add(w, 0.04, d, 0, 0.15, 0);                 // 바닥판
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.04, h, 0.04, sx * w / 2, h / 2, sz * d / 2);
    for (const sz of [-1, 1]) add(w, 0.04, 0.04, 0, h, sz * d / 2);
    for (const sx of [-1, 1]) add(0.04, 0.04, d, sx * w / 2, h, 0);
    for (let i = -3; i <= 3; i++) add(0.02, h - 0.15, 0.02, (i * w) / 8, (h + 0.15) / 2, d / 2);
    // 바구니 안의 장식용 공들
    const cols = ['#e8762b', '#ffffff', '#e84a5f', '#ffd23f', '#2a5bd7', '#e8762b', '#e84a5f'];
    cols.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshLambertMaterial({ color: c }));
      b.position.set(-1.35 + i * 0.45, 0.3, (i % 2) * 0.12 - 0.06);
      g.add(b);
    });
    scene.add(g);
    physics.addStaticBox(x, h / 2, z, w / 2, h / 2, d / 2);
  }

  applyForces() {
    for (const it of this.list) {
      if (it.held || it.body.sleepState === CANNON.Body.SLEEPING) continue;
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
      if (it.held || (filter && !filter(it))) continue;
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
      b.collisionFilterMask = -1;
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
      const b = it.body, h = it.home;
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

  // 매 프레임: 화면 동기화, 골 판정, 셔틀콕·풋볼 방향
  update(dt) {
    for (const it of this.list) {
      if (it.held) continue;
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
