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

// ---------- 꾸미기 (남색 체육복은 그대로, 머리·신발·등번호만) ----------
export const LOOK_OPTIONS = {
  hairStyles: ['기본', '짧게', '단발', '묶음'],
  hairColors: ['#2b2220', '#6b3e1f', '#b07a45', '#e0b34a', '#3a6fd8', '#ff7fb0'],
  shoeColors: ['#f5f5f5', '#2b2b2b', '#e63946', '#2a5bd7', '#ffd23f', '#2ec4b6'],
};
export const DEFAULT_LOOK = { h: 0, c: 0, s: 0, n: 7 };

// 저장·전송용 짧은 글자 "머리.색.신발.번호" ↔ 객체
export function encodeLook(l) {
  return [l.h, l.c, l.s, l.n].join('.');
}
export function decodeLook(str) {
  const f = String(str || '').split('.').map((v) => parseInt(v, 10));
  if (f.length < 4 || f.some((v) => !Number.isFinite(v))) return null;
  return cleanLook({ h: f[0], c: f[1], s: f[2], n: f[3] });
}
export function cleanLook(l) {
  const O = LOOK_OPTIONS;
  const int = (v, max, d) => (Number.isInteger(v) && v >= 0 && v <= max ? v : d);
  l = l || {};
  return {
    h: int(l.h, O.hairStyles.length - 1, 0),
    c: int(l.c, O.hairColors.length - 1, 0),
    s: int(l.s, O.shoeColors.length - 1, 0),
    n: int(l.n, 99, 7),
  };
}

// 등번호 그림 (체육복 등에 붙는 판)
function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData = {
    set(num) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 64, 64);
      g.fillStyle = '#ffffff';
      g.font = 'bold 46px "Arial Black", "Pretendard", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(num), 32, 35, 60);
      t.needsUpdate = true;
    },
  };
  t.userData.set(n);
  return t;
}

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
// look 을 주면 꾸미기 가능한 모델 (머리 모양·색, 신발색, 등번호) → applyLook(parts, look) 로 바꿈
export function buildBlockPerson(colors = SUIT_COLORS, look = null) {
  const C = { ...SUIT_COLORS, ...colors };
  const model = new THREE.Group();
  const p = part;

  const legs = [];
  const shoes = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.13, 0.72, 0);
    model.add(hip);
    p(0.2, 0.62, 0.22, C.suitDark, 0, -0.31, 0, hip);
    p(0.03, 0.6, 0.23, C.stripe, s * 0.1, -0.3, 0, hip);
    const shoe = p(0.22, 0.1, 0.3, C.shoe, 0, -0.67, 0.04, hip);
    shoes.push(shoe);
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
  // 머리 모양 (꾸미기용 모델은 4가지를 모두 만들어 두고 하나만 보이게)
  const hairStyles = [];
  const styleCount = look ? LOOK_OPTIONS.hairStyles.length : 1;
  for (let i = 0; i < styleCount; i++) {
    const g = new THREE.Group();
    head.add(g);
    if (i === 1) {
      // 짧게: 위와 뒤만 얇게
      p(0.44, 0.08, 0.42, C.hair, 0, 0.215, -0.01, g);
      p(0.44, 0.2, 0.06, C.hair, 0, 0.11, -0.2, g);
      p(0.04, 0.12, 0.3, C.hair, -0.215, 0.14, -0.05, g);
      p(0.04, 0.12, 0.3, C.hair, 0.215, 0.14, -0.05, g);
    } else {
      p(0.46, 0.13, 0.44, C.hair, 0, 0.21, -0.01, g);
      p(0.46, 0.34, 0.1, C.hair, 0, 0.06, -0.2, g);
      p(0.06, 0.24, 0.36, C.hair, -0.22, 0.08, -0.03, g);
      p(0.06, 0.24, 0.36, C.hair, 0.22, 0.08, -0.03, g);
      p(0.3, 0.07, 0.06, C.hair, 0, 0.16, 0.19, g);
      if (i === 2) {
        // 단발: 옆·뒤가 턱까지
        p(0.48, 0.3, 0.12, C.hair, 0, -0.12, -0.19, g);
        p(0.07, 0.3, 0.3, C.hair, -0.225, -0.1, -0.04, g);
        p(0.07, 0.3, 0.3, C.hair, 0.225, -0.1, -0.04, g);
      } else if (i === 3) {
        // 묶음: 뒤통수에 머리끈 + 꽁지
        p(0.1, 0.06, 0.06, '#ff5fa2', 0, 0.08, -0.27, g);
        p(0.13, 0.24, 0.12, C.hair, 0, -0.06, -0.3, g);
      }
    }
    g.visible = i === 0;
    hairStyles.push(g);
  }
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

  // 등번호 (꾸미기용 모델만)
  let numberTex = null;
  if (look) {
    numberTex = numberTexture(look.n);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      new THREE.MeshBasicMaterial({ map: numberTex, transparent: true, depthWrite: false })
    );
    plate.position.set(0, 1.04, -0.152);
    plate.rotation.y = Math.PI;
    model.add(plate);
  }

  const parts = { model, legs, arms, head, rightHand, leftHand, belt, flags, hairStyles, shoes, numberTex };
  if (look) {
    // 머리·신발은 사람마다 색이 달라서 재질을 따로 씀
    const hairMat = new THREE.MeshLambertMaterial({ color: C.hair });
    for (const g of hairStyles) g.traverse((m) => { if (m.isMesh && m.material.color.getHexString() === new THREE.Color(C.hair).getHexString()) m.material = hairMat; });
    const shoeMat = new THREE.MeshLambertMaterial({ color: C.shoe });
    for (const sh of shoes) sh.material = shoeMat;
    parts.hairMat = hairMat;
    parts.shoeMat = shoeMat;
    applyLook(parts, look);
  }
  return parts;
}

