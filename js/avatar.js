import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

// 블록형 사람 (남색 체육복). 연습 친구(NPC)도 같은 모양을 쓴다.
export const SUIT_COLORS = {
  suit: '#1f2a5c',
  suitDark: '#172047',
  stripe: '#ffffff',
  skin: '#f4cfa6',
  hair: '#2b2220',
  shoe: '#f5f5f5',
  sole: '#cc3344',
  eye: '#222222',
  cheek: '#f29a9a',
  bib: null,          // 조끼 색 (null 이면 없음)
  flag: '#e63946',    // 플래그 색
};

const geoCache = new Map();
const matCache = new Map();
function part(w, h, d, color, x, y, z, parent) {
  const gk = `${w},${h},${d}`;
  if (!geoCache.has(gk)) geoCache.set(gk, new THREE.BoxGeometry(w, h, d));
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  const m = new THREE.Mesh(geoCache.get(gk), matCache.get(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// 블록 사람 모델 만들기. 반환: 관절 그룹들
export function buildBlockPerson(colors = SUIT_COLORS) {
  const C = { ...SUIT_COLORS, ...colors };
  const model = new THREE.Group();
  const p = part;

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.13, 0.72, 0);
    model.add(hip);
    p(0.2, 0.62, 0.22, C.suitDark, 0, -0.31, 0, hip);
    p(0.03, 0.6, 0.23, C.stripe, s * 0.1, -0.3, 0, hip);
    p(0.22, 0.1, 0.3, C.shoe, 0, -0.67, 0.04, hip);
    p(0.22, 0.03, 0.3, C.sole, 0, -0.715, 0.04, hip);
    legs.push(hip);
  }

  // 몸통
  p(0.52, 0.56, 0.3, C.suit, 0, 1.0, 0, model);
  p(0.53, 0.04, 0.31, C.stripe, 0, 0.74, 0, model);
  p(0.2, 0.06, 0.02, C.stripe, 0, 1.24, 0.155, model);
  if (C.bib) {
    p(0.54, 0.46, 0.33, C.bib, 0, 1.02, 0, model); // 조끼
    p(0.16, 0.16, 0.01, '#ffffff', 0, 1.05, 0.17, model);
  } else {
    p(0.12, 0.12, 0.02, '#ffd23f', 0.13, 1.12, 0.155, model);
  }

  const arms = [];
  let rightHand = null;
  let leftHand = null;
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.35, 1.22, 0);
    model.add(sh);
    p(0.16, 0.46, 0.18, C.suit, 0, -0.21, 0, sh);
    p(0.03, 0.44, 0.19, C.stripe, s * 0.08, -0.2, 0, sh);
    p(0.14, 0.12, 0.15, C.skin, 0, -0.5, 0, sh);
    arms.push(sh);
    // 손 위치 (모델 기준 -x 가 오른쪽: 모델은 +z 를 바라봄)
    const hand = new THREE.Group();
    hand.position.set(0, -0.55, 0.02);
    sh.add(hand);
    if (s < 0) rightHand = hand;
    else leftHand = hand;
  }

  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  model.add(head);
  p(0.42, 0.42, 0.4, C.skin, 0, 0, 0, head);
  p(0.46, 0.13, 0.44, C.hair, 0, 0.21, -0.01, head);
  p(0.46, 0.34, 0.1, C.hair, 0, 0.06, -0.2, head);
  p(0.06, 0.24, 0.36, C.hair, -0.22, 0.08, -0.03, head);
  p(0.06, 0.24, 0.36, C.hair, 0.22, 0.08, -0.03, head);
  p(0.3, 0.07, 0.06, C.hair, 0, 0.16, 0.19, head);
  p(0.06, 0.08, 0.02, C.eye, -0.09, 0.02, 0.205, head);
  p(0.06, 0.08, 0.02, C.eye, 0.09, 0.02, 0.205, head);
  p(0.07, 0.04, 0.02, C.cheek, -0.14, -0.07, 0.202, head);
  p(0.07, 0.04, 0.02, C.cheek, 0.14, -0.07, 0.202, head);
  p(0.08, 0.025, 0.02, '#a0523d', 0, -0.1, 0.205, head);

  // 플래그 벨트 (허리에 두르고 양옆에 플래그 2개)
  const belt = new THREE.Group();
  model.add(belt);
  p(0.56, 0.06, 0.34, '#f0f0f0', 0, 0.76, 0, belt);
  const flags = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Group();
    f.position.set(s * 0.29, 0.74, 0);
    belt.add(f);
    p(0.03, 0.42, 0.08, C.flag, 0, -0.2, 0, f);
    flags.push(f);
  }
  belt.visible = false;

  return { model, legs, arms, head, rightHand, leftHand, belt, flags };
}

