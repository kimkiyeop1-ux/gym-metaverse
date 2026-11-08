import * as THREE from 'three';
import { storage } from './storage.js';
import { hoopQuaternion } from './items.js';

// ============================================================
//  줄넘기: 줄이 발밑으로 올 때 맞춰 [뛰기] → 성공하면 횟수 +1, 놓치면 걸림
// ============================================================
const ROPE_SEGMENTS = 18;
const HOP_TIME = 0.42;   // 한 번 뛰어 떠 있는 시간
const HOP_HEIGHT = 0.22;

export class JumpRope {
  constructor(scene, avatar, hud) {
    this.avatar = avatar;
    this.hud = hud;
    this.active = false;     // 줄을 들고 있음
    this.spinning = false;   // 줄이 돌아가는 중
    this.phase = Math.PI;    // 0 = 머리 위, π = 발밑
    this.speed = 0;
    this.hopT = -1;
    this.count = 0;
    this.best = storage.get('jumprope_best', 0);
    this.message = '';
    this.msgTimer = 0;

    // 줄: 짧은 막대 여러 개를 이어서 표시 (가볍게)
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const mat = new THREE.MeshLambertMaterial({ color: '#ff8c1a' });
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    this.segs = [];
    for (let i = 0; i < ROPE_SEGMENTS; i++) {
      const m = new THREE.Mesh(geo, mat);
      this.group.add(m);
      this.segs.push(m);
    }
    const hMat = new THREE.MeshLambertMaterial({ color: '#e63946' });
    this.handles = [0, 1].map(() => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.15), hMat);
      this.group.add(h);
      return h;
    });
    this.pts = Array.from({ length: ROPE_SEGMENTS + 1 }, () => new THREE.Vector3());
    this.hl = new THREE.Vector3();
    this.hr = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
  }

  pickUp() {
    this.active = true;
    this.spinning = false;
    this.phase = Math.PI;
    this.count = 0;
    this.group.visible = true;
    this.avatar.holdPose = 'rope';
  }

  putDown() {
    this.active = false;
    this.spinning = false;
    this.group.visible = false;
    this.avatar.activity = null;
    this.avatar.hopY = 0;
    this.hud.setCounter(null);
  }

  // [뛰기] 버튼
  press() {
    if (!this.spinning) {
      this.spinning = true;
      this.phase = 0.2;
      this.speed = (Math.PI * 2) / 0.95;
      this.count = 0;
      this.hopT = -1;
      this.avatar.activity = 'rope';
      return;
    }
    if (this.hopT < 0) this.hopT = 0;
  }

  update(dt) {
    if (!this.active) return;
    const a = this.avatar;
    if (this.spinning) {
      const before = this.phase;
      this.phase += this.speed * dt;
      if (this.hopT >= 0) {
        this.hopT += dt;
        if (this.hopT > HOP_TIME) this.hopT = -1;
      }
      a.hopY = this.hopT >= 0 ? HOP_HEIGHT * Math.sin((Math.PI * this.hopT) / HOP_TIME) : 0;
      // 줄이 발밑(π)을 지나는 순간 판정
      const bottom = Math.PI;
      const wrapped = ((before % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (wrapped < bottom && wrapped + this.speed * dt >= bottom) {
        if (a.hopY > 0.05) {
          this.count++;
          this.speed = Math.min((Math.PI * 2) / 0.7, this.speed * 1.01);
          if (this.count > this.best) {
            this.best = this.count;
            storage.set('jumprope_best', this.best);
          }
        } else {
          this.fail();
        }
      }
    } else {
      a.hopY = 0;
    }
    a.activityPhase = this.phase;

    if (this.msgTimer > 0) this.msgTimer -= dt;
    const sub = this.msgTimer > 0 ? this.message
      : this.spinning ? `줄이 발밑에 올 때 [뛰기] · 최고 ${this.best}회`
        : `[뛰기]를 누르면 시작 · 최고 ${this.best}회`;
    this.hud.setCounter('줄넘기', `${this.count}회`, sub);
    this.drawRope();
  }

  fail() {
    this.spinning = false;
    this.avatar.activity = null;
    this.avatar.hopY = 0;
    this.message = `걸렸어요! ${this.count}회 · 다시 [뛰기]`;
    this.msgTimer = 2.5;
    this.phase = Math.PI;
  }

  drawRope() {
    const a = this.avatar;
    a.handPosition(this.hr, true);
    a.handPosition(this.hl, false);
    // 아바타 기준 위·앞 방향
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = a.forward(new THREE.Vector3());
    const ph = this.phase;
    const dir = this.tmp.copy(up).multiplyScalar(Math.cos(ph)).addScaledVector(fwd, Math.sin(ph));
    const footY = a.position.y + 0.03;
    for (let i = 0; i <= ROPE_SEGMENTS; i++) {
      const t = i / ROPE_SEGMENTS;
      const p = this.pts[i].copy(this.hr).lerp(this.hl, t);
      const bulge = Math.pow(Math.sin(Math.PI * t), 0.6) * 1.05;
      p.addScaledVector(dir, bulge);
      if (p.y < footY) p.y = footY; // 바닥 아래로 들어가지 않게
    }
    for (let i = 0; i < ROPE_SEGMENTS; i++) {
      const m = this.segs[i];
      const p0 = this.pts[i], p1 = this.pts[i + 1];
      m.position.copy(p0).add(p1).multiplyScalar(0.5);
      m.scale.z = Math.max(0.01, p0.distanceTo(p1));
      m.lookAt(p1);
    }
    this.handles[0].position.copy(this.hr);
    this.handles[1].position.copy(this.hl);
    this.handles[0].lookAt(this.pts[1]);
    this.handles[1].lookAt(this.pts[ROPE_SEGMENTS - 1]);
  }
}

// ============================================================
//  훌라후프: [돌리기]를 누를 때마다 힘이 더해짐. 힘이 다 빠지면 떨어짐
// ============================================================
export class HulaHoop {
  constructor(avatar, items, hud) {
    this.avatar = avatar;
    this.items = items;
    this.hud = hud;
    this.item = null;
    this.spinning = false;
    this.energy = 0;
    this.angle = 0;
    this.total = 0;
    this.best = storage.get('hulahoop_best', 0);
    this.message = '';
    this.msgTimer = 0;
  }

  get rounds() {
    return Math.floor(this.total / (Math.PI * 2));
  }

  pickUp(item) {
    this.item = item;
    this.spinning = false;
    this.avatar.holdPose = 'hoop';
  }

  putDown() {
    this.item = null;
    this.spinning = false;
    this.avatar.activity = null;
    this.hud.setCounter(null);
  }

  press() {
    if (!this.spinning) {
      this.spinning = true;
      this.energy = 0.75;
      this.total = 0;
      this.avatar.activity = 'hoop';
      return;
    }
    this.energy = Math.min(1, this.energy + 0.28);
  }

  // 반환값: 후프가 떨어졌으면 true (게임에서 손에서 놓음)
  update(dt) {
    const it = this.item;
    if (!it) return false;
    const a = this.avatar;
    const p = a.position;
    const R = it.def.r;
    let dropped = false;
    if (this.spinning) {
      this.energy -= 0.3 * dt;
      const speed = 5 + 9 * Math.max(0, this.energy);
      this.angle += speed * dt;
      this.total += speed * dt;
      a.activityPhase = this.angle;
      if (this.rounds > this.best) {
        this.best = this.rounds;
        storage.set('hulahoop_best', this.best);
      }
      // 허리 둘레를 돌기: 후프 중심이 허리에서 살짝 벗어난 채 회전
      const off = R - 0.2;
      const y = p.y + 0.9 - Math.max(0, 0.25 - this.energy) * 1.2; // 힘이 빠지면 내려감
      it.mesh.position.set(p.x + Math.cos(this.angle) * off, y, p.z + Math.sin(this.angle) * off);
      it.mesh.quaternion.setFromEuler(new THREE.Euler(Math.sin(this.angle) * 0.12, 0, Math.cos(this.angle) * 0.12));
      if (this.energy <= 0) {
        dropped = true;
        this.message = `떨어졌어요! ${this.rounds}바퀴`;
        this.msgTimer = 2.5;
      }
    } else {
      // 들고만 있을 때: 오른쪽 옆에 세워서 듦
      const fwd = a.forward(new THREE.Vector3());
      const rx = -fwd.z, rz = fwd.x;
      it.mesh.position.set(p.x + rx * 0.5, p.y + 0.9, p.z + rz * 0.5);
      hoopQuaternion(it.mesh.quaternion, a.heading + Math.PI / 2, Math.PI / 2, 0);
    }
    if (this.msgTimer > 0) this.msgTimer -= dt;
    const sub = this.msgTimer > 0 ? this.message
      : this.spinning ? `[돌리기]를 계속 눌러 힘 주기 · 최고 ${this.best}바퀴`
        : `[돌리기] 허리로 돌리기 · [굴리기] 바닥에 굴리기`;
    this.hud.setCounter('훌라후프', `${this.spinning ? this.rounds : 0}바퀴`, sub);
    return dropped;
  }
}
