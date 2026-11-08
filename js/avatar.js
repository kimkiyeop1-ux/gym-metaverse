import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from './config.js';

// 블록형 사람 아바타 (남색 체육복)
const C = {
  suit: '#1f2a5c',
  suitDark: '#172047',
  stripe: '#ffffff',
  skin: '#f4cfa6',
  hair: '#2b2220',
  shoe: '#f5f5f5',
  sole: '#cc3344',
  eye: '#222222',
  cheek: '#f29a9a',
};

export class Avatar {
  constructor(scene, physics) {
    this.cfg = CONFIG.player;
    this.root = new THREE.Group();
    this.model = new THREE.Group(); // 방향 회전용
    this.root.add(this.model);
    scene.add(this.root);
    this.buildModel();

    // 물리: 구 3개를 세로로 쌓은 캡슐 비슷한 몸 (회전 고정)
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
    physics.world.addBody(body);
    this.body = body;
    this.world = physics.world;

    this.heading = Math.PI; // 처음엔 -z 방향(체육관 중앙)을 바라봄
    this.model.rotation.y = this.heading;
    this.grounded = false;
    this.groundTimer = 0; // 땅에서 떨어진 직후 잠깐 점프 허용
    this.jumpCooldown = 0;
    this.walkPhase = 0;
    this.moveAmount = 0;
  }

  part(w, h, d, color, x, y, z, parent) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  buildModel() {
    const g = this.model;
    const p = this.part.bind(this);

    // 다리 (엉덩이 관절 기준)
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.13, 0.72, 0);
      g.add(hip);
      p(0.2, 0.62, 0.22, C.suitDark, 0, -0.31, 0, hip);
      p(0.03, 0.6, 0.23, C.stripe, s * 0.1, -0.3, 0, hip); // 바지 옆줄
      p(0.22, 0.1, 0.3, C.shoe, 0, -0.67, 0.04, hip);
      p(0.22, 0.03, 0.3, C.sole, 0, -0.715, 0.04, hip);
      this.legs.push(hip);
    }

    // 몸통
    p(0.52, 0.56, 0.3, C.suit, 0, 1.0, 0, g);
    p(0.53, 0.04, 0.31, C.stripe, 0, 0.74, 0, g); // 허리선
    p(0.2, 0.06, 0.02, C.stripe, 0, 1.24, 0.155, g); // 목 깃
    p(0.12, 0.12, 0.02, '#ffd23f', 0.13, 1.12, 0.155, g); // 가슴 학교 마크

    // 팔 (어깨 관절 기준)
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.35, 1.22, 0);
      g.add(sh);
      p(0.16, 0.46, 0.18, C.suit, 0, -0.21, 0, sh);
      p(0.03, 0.44, 0.19, C.stripe, s * 0.08, -0.2, 0, sh);
      p(0.14, 0.12, 0.15, C.skin, 0, -0.5, 0, sh);
      this.arms.push(sh);
    }

    // 머리
    const head = new THREE.Group();
    head.position.set(0, 1.5, 0);
    g.add(head);
    this.head = head;
    p(0.42, 0.42, 0.4, C.skin, 0, 0, 0, head);
    p(0.46, 0.13, 0.44, C.hair, 0, 0.21, -0.01, head);   // 윗머리
    p(0.46, 0.34, 0.1, C.hair, 0, 0.06, -0.2, head);     // 뒷머리
    p(0.06, 0.24, 0.36, C.hair, -0.22, 0.08, -0.03, head);
    p(0.06, 0.24, 0.36, C.hair, 0.22, 0.08, -0.03, head);
    p(0.3, 0.07, 0.06, C.hair, 0, 0.16, 0.19, head);     // 앞머리
    p(0.06, 0.08, 0.02, C.eye, -0.09, 0.02, 0.205, head);
    p(0.06, 0.08, 0.02, C.eye, 0.09, 0.02, 0.205, head);
    p(0.07, 0.04, 0.02, C.cheek, -0.14, -0.07, 0.202, head);
    p(0.07, 0.04, 0.02, C.cheek, 0.14, -0.07, 0.202, head);
    p(0.08, 0.025, 0.02, '#a0523d', 0, -0.1, 0.205, head); // 입
  }

  // 물리 스텝 전에 호출: moveDir 는 월드 기준 (x,z), 크기 0~1
  applyInput(dt, moveDir, jump) {
    const v = this.body.velocity;
    const speed = this.cfg.walkSpeed;
    const mag = Math.min(1, Math.hypot(moveDir.x, moveDir.z));

    // 공중에서는 방향 전환을 조금 느리게
    const tx = moveDir.x * speed, tz = moveDir.z * speed;
    const k = Math.min(1, (this.grounded ? 18 : 4) * dt);
    v.x += (tx - v.x) * k;
    v.z += (tz - v.z) * k;

    // 추가 중력 (점프가 경쾌하게)
    v.y -= this.cfg.extraGravity * dt;

    this.jumpCooldown -= dt;
    if (jump && this.groundTimer > 0 && this.jumpCooldown <= 0) {
      v.y = this.cfg.jumpSpeed;
      this.groundTimer = 0;
      this.grounded = false;
      this.jumpCooldown = 0.25;
    }

    // 바라보는 방향
    if (mag > 0.05) {
      const target = Math.atan2(moveDir.x, moveDir.z);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, 12 * dt);
    }
    this.moveAmount += (mag - this.moveAmount) * Math.min(1, 10 * dt);
  }

  // 물리 스텝 후 호출: 땅 판정 + 화면 갱신 + 애니메이션
  afterPhysics(dt) {
    let onGround = false;
    for (const c of this.world.contacts) {
      if (c.bi !== this.body && c.bj !== this.body) continue;
      // ni 는 bi → bj 방향. 아바타 기준 '위로 받치는' 법선인지 확인
      const ny = c.bi === this.body ? -c.ni.y : c.ni.y;
      if (ny > 0.5) { onGround = true; break; }
    }
    this.grounded = onGround;
    this.groundTimer = onGround ? 0.12 : this.groundTimer - dt;

    // 체육관 밖으로 떨어지면 다시 시작 위치로
    if (this.body.position.y < -5) this.respawn();

    const p = this.body.interpolatedPosition;
    this.root.position.set(p.x, p.y, p.z);
    this.model.rotation.y = this.heading;

    this.animate(dt);
  }

  animate(dt) {
    const m = this.moveAmount;
    if (this.grounded) {
      this.walkPhase += dt * (4 + 7 * m);
      const swing = Math.sin(this.walkPhase) * 0.75 * m;
      this.legs[0].rotation.x = swing;
      this.legs[1].rotation.x = -swing;
      this.arms[0].rotation.x = -swing * 0.9;
      this.arms[1].rotation.x = swing * 0.9;
      this.arms[0].rotation.z = 0;
      this.arms[1].rotation.z = 0;
      // 걸을 때 살짝 통통 튀는 느낌
      this.model.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.05 * m
        + Math.sin(this.walkPhase * 0.4) * 0.008 * (1 - m);
    } else {
      // 공중: 팔을 위로, 다리 살짝 굽힘
      const t = Math.min(1, 10 * dt);
      for (const [i, a] of this.arms.entries()) {
        a.rotation.x += (-2.6 - a.rotation.x) * t;
        a.rotation.z += ((i === 0 ? -0.3 : 0.3) - a.rotation.z) * t;
      }
      this.legs[0].rotation.x += (0.5 - this.legs[0].rotation.x) * t;
      this.legs[1].rotation.x += (-0.2 - this.legs[1].rotation.x) * t;
      this.model.position.y = 0;
    }
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