// 걷기·점프·동작 애니메이션 (아바타와 연습 친구가 같이 씀)
export function animatePerson(parts, state, dt) {
  const { legs, arms, model } = parts;
  const m = state.moveAmount;
  const t = Math.min(1, 12 * dt);
  if (state.grounded) {
    state.walkPhase += dt * (4 + 7 * m);
    const swing = Math.sin(state.walkPhase) * 0.75 * m;
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
    arms[0].rotation.x = -swing * 0.9;
    arms[1].rotation.x = swing * 0.9;
    arms[0].rotation.z += (0 - arms[0].rotation.z) * t;
    arms[1].rotation.z += (0 - arms[1].rotation.z) * t;
    model.position.y = Math.abs(Math.sin(state.walkPhase)) * 0.05 * m
      + Math.sin(state.walkPhase * 0.4) * 0.008 * (1 - m);
  } else {
    for (const [i, a] of arms.entries()) {
      a.rotation.x += (-2.6 - a.rotation.x) * t;
      a.rotation.z += ((i === 0 ? -0.3 : 0.3) - a.rotation.z) * t;
    }
    legs[0].rotation.x += (0.5 - legs[0].rotation.x) * t;
    legs[1].rotation.x += (-0.2 - legs[1].rotation.x) * t;
    model.position.y = 0;
  }
}

