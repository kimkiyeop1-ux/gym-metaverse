import * as THREE from 'three';
import { JumpRope, HulaHoop } from './activities.js';

// 동작 판단·실행: 지금 할 수 있는 동작을 고르고, 버튼/키 입력에 따라 실행한다.
//   E: 잡기·놓기·플래그 뽑기·플래그 착용
//   Q: 던지기 (꾹 눌러 힘 모으기, 농구공은 골대를 보면 '슛')
//   F: 차기·치기(라켓)·스파이크·띄우기(킨볼)
//   R: 토스 (배구공·빅발리볼)
const CHARGE_TIME = 1.1;      // 힘이 꽉 차는 시간(초)
const SHOT_SWEET = [0.62, 0.78]; // 슛 게이지의 초록 구간
const G = 9.82;

export class Game {
  constructor({ avatar, items, camCtl, input, hud, npc, beltBox, resettables }) {
    Object.assign(this, { avatar, items, camCtl, input, hud, npc, beltBox });
    this.resettables = resettables; // 정리 버튼으로 제자리에 돌릴 기구들
    this.rope = new JumpRope(items.scene, avatar, hud);
    this.hoop = new HulaHoop(avatar, items, hud);
    this.held = null;
    this.charging = false;
    this.power = 0;
    this.actions = [];
    this.flagScore = 0;
    this.v = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.shotTarget = null;
  }

  get goalScore() {
    return this.items.hoops.reduce((s, h) => s + h.goals, 0);
  }

  // 카메라가 보는 수평 방향 (던지기·차기 방향)
  aimDir(out) {
    return this.camCtl.forward(out);
  }

  // ---------------- 지금 가능한 동작 고르기 ----------------
  computeActions() {
    const acts = [];
    const a = this.avatar;
    const pos = a.position;
    const held = this.held;
    const items = this.items;

    // E: 플래그 뽑기 > 플래그 착용/벗기 > 잡기/놓기
    if (this.npc.canPull(pos)) {
      acts.push({ id: 'pull', label: '플래그\n뽑기', key: 'E', color: 'throw' });
    } else if (this.beltBox.isNear(pos)) {
      acts.push(a.wearingFlags
        ? { id: 'unwear', label: '플래그\n벗기', key: 'E' }
        : { id: 'wear', label: '플래그\n착용', key: 'E' });
    }

    this.shotTarget = null;
    if (held) {
      if (held.def.rope) {
        acts.push({ id: 'rope', label: '뛰기', key: 'F', color: 'kick' });
      } else if (held.def.hoop) {
        acts.push({ id: 'spin', label: '돌리기', key: 'F', color: 'kick' });
        if (!this.hoop.spinning) acts.push({ id: 'roll', label: '굴리기', key: 'Q', color: 'throw' });
      } else if (held.def.racket) {
        acts.push({ id: 'hit', label: '치기', key: 'F', color: 'kick' });
      } else {
        if (held.type === 'basketball') this.shotTarget = this.findShotTarget();
        acts.push({ id: 'throw', label: this.shotTarget ? '슛' : '던지기', key: 'Q', hold: true, color: 'throw' });
        if (held.def.toss) acts.push({ id: 'toss', label: '토스', key: 'R', color: 'toss' });
        if (held.def.kick) acts.push({ id: 'kick', label: '차기', key: 'F', color: 'kick' });
      }
      if (!acts.some((x) => x.key === 'E')) acts.push({ id: 'drop', label: '놓기', key: 'E' });
    } else {
      // 공중에 뜬 배구공 근처: 점프 중이면 스파이크, 아니면 토스
      const air = this.findAirBall();
      if (air && !a.grounded && air.def.spike) {
        acts.push({ id: 'spike', label: '스파\n이크', key: 'F', color: 'kick', target: air });
      } else if (air) {
        acts.push({ id: 'toss', label: '토스', key: 'R', color: 'toss', target: air });
      }
      if (!acts.some((x) => x.key === 'E')) {
        const g = items.nearest(pos, 0.75, (it) => it.def.hold && it.body.position.y < 2.2);
        if (g) acts.push({ id: 'grab', label: '잡기', key: 'E', target: g });
      }
      if (!acts.some((x) => x.key === 'F')) {
        const kin = items.nearest(pos, 0.8, (it) => it.def.lift);
        const kick = items.nearest(pos, 0.7, (it) => it.def.kick && it.body.position.y < 0.6 + it.def.r);
        if (kin) acts.push({ id: 'lift', label: '띄우기', key: 'F', color: 'kick', target: kin });
        else if (kick) acts.push({ id: 'kick', label: '차기', key: 'F', color: 'kick', target: kick });
      }
    }
    return acts.slice(0, 4);
  }

