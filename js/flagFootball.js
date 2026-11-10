import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { buildBlockPerson, animatePerson } from './avatar.js';

// 플래그 벨트 바구니 (가까이 가서 착용/벗기)
export class FlagBeltBox {
  constructor(scene, physics, x, z) {
    this.pos = new THREE.Vector3(x, 0, z);
    const g = new THREE.Group();
    g.position.copy(this.pos);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), new THREE.MeshLambertMaterial({ color: '#3b6fb6' }));
    crate.position.y = 0.2;
    g.add(crate);
    const colors = ['#e63946', '#ffd23f', '#e63946', '#2ec4b6', '#ffd23f'];
    colors.forEach((c, i) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.08), new THREE.MeshLambertMaterial({ color: c }));
      f.position.set(-0.24 + i * 0.12, 0.45, (i % 2) * 0.1 - 0.05);
      f.rotation.z = (i - 2) * 0.15;
      g.add(f);
    });
    scene.add(g);
    this.group = g;
    this.world = physics.world;
    this.body = physics.addStaticBox(x, 0.2, z, 0.35, 0.2, 0.25);
    this.active = true;
  }

  // 자유 체육관에만 있음
  setActive(on) {
    this.active = on;
    this.group.visible = on;
    if (on && !this.body.world) this.world.addBody(this.body);
    if (!on && this.body.world) this.world.removeBody(this.body);
  }

  isNear(p, dist = 1.4) {
    return this.active && Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < dist;
  }
}

// 말풍선 (캔버스 → 스프라이트)
export function makeBubble() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.2, 0.45, 1);
  sprite.renderOrder = 10;
  sprite.userData = {
    set(text, bg = '#ffffff', fg = '#1f2a5c') {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (!text) { tex.needsUpdate = true; return; }
      g.fillStyle = bg;
      g.beginPath();
      if (g.roundRect) g.roundRect(6, 6, 244, 66, 24);
      else g.rect(6, 6, 244, 66);
      g.fill();
      g.beginPath();
      g.moveTo(118, 70); g.lineTo(128, 90); g.lineTo(138, 70);
      g.fill();
      g.fillStyle = fg;
      g.font = 'bold 34px "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 128, 40, 230);
      tex.needsUpdate = true;
    },
  };
  return sprite;
}