// 꾸미기 적용 (모양 바꾸기)
export function applyLook(parts, look) {
  const l = cleanLook(look);
  if (!parts.hairMat) return l;
  parts.hairStyles.forEach((g, i) => { g.visible = i === l.h; });
  parts.hairMat.color.set(LOOK_OPTIONS.hairColors[l.c]);
  parts.shoeMat.color.set(LOOK_OPTIONS.shoeColors[l.s]);
  if (parts.lookN !== l.n) {
    parts.numberTex.userData.set(l.n);
    parts.lookN = l.n;
  }
  parts.look = l;
  return l;
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
    this.parts = buildBlockPerson(SUIT_COLORS, DEFAULT_LOOK);
    this.look = this.parts.look;
    this.model = this.parts.model;
    this.root.add(this.model);
    this.fade = 1;

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
    // 시작 위치: 여러 명이 겹치지 않게 조금씩 흩어서
    const sp = this.cfg.spawn;
    body.position.set(sp.x + (Math.random() - 0.5) * 3, sp.y, sp.z + (Math.random() - 0.5) * 3);
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
    this.flagsLeft = 2;      // 차고 있는 플래그 수
    this.regrowTimer = 0;
    this.lastAction = '';
    this.calling = 0;        // '패스!' 손들기 남은 시간(초)
  }

  get wearingFlags() {
    return this.parts.belt.visible;
  }

  setLook(look) {
    this.look = applyLook(this.parts, look);
  }

  // 카메라가 아주 가까우면 내 아바타를 반투명하게 (앞을 가리지 않게)
  setFade(a) {
    a = Math.round(a * 20) / 20;
    if (a === this.fade) return;
    this.fade = a;
    if (!this.fadeMats) {
      // 다른 사람과 같이 쓰는 재질은 복사해서 내 것만 바꿈
      this.fadeMats = [];
      const copies = new Map();
      this.model.traverse((m) => {
        if (!m.isMesh) return;
        let mat = m.material;
        if (mat !== this.parts.hairMat && mat !== this.parts.shoeMat && !mat.map) {
          if (!copies.has(mat)) copies.set(mat, mat.clone());
          mat = copies.get(mat);
          m.material = mat;
        }
        if (!this.fadeMats.includes(mat)) this.fadeMats.push(mat);
      });
    }
    for (const mat of this.fadeMats) {
      const tr = a < 1 || !!mat.map;
      if (mat.transparent !== tr) mat.needsUpdate = true; // 불투명으로 만들어진 재질은 다시 준비해야 투명해짐
      mat.transparent = tr;
      mat.opacity = a;
      mat.depthWrite = a >= 1 && !mat.map;
    }
  }
  setWearingFlags(on) {
    this.parts.belt.visible = on;
    this.flagsLeft = 2;
    this.regrowTimer = 0;
    for (const f of this.parts.flags) f.visible = true;
  }

  // 친구에게 플래그를 뺏김 (2개 다 뺏기면 3초 뒤 다시 생김)
  loseFlag() {
    if (!this.wearingFlags || this.flagsLeft <= 0) return;
    this.flagsLeft--;
    this.parts.flags[this.flagsLeft].visible = false;
    if (this.flagsLeft === 0) this.regrowTimer = 3;
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

    if (this.regrowTimer > 0) {
      this.regrowTimer -= dt;
      if (this.regrowTimer <= 0) this.setWearingFlags(this.wearingFlags);
    }
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

    // '패스!' 손들기: 손이 비었을 때 오른팔을 번쩍
    if (this.calling && !this.holdPose) {
      rArm.rotation.x += (-3.0 - rArm.rotation.x) * t;
      rArm.rotation.z += (-0.25 - rArm.rotation.z) * t;
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
    this.body.position.set(sp.x + (Math.random() - 0.5) * 3, sp.y + 1, sp.z + (Math.random() - 0.5) * 3);
    this.body.velocity.set(0, 0, 0);
  }

  get position() {
    return this.root.position;
  }
}