  findAirBall() {
    const p = this.avatar.position;
    let best = null, bestD = 1.7;
    for (const it of this.items.list) {
      if (it.held || !it.def.toss) continue;
      const b = it.body.position;
      if (b.y < 0.9 + it.def.r || b.y > p.y + 3.2) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z) - it.def.r;
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // 농구공을 들고 골대 쪽을 보고 있으면 슛 대상
  findShotTarget() {
    const p = this.avatar.position;
    this.aimDir(this.fwd);
    let best = null, bestScore = Infinity;
    for (const h of this.items.hoops) {
      const dx = h.x - p.x, dz = h.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 11 || d < 1.5) continue;
      const ang = Math.acos(THREE.MathUtils.clamp((dx * this.fwd.x + dz * this.fwd.z) / d, -1, 1));
      if (ang < 0.6 && ang * d < bestScore) { bestScore = ang * d; best = h; }
    }
    return best;
  }

  // ---------------- 매 프레임 ----------------
  update(dt) {
    const input = this.input;
    this.actions = this.computeActions();
    this.hud.setActions(this.actions);

    // 줄넘기 중에는 점프 버튼/스페이스도 '뛰기'
    if (this.held && this.held.def.rope && input.consume('jump')) this.rope.press();

    // 눌린 입력 → 동작
    for (const token of [...input.pressed]) {
      let act = null;
      if (token.startsWith('key:')) act = this.actions.find((x) => x.key === token.slice(4));
      else act = this.actions.find((x) => x.id === token);
      if (act) this.run(act, token);
    }

    // 던지기 힘 모으기
    if (this.charging) {
      const stillHeld = input.isHeld(this.chargeToken);
      this.power = Math.min(1, this.power + dt / CHARGE_TIME);
      this.avatar.charge = this.power || 0.01;
      if (!stillHeld || !this.held) this.release();
    }

    const throwable = this.held && !this.held.def.racket;
    this.hud.setAim(!!throwable);
    if (this.charging) {
      this.hud.setGauge(this.power, this.shotTarget ? SHOT_SWEET : null, this.shotTarget ? '초록에서 떼면 골!' : '힘');
    } else {
      this.hud.setGauge(null);
    }

    this.hud.setScore(this.goalScore, this.flagScore);

    this.rope.update(dt);
    if (this.hoop.update(dt)) this.dropHoopAtFeet();
  }

  // 줄넘기·훌라후프 하는 중에는 걷지 않음
  get movementLocked() {
    return this.rope.spinning || this.hoop.spinning;
  }

  dropHoopAtFeet() {
    const it = this.held;
    if (!it) return;
    const p = this.avatar.position;
    this.items.setHeld(it, false);
    it.body.position.set(p.x, 0.04, p.z);
    it.body.quaternion.set(0, 0, 0, 1);
    it.body.velocity.set(0, 0, 0);
    this.clearHeld();
  }

  run(act, token) {
    const a = this.avatar;
    switch (act.id) {
      case 'grab': return this.grab(act.target);
      case 'drop': return this.drop();
      case 'throw':
        this.charging = true;
        this.chargeToken = token;
        this.power = 0;
        return;
      case 'kick': return this.kick(act.target || this.held);
      case 'lift': return this.lift(act.target);
      case 'toss': return this.toss(act.target || this.held);
      case 'spike': return this.spike(act.target);
      case 'hit': return this.hit();
      case 'rope': return this.rope.press();
      case 'spin': return this.hoop.press();
      case 'roll': return this.rollHoop();
      case 'pull':
        a.playAction('pull');
        if (this.npc.pullFlag()) {
          this.flagScore++;
          this.hud.popup('🚩 플래그!');
        }
        return;
      case 'wear':
        a.setWearingFlags(true);
        this.hud.popup('플래그 착용!');
        return;
      case 'unwear':
        a.setWearingFlags(false);
        return;
    }
  }

  faceAim() {
    this.aimDir(this.fwd);
    this.avatar.faceDirection(this.fwd.x, this.fwd.z);
    return this.fwd;
  }