// 도망치는 연습 친구 (플래그 2개를 차고 있음)
export class PracticeFriend {
  constructor(scene, physics, x, z, bounds) {
    this.bounds = bounds; // {minX, maxX, minZ, maxZ}
    this.root = new THREE.Group();
    scene.add(this.root);
    this.parts = buildBlockPerson({ bib: '#5fd35f', flag: '#ffd23f', hair: '#7a4a26' });
    this.root.add(this.parts.model);
    this.parts.belt.visible = true;

    this.bubble = makeBubble();
    this.bubble.position.y = 2.15;
    this.root.add(this.bubble);
    this.bubbleTimer = 0;

    const body = new CANNON.Body({ mass: 50, fixedRotation: true, material: physics.materials.player, allowSleep: false });
    const r = 0.28;
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, r, 0));
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, 0.8, 0));
    body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, 1.32, 0));
    body.position.set(x, 0.05, z);
    body.collisionFilterGroup = 2;
    physics.world.addBody(body);
    this.body = body;
    this.world = physics.world;
    this.active = true;
    this.home = { x, z };

    this.heading = 0;
    this.anim = { walkPhase: 0, moveAmount: 0, grounded: true };
    this.flagsLeft = 2;
    this.wanderTarget = new THREE.Vector3(x, 0, z);
    this.wanderTimer = 0;
    this.restTimer = 0;     // 플래그를 다 뺏긴 뒤 쉬는 시간
    this.boost = 0;         // 플래그 뺏긴 직후 잠깐 빨라짐
    this.say('같이 놀자!', 2.5);
  }

  say(text, time = 1.6) {
    this.bubble.userData.set(text);
    this.bubbleTimer = time;
    this.bubbleText = text;
  }

  // 말하지 않을 때는 이름표
  showName() {
    this.bubble.userData.set('연습 친구', 'rgba(95,211,95,0.9)', '#ffffff');
    this.bubbleText = '';
  }

  // 여러 명 접속: 방장이 보낸 상태를 따라 그림
  applyRemote(d, dt) {
    const b = this.body;
    if (!this.remote) {
      this.remote = true;
      b.type = CANNON.Body.KINEMATIC;
      b.velocity.set(0, 0, 0);
    }
    const f = String(d.s || '').split(',').map(Number);
    if (f.length < 5) return;
    const k = Math.min(1, 10 * dt);
    const nx = b.position.x + (f[0] - b.position.x) * k;
    const nz = b.position.z + (f[1] - b.position.z) * k;
    b.velocity.set((nx - b.position.x) / Math.max(dt, 0.001), 0, (nz - b.position.z) / Math.max(dt, 0.001));
    b.position.set(nx, 0.0, nz);
    let dh = f[2] - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * k;
    this.anim.moveAmount = f[3];
    if (f[4] !== this.flagsLeft) {
      this.flagsLeft = f[4];
      this.parts.flags.forEach((fl, i) => { fl.visible = i < this.flagsLeft; });
    }
    if ((d.b || '') !== this.remoteBubble) {
      this.remoteBubble = d.b || '';
      if (this.remoteBubble) this.bubble.userData.set(this.remoteBubble);
      else this.showName();
    }
  }

  // 다시 내가 계산하게 됨 (방장이 됨)
  makeLocal() {
    if (!this.remote) return;
    this.remote = false;
    this.body.type = CANNON.Body.DYNAMIC;
    this.body.updateMassProperties();
    this.body.wakeUp();
  }

  get position() {
    return this.root.position;
  }

  // 자유 체육관에만 있음 (경기장에서는 숨김)
  setActive(on) {
    this.active = on;
    this.root.visible = on;
    if (on) this.reset();
    if (on && !this.body.world) this.world.addBody(this.body);
    if (!on && this.body.world) this.world.removeBody(this.body);
  }

  canPull(playerPos) {
    if (!this.active || this.flagsLeft <= 0) return false;
    const p = this.body.position;
    return Math.hypot(p.x - playerPos.x, p.z - playerPos.z) < 1.35;
  }

  pullFlag() {
    if (this.flagsLeft <= 0) return false;
    this.flagsLeft--;
    this.parts.flags[this.flagsLeft].visible = false;
    if (this.flagsLeft > 0) {
      this.say('앗! 한 개 남았다!');
      this.boost = 1.5;
    } else {
      this.say('다 뺏겼다~ 다시 해요!', 3);
      this.restTimer = 3.5;
    }
    return true;
  }

  // 물리 스텝 전
  update(dt, playerPos) {
    if (this.remote) this.makeLocal();
    const b = this.body;
    const p = b.position;
    const B = this.bounds;
    let tx = 0, tz = 0, speed = 0;

    if (this.restTimer > 0) {
      this.restTimer -= dt;
      if (this.restTimer <= 0) {
        this.flagsLeft = 2;
        for (const f of this.parts.flags) f.visible = true;
        this.say('준비됐어! 잡아 봐~');
      }
    } else {
      const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 4.5) {
        // 도망: 플레이어 반대 방향 + 벽에서 밀어내는 힘
        tx = dx / (dist || 1);
        tz = dz / (dist || 1);
        const margin = 2.5;
        if (p.x < B.minX + margin) tx += (B.minX + margin - p.x) * 0.8;
        if (p.x > B.maxX - margin) tx -= (p.x - (B.maxX - margin)) * 0.8;
        if (p.z < B.minZ + margin) tz += (B.minZ + margin - p.z) * 0.8;
        if (p.z > B.maxZ - margin) tz -= (p.z - (B.maxZ - margin)) * 0.8;
        speed = 3.9 + (this.boost > 0 ? 1.2 : 0);
        if (dist < 2 && this.bubbleTimer <= 0 && Math.random() < 0.01) this.say('못 잡지롱~');
      } else {
        // 어슬렁거리기
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0 || Math.hypot(this.wanderTarget.x - p.x, this.wanderTarget.z - p.z) < 0.5) {
          this.wanderTarget.set(
            THREE.MathUtils.lerp(B.minX + 3, B.maxX - 3, Math.random()), 0,
            THREE.MathUtils.lerp(B.minZ + 3, B.maxZ - 3, Math.random())
          );
          this.wanderTimer = 3 + Math.random() * 3;
        }
        tx = this.wanderTarget.x - p.x;
        tz = this.wanderTarget.z - p.z;
        speed = 1.6;
      }
    }
    this.boost -= dt;

    const len = Math.hypot(tx, tz);
    if (len > 0.001) { tx /= len; tz /= len; } else speed = 0;
    const k = Math.min(1, 10 * dt);
    b.velocity.x += (tx * speed - b.velocity.x) * k;
    b.velocity.z += (tz * speed - b.velocity.z) * k;
    b.velocity.y -= 10 * dt;

    if (speed > 0.1) {
      const target = Math.atan2(tx, tz);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * Math.min(1, 8 * dt);
    }
    const m = Math.min(1, Math.hypot(b.velocity.x, b.velocity.z) / 5);
    this.anim.moveAmount += (m - this.anim.moveAmount) * Math.min(1, 10 * dt);

    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) this.showName();
    }
  }

  // 물리 스텝 후
  sync(dt) {
    if (this.body.position.y < -3) this.reset();
    const p = this.body.interpolatedPosition;
    this.root.position.set(p.x, p.y, p.z);
    this.parts.model.rotation.y = this.heading;
    animatePerson(this.parts, this.anim, dt);
  }

  reset() {
    this.body.position.set(this.home.x, 0.05, this.home.z);
    this.body.velocity.set(0, 0, 0);
  }
}