export class Avatar {
  constructor(scene, physics) {
    this.cfg = CONFIG.player;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.parts = buildBlockPerson();
    this.model = this.parts.model;
    this.root.add(this.model);

    const body = new CANNON.Body({
      mass: 55,
      material: physics.materials.player,
      fixedRotation: true,
      linearDamping: 0,
      allowSleep: false,
    });
    const r = 0.28;
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, r, 0));
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, 0.8, 0));
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, 1.32, 0));
    const sp = this.cfg.spawn;
    body.position.set(sp.x, sp.y, sp.z);
    body.collisionFilterGroup = 2; // 사람 그룹: 배구 네트는 지나갈 수 있음
    physics.world.addBody(body);
    this.body = body;
    this.world = physics.world;

    this.heading = Math.PI;
    this.model.rotation.y = this.heading;
    this.grounded = false;
    this.groundTimer = 0;
    this.jumpCooldown = 0;
    this.anim = { walkPhase: 0, moveAmount: 0, grounded: true };

    // 동작 애니메이션 상태
    this.action = null;      // 'kick' | 'throw' | 'swing' | 'toss' | 'pull'
    this.actionTime = 0;
    this.holdPose = null;    // null | 'one' | 'two' | 'overhead' | 'racket'
    this.charge = 0;         // 던지기 힘 모으는 중 (0~1)
    this.dribble = false;
    this.activity = null;    // 'rope' | 'hoop' (줄넘기·훌라후프 하는 중)
    this.activityPhase = 0;  // 줄 각도 / 후프 각도
    this.hopY = 0;           // 줄넘기 점프 높이 (화면용)
  }

  get wearingFlags() {
    return this.parts.belt.visible;
  }
  setWearingFlags(on) {
    this.parts.belt.visible = on;
    for (const f of this.parts.flags) f.visible = true;
  }

  playAction(name) {
    this.action = name;
    this.actionTime = 0;
  }

  // 아바타가 바라보는 앞 방향 (수평 단위 벡터)
  forward(out) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  faceDirection(x, z) {
    this.heading = Math.atan2(x, z);
  }

  applyInput(dt, moveDir, jump) {
    const v = this.body.velocity;
    const speed = this.cfg.walkSpeed * (this.charge > 0 ? 0.5 : 1);
    const mag = Math.min(1, Math.hypot(moveDir.x, moveDir.z));
    const tx = moveDir.x * speed, tz = moveDir.z * speed;
    const k = Math.min(1, (this.grounded ? 18 : 4) * dt);
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;
    v.y -= this.cfg.extraGravity * dt;

    this.jumpCooldown -= dt;
    if (jump && this.groundTimer > 0 && this.jumpCooldown <= 0) {
      v.y = this.cfg.jumpSpeed;
      this.groundTimer = 0;
      this.grounded = false;
      this.jumpCooldown = 0.25;
    }

    if (mag > 0.05) {
      const target = Math.atan2(moveDir.x, moveDir.z);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, 12 * dt);
    }
    this.anim.moveAmount += (mag - this.anim.moveAmount) * Math.min(1, 10 * dt);
  }

  afterPhysics(dt) {
    let onGround = false;
    for (const c of this.world.contacts) {
      if (c.bi !== this.body && c.bj !== this.body) continue;
      const other = c.bi === this.body ? c.bj : c.bi;
      if (other.type === CANNON.Body.DYNAMIC && other.mass < 5) continue; // 공 위에 선 것은 땅이 아님
      const ny = c.bi === this.body ? -c.ni.y : c.ni.y;
      if (ny > 0.5) { onGround = true; break; }
    }
    this.grounded = onGround;
    this.anim.grounded = onGround;
    this.groundTimer = onGround ? 0.12 : this.groundTimer - dt;

    if (this.body.position.y < -5) this.respawn();

    const p = this.body.interpolatedPosition;
    this.root.position.set(p.x, p.y, p.z);
    this.model.rotation.y = this.heading;

    animatePerson(this.parts, this.anim, dt);
    this.animateActions(dt);
  }

  // 들기 자세·동작 애니메이션 (걷기 애니메이션 위에 덮어씀)
  animateActions(dt) {
    const [rArm, lArm] = this.parts.arms; // arms[0] = 오른팔(-x), arms[1] = 왼팔
    const [rLeg] = this.parts.legs;
    const t = Math.min(1, 14 * dt);

    if (this.holdPose === 'two') {
      rArm.rotation.x += (-1.2 - rArm.rotation.x) * t;
      lArm.rotation.x += (-1.2 - lArm.rotation.x) * t;
      rArm.rotation.z += (0.25 - rArm.rotation.z) * t;
      lArm.rotation.z += (-0.25 - lArm.rotation.z) * t;
    } else if (this.holdPose === 'overhead') {
      rArm.rotation.x += (-2.9 - rArm.rotation.x) * t;
      lArm.rotation.x += (-2.9 - lArm.rotation.x) * t;
    } else if (this.holdPose === 'one' || this.holdPose === 'racket') {
      if (this.dribble) {
        rArm.rotation.x = -0.5 + Math.sin(this.anim.walkPhase * 2) * 0.35;
      } else {
        rArm.rotation.x += (-0.9 - rArm.rotation.x) * t;
      }
    }

    if (this.holdPose === 'rope' || this.activity === 'rope') {
      // 줄넘기: 팔을 옆으로 내리고 손목으로 원 그리기
      const ph = this.activityPhase;
      const spin = this.activity === 'rope' ? 1 : 0;
      rArm.rotation.x = -0.35 + Math.cos(ph) * 0.18 * spin;
      lArm.rotation.x = -0.35 + Math.cos(ph) * 0.18 * spin;
      rArm.rotation.z = -0.38 + Math.sin(ph) * 0.06 * spin;
      lArm.rotation.z = 0.38 - Math.sin(ph) * 0.06 * spin;
    } else if (this.activity === 'hoop') {
      // 훌라후프: 팔을 들고 허리를 돌림
      rArm.rotation.x += (-0.2 - rArm.rotation.x) * t;
      lArm.rotation.x += (-0.2 - lArm.rotation.x) * t;
      rArm.rotation.z += (-1.3 - rArm.rotation.z) * t;
      lArm.rotation.z += (1.3 - lArm.rotation.z) * t;
    }

    // 힘 모으기: 팔을 뒤로
    if (this.charge > 0) {
      const back = this.holdPose === 'two' || this.holdPose === 'overhead' ? -3.0 : -2.6;
      rArm.rotation.x += (back - rArm.rotation.x) * t;
      if (this.holdPose === 'two' || this.holdPose === 'overhead') lArm.rotation.x += (back - lArm.rotation.x) * t;
    }

    if (this.action) {
      this.actionTime += dt;
      const d = 0.3;
      const k = Math.min(1, this.actionTime / d);
      const s = Math.sin(k * Math.PI);
      switch (this.action) {
        case 'kick':
          rLeg.rotation.x = -1.4 * s;
          break;
        case 'throw':
          rArm.rotation.x = -2.8 + 3.2 * k;
          break;
        case 'swing':
          rArm.rotation.x = -2.6 + 3.0 * k;
          rArm.rotation.z = 0.6 * s;
          break;
        case 'toss':
          rArm.rotation.x = -2.8 * s;
          lArm.rotation.x = -2.8 * s;
          break;
        case 'pull':
          rArm.rotation.x = -1.4 * s;
          break;
      }
      if (this.actionTime >= d) this.action = null;
    }

    // 줄넘기 점프 (몸만 살짝 뜸) / 훌라후프 허리 돌리기
    if (this.activity === 'rope') {
      this.model.position.y = this.hopY;
      const tuck = this.hopY > 0.02 ? 0.5 : 0;
      this.parts.legs[0].rotation.x = tuck;
      this.parts.legs[1].rotation.x = tuck;
    } else if (this.activity === 'hoop') {
      const a = this.activityPhase;
      this.model.position.x = Math.cos(a + Math.PI) * 0.04;
      this.model.position.z = Math.sin(a + Math.PI) * 0.04;
    } else {
      this.model.position.x = 0;
      this.model.position.z = 0;
    }
  }

  // 손의 월드 좌표 (right: true 오른손 / false 왼손)
  handPosition(out, right = true) {
    this.root.updateMatrixWorld(true);
    return (right ? this.parts.rightHand : this.parts.leftHand).getWorldPosition(out);
  }

  respawn() {
    const sp = this.cfg.spawn;
    this.body.position.set(sp.x, sp.y + 1, sp.z);
    this.body.velocity.set(0, 0, 0);
  }

  get position() {
    return this.root.position;
  }
}