  // ---------------- 들기 ----------------
  grab(it) {
    if (!it || this.held) return;
    this.items.setHeld(it, true);
    this.held = it;
    this.avatar.holdPose = it.def.hold;
    if (it.def.rope) {
      it.mesh.visible = false;
      this.rope.pickUp();
    }
    if (it.def.hoop) this.hoop.pickUp(it);
    if (it.def.racket) {
      // 라켓은 오른손에 붙임 (헤드가 위·앞으로)
      const hand = this.avatar.parts.rightHand;
      hand.add(it.mesh);
      it.mesh.position.set(0, 0, 0.02);
      it.mesh.rotation.set(Math.PI / 2 + 0.3, 0, 0);
      it.mesh.quaternion.setFromEuler(it.mesh.rotation);
    }
  }

  drop() {
    const it = this.held;
    if (!it) return;
    const a = this.avatar;
    a.forward(this.fwd);
    const p = a.position;
    if (it.mesh.parent !== this.items.scene) this.items.scene.add(it.mesh);
    this.items.setHeld(it, false);
    const y = it.def.racket ? 0.3 : Math.max(it.def.r + 0.05, 0.5);
    it.body.position.set(p.x + this.fwd.x * (0.5 + it.def.r), y, p.z + this.fwd.z * (0.5 + it.def.r));
    it.body.velocity.set(a.body.velocity.x * 0.5, 0, a.body.velocity.z * 0.5);
    this.clearHeld();
  }

  clearHeld() {
    const it = this.held;
    if (it && it.def.rope) {
      it.mesh.visible = true;
      this.rope.putDown();
    }
    if (it && it.def.hoop) this.hoop.putDown();
    this.held = null;
    this.avatar.holdPose = null;
    this.avatar.dribble = false;
    this.avatar.charge = 0;
    this.charging = false;
  }

  // 물리 계산 후: 들고 있는 물건 위치 맞추기 (드리블 포함)
  postPhysics() {
    this.holdItem();
  }

  holdItem() {
    const it = this.held;
    const a = this.avatar;
    a.dribble = false;
    if (!it || it.def.racket || it.def.rope || it.def.hoop) return;
    const p = a.position;
    a.forward(this.fwd);
    this.right.set(-this.fwd.z, 0, this.fwd.x); // 아바타 기준 오른쪽
    const r = it.def.r;
    let x, y, z;
    if (this.charging) {
      // 던지기 준비: 머리 위
      x = p.x - this.fwd.x * 0.1;
      y = p.y + 1.9 + r;
      z = p.z - this.fwd.z * 0.1;
    } else if (it.def.hold === 'two') {
      x = p.x + this.fwd.x * (0.3 + r);
      y = p.y + 1.05;
      z = p.z + this.fwd.z * (0.3 + r);
    } else if (it.def.dribble && a.grounded && a.anim.moveAmount > 0.25) {
      // 드리블: 오른손 앞에서 바닥까지 통통
      a.dribble = true;
      const bounce = Math.abs(Math.cos(a.anim.walkPhase));
      x = p.x + this.fwd.x * 0.45 + this.right.x * 0.28;
      z = p.z + this.fwd.z * 0.45 + this.right.z * 0.28;
      y = p.y + r + (0.75 - r) * bounce;
    } else {
      x = p.x + this.fwd.x * (0.32 + r) + this.right.x * 0.12;
      y = p.y + 0.95;
      z = p.z + this.fwd.z * (0.32 + r) + this.right.z * 0.12;
    }
    it.body.position.set(x, y, z);
    it.mesh.position.set(x, y, z);
    if (it.def.glide || it.def.spiral) it.mesh.quaternion.setFromEuler(new THREE.Euler(0, a.heading, 0));
  }

  // ---------------- 던지기 ----------------
  release() {
    const it = this.held;
    const power = this.power;
    this.charging = false;
    this.avatar.charge = 0;
    if (!it) return;
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('throw');
    const start = this.v.set(a.position.x + dir.x * 0.3, a.position.y + 1.9 + it.def.r, a.position.z + dir.z * 0.3);
    it.body.position.set(start.x, start.y, start.z);

    if (this.shotTarget) {
      const vel = this.shotVelocity(start, this.shotTarget, power);
      this.clearHeld();
      this.items.launch(it, vel.x, vel.y, vel.z);
      return;
    }

    const [vmin, vmax] = it.def.throwSpeed;
    const speed = vmin + (vmax - vmin) * power;
    // 위아래 각도: 카메라를 위로 올려 볼수록 높게
    let elev = THREE.MathUtils.clamp(0.32 + (0.35 - this.camCtl.pitch) * 0.9, -0.15, 1.2);
    if (it.def.glide) elev = 0.08;
    const ch = Math.cos(elev), sh = Math.sin(elev);
    this.clearHeld();
    this.items.launch(it, dir.x * speed * ch, speed * sh, dir.z * speed * ch, it.def.glide ? 25 : 0);
  }

  // 림 중앙을 지나는 포물선 속도. 힘이 초록 구간에서 벗어날수록 짧거나 길어짐
  shotVelocity(start, hoop, power) {
    const dx = hoop.x - start.x, dz = hoop.z - start.z;
    const d = Math.hypot(dx, dz);
    const h = hoop.y + 0.02 - start.y;
    let theta = d < 2.5 ? 1.22 : 1.08; // 발사 각도: 높은 포물선이라야 림에 깔끔히 들어감
    let v2 = -1;
    for (let i = 0; i < 6 && v2 <= 0; i++) {
      const denom = 2 * Math.cos(theta) ** 2 * (d * Math.tan(theta) - h);
      v2 = denom > 0 ? (G * d * d) / denom : -1;
      if (v2 <= 0) theta += 0.08;
    }
    const sweetMid = (SHOT_SWEET[0] + SHOT_SWEET[1]) / 2;
    let err = 0;
    if (power < SHOT_SWEET[0] || power > SHOT_SWEET[1]) err = (power - sweetMid) * 0.35;
    const v = Math.sqrt(Math.max(v2, 1)) * (1 + err);
    return { x: (dx / d) * v * Math.cos(theta), y: v * Math.sin(theta), z: (dz / d) * v * Math.cos(theta) };
  }

  // ---------------- 차기·띄우기·토스·스파이크·치기 ----------------
  kick(it) {
    if (!it) return;
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('kick');
    if (it === this.held) {
      this.clearHeld();
      it.body.position.set(a.position.x + dir.x * 0.4, a.position.y + 0.35, a.position.z + dir.z * 0.4);
    }
    const [fwd, up] = it.def.kick;
    this.items.launch(it, dir.x * fwd, up, dir.z * fwd);
  }

  lift(it) {
    const dir = this.faceAim();
    this.avatar.playAction('toss');
    const [fwd, up] = it.def.lift;
    this.items.launch(it, dir.x * fwd, up, dir.z * fwd);
  }

  toss(it) {
    if (!it) return;
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('toss');
    if (it === this.held) {
      this.clearHeld();
      it.body.position.set(a.position.x + dir.x * 0.35, a.position.y + 1.7 + it.def.r, a.position.z + dir.z * 0.35);
    }
    const up = it.type === 'bigvolley' ? 4.5 : 6.2;
    this.items.launch(it, dir.x * 0.8, up, dir.z * 0.8);
  }

  spike(it) {
    if (!it) return;
    const dir = this.faceAim();
    this.avatar.playAction('swing');
    const big = it.type === 'bigvolley';
    this.items.launch(it, dir.x * (big ? 8 : 15), big ? -1.5 : -4, dir.z * (big ? 8 : 15));
  }

  hit() {
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('swing');
    const p = a.position;
    // 라켓 닿는 범위의 셔틀콕
    for (const it of this.items.list) {
      if (!it.def.shuttle || it.held) continue;
      const b = it.body.position;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 1.8 || b.y > p.y + 3.3) continue;
      if (b.y > p.y + 2.0 && !a.grounded) {
        // 점프 스매시
        this.items.launch(it, dir.x * 24, -5, dir.z * 24);
        this.hud.popup('스매시!');
      } else {
        this.items.launch(it, dir.x * 15, 13, dir.z * 15);
      }
    }
  }

  // 훌라후프 굴리기
  rollHoop() {
    const it = this.held;
    if (!it) return;
    const dir = this.faceAim();
    const p = this.avatar.position;
    this.avatar.playAction('throw');
    this.clearHeld();
    this.items.startRolling(it, dir.x, dir.z, 4.5, { x: p.x + dir.x * 0.7, z: p.z + dir.z * 0.7 });
  }

  // 공 정리 버튼
  resetAll() {
    if (this.held) {
      const it = this.held;
      if (it.mesh.parent !== this.items.scene) this.items.scene.add(it.mesh);
      this.clearHeld();
    }
    this.items.reset();
    for (const r of this.resettables) r.reset();
    this.hud.popup('정리 완료!');
  }
}
