import * as THREE from 'three';
import { JumpRope, HulaHoop } from './activities.js';

// 동작 판단·실행: 지금 할 수 있는 동작을 고르고, 버튼/키 입력에 따라 실행한다.
//   E: 잡기·놓기·플래그 뽑기·플래그 착용
//   Q: 던지기 (꾹 눌러 힘 모으기, 농구공은 골대를 보면 '슛')
//   F: 차기·치기(라켓)·스파이크·띄우기(킨볼)
//   R: 토스 (배구공·빅발리볼), 손이 비면 '패스 해줘' 손들기 (여러 명일 때)
//   친구 쪽을 보고 있으면 Q '패스'·F '차서 패스'가 친구에게 자동으로 날아가고,
//   받는 친구는 자동으로 잡음(발 패스는 발 앞에 멈춤)
const CHARGE_TIME = 1.1;      // 힘이 꽉 차는 시간(초)
const SHOT_SWEET = [0.62, 0.78]; // 슛 게이지의 초록 구간
const G = 9.82;

export class Game {
  constructor({ avatar, items, camCtl, input, hud, npc, beltBox, resettables, nameTag, landmarks, sound, effects }) {
    Object.assign(this, { avatar, items, camCtl, input, hud, npc, beltBox, nameTag, landmarks, sound, effects });
    this.resettables = resettables; // 정리 버튼으로 제자리에 돌릴 기구들
    this.rope = new JumpRope(items.scene, avatar, hud);
    this.hoop = new HulaHoop(avatar, items, hud);
    this.rope.sound = sound;
    this.hoop.sound = sound;
    this.held = null;
    this.charging = false;
    this.power = 0;
    this.actions = [];
    this.flagScore = 0;
    this.v = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.shotTarget = null;
    this.passTarget = null;
    this.passFlight = null; // 내가 보낸 패스 { it, target, foot, t, T, pinned }
    this.clock = 0;
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
    const friend = this.mp ? this.mp.pullablePlayer(pos) : null;
    if (this.npc.canPull(pos)) {
      acts.push({ id: 'pull', label: '플래그\n뽑기', key: 'E', color: 'throw' });
    } else if (friend) {
      acts.push({ id: 'pullp', label: '플래그\n뽑기', key: 'E', color: 'throw', target: friend });
    } else if (this.beltBox.isNear(pos)) {
      acts.push(a.wearingFlags
        ? { id: 'unwear', label: '플래그\n벗기', key: 'E' }
        : { id: 'wear', label: '플래그\n착용', key: 'E' });
    }

    this.shotTarget = null;
    this.passTarget = null;
    const mpOn = this.mp && this.mp.players.size > 0;
    if (mpOn) this.passTarget = this.mp.passTarget(pos, this.aimDir(this.fwd));
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
        // 골대와 친구가 둘 다 앞에 있으면 더 정면에 있는 쪽
        if (this.shotTarget && this.passTarget) {
          if (this.angleTo(this.passTarget.position) < this.angleTo(this.shotTarget)) this.shotTarget = null;
          else this.passTarget = null;
        }
        const pt = this.passTarget;
        if (pt) acts.push({ id: 'pass', label: '패스', key: 'Q', color: 'throw', target: pt });
        else acts.push({ id: 'throw', label: this.shotTarget ? '슛' : '던지기', key: 'Q', hold: true, color: 'throw' });
        if (held.def.toss) acts.push({ id: 'toss', label: '토스', key: 'R', color: 'toss' });
        if (held.def.kick) acts.push(pt
          ? { id: 'kickpass', label: '차서\n패스', key: 'F', color: 'kick', target: pt }
          : { id: 'kick', label: '차기', key: 'F', color: 'kick' });
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
        else if (kick && this.passTarget) acts.push({ id: 'kickpass', label: '차서\n패스', key: 'F', color: 'kick', target: this.passTarget, ball: kick });
        else if (kick) acts.push({ id: 'kick', label: '차기', key: 'F', color: 'kick', target: kick });
      }
      // 손이 비었을 때: 친구에게 '패스 해줘' 손들기
      if (mpOn && !acts.some((x) => x.key === 'R')) {
        acts.push({ id: 'call', label: '패스\n해줘', key: 'R', color: 'toss' });
      }
    }
    const out = acts.slice(0, 4);
    // 받을 친구 표시 원은 지금 패스할 수 있을 때만
    if (!out.some((x) => x.id === 'pass' || x.id === 'kickpass')) this.passTarget = null;
    return out;
  }

  // 카메라가 보는 방향과 어떤 지점 사이의 각도
  angleTo(q) {
    const p = this.avatar.position;
    this.aimDir(this.fwd);
    const dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    return Math.acos(THREE.MathUtils.clamp((dx * this.fwd.x + dz * this.fwd.z) / d, -1, 1));
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
    this.clock += dt;
    if (this.avatar.calling > 0) this.avatar.calling = Math.max(0, this.avatar.calling - dt);
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

    if (this.mp) {
      this.mp.showRing(this.mp.aimRing, this.passTarget && this.passTarget.position, this.clock);
      this.mp.showArrow(this.passTarget, this.clock);
      this.mp.showRing(this.mp.myRing, this.mp.incomingPass && this.avatar.position, this.clock);
    }

    this.rope.update(dt);
    if (this.hoop.update(dt)) this.dropHoopAtFeet();
    this.updateNameTag();
  }

  // 가장 가까운 용기구(2.5m 이내) 위에 이름 띄우기
  updateNameTag() {
    const p = this.avatar.position;
    let best = null, bestD = 2.5;
    for (const it of this.items.list) {
      if (it.held || it.busy) continue;
      const b = it.body.position;
      const d = Math.hypot(b.x - p.x, b.z - p.z) - it.def.r;
      if (d < bestD) {
        bestD = d;
        best = { name: it.def.name, x: b.x, y: Math.max(b.y + it.def.r + 0.4, 2.1), z: b.z }; // 아바타 머리 위로
      }
    }
    if (!best) {
      for (const l of this.landmarks) {
        const q = l.pos();
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < (l.radius || 2.2) && d < bestD + 1) {
          bestD = d;
          best = { name: l.name, x: q.x, y: l.y, z: q.z };
        }
      }
    }
    // 들고 있는 동안에는 숨김
    if (this.held) best = null;
    if (best) this.nameTag.show(best.name, best.x, best.y, best.z);
    else this.nameTag.show(null);
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
      case 'pass': return this.passTo(this.held, act.target, false);
      case 'kickpass': return this.passTo(act.ball || this.held, act.target, true);
      case 'call':
        a.calling = 3;
        this.sound.pop();
        return;
      case 'lift': return this.lift(act.target);
      case 'toss': return this.toss(act.target || this.held);
      case 'spike': return this.spike(act.target);
      case 'hit': return this.hit();
      case 'rope': return this.rope.press();
      case 'spin': return this.hoop.press();
      case 'roll': return this.rollHoop();
      case 'pullp':
        a.playAction('pull');
        if (this.mp.pullPlayer(act.target)) {
          this.flagScore++;
          this.hud.popup(`🚩 ${act.target.name} 플래그!`);
          this.sound.flag();
          const q = act.target.position;
          this.effects.sparkle(q.x, q.y + 0.75, q.z);
        }
        return;
      case 'pull':
        a.playAction('pull');
        // 여러 명 접속 중이고 내가 방장이 아니면: 방장에게 알려서 연습 친구 플래그를 줄임
        if (this.mp && !this.mp.isHost) {
          if (this.npc.flagsLeft > 0) {
            this.room().sendEvent({ k: 'npcpull' });
            this.npc.flagsLeft--;
            this.npc.parts.flags[this.npc.flagsLeft].visible = false;
            this.flagScore++;
            this.hud.popup('🚩 플래그!');
            this.sound.flag();
            const q = this.npc.position;
            this.effects.sparkle(q.x, q.y + 0.75, q.z);
          }
        } else if (this.npc.pullFlag()) {
          this.flagScore++;
          this.hud.popup('🚩 플래그!');
          this.sound.flag();
          const q = this.npc.position;
          this.effects.sparkle(q.x, q.y + 0.75, q.z);
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
  // 여러 명 접속: 공을 만지면 내가 주인이 됨
  claim(it) {
    if (this.mp && it) this.mp.claimItem(it);
  }

  room() {
    return this.mp.room;
  }

  grab(it) {
    if (!it || this.held) return;
    this.claim(it);
    this.items.setHeld(it, true);
    this.held = it;
    this.avatar.holdPose = it.def.hold;
    if (this.mp) this.mp.markHeld(it);
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
      it.mesh.rotation.set(Math.PI + 0.3, 0, 0); // 헤드가 앞쪽 위로
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
  postPhysics(dt = 1 / 60) {
    this.steerPass(dt);
    this.autoCatch();
    this.holdItem();
  }

  // ---------------- 패스 ----------------
  // 받을 친구가 공을 잡을 지점 (손: 가슴 앞, 발: 발 앞), 친구가 움직이면 미리 앞쪽을 노림
  passPoint(target, foot, lead, out) {
    const p = target.position, v = target.body.velocity;
    const vx = THREE.MathUtils.clamp(v.x, -6, 6), vz = THREE.MathUtils.clamp(v.z, -6, 6);
    return out.set(p.x + vx * lead, foot ? p.y + 0.15 : p.y + 1.1, p.z + vz * lead);
  }

  passTo(it, target, foot) {
    if (!it || !target) return;
    this.claim(it);
    const a = this.avatar;
    const p = a.position;
    const r = it.def.r;
    // 친구 쪽으로 몸 돌리기
    const dx0 = target.position.x - p.x, dz0 = target.position.z - p.z;
    const d0 = Math.hypot(dx0, dz0) || 1;
    a.faceDirection(dx0 / d0, dz0 / d0);
    const dir = { x: dx0 / d0, z: dz0 / d0 };
    const start = foot
      ? this.v.set(p.x + dir.x * 0.5, p.y + r + 0.03, p.z + dir.z * 0.5)
      : this.v.set(p.x + dir.x * 0.35, p.y + 1.5, p.z + dir.z * 0.35);
    if (it === this.held) this.clearHeld();
    a.playAction(foot ? 'kick' : 'throw');
    if (foot) this.sound.kick(); else this.sound.throw();

    // 날아가는 시간: 멀수록 길게. 움직이는 친구는 그 시간만큼 앞을 노림
    const T = foot
      ? THREE.MathUtils.clamp(0.3 + d0 * 0.06, 0.4, 1.3)
      : THREE.MathUtils.clamp(0.35 + d0 * 0.07, 0.5, 1.5);
    const tp = this.passPoint(target, foot, T, new THREE.Vector3());
    const g = this.flightGravity(it, Math.hypot(tp.x - start.x, tp.z - start.z) / T);
    it.body.position.set(start.x, start.y, start.z);
    // 발 패스: 낮게 깔리는 땅볼 (살짝만 뜸). 손 패스: 가슴으로 오는 포물선
    const vy = foot ? 1.2 : (tp.y - start.y + 0.5 * g * T * T) / T;
    this.items.launch(it, (tp.x - start.x) / T, vy, (tp.z - start.z) / T, it.def.glide ? 25 : 0);
    this.passFlight = { it, target, foot, t: 0, T, pinned: 0, vh: Math.hypot(tp.x - start.x, tp.z - start.z) / T };
    this.mp.sendPass(it, target, foot);
  }

  // 원반은 빠를수록 뜨는 힘이 커서 중력이 약하게 작용함 (items.js 와 같은 식)
  flightGravity(it, vh) {
    if (it.def.glide) return G * (1 - Math.min(0.9, (vh / 10) ** 2));
    return G;
  }

  // 내가 보낸 패스: 친구에게 닿도록 날아가는 동안 살짝 방향을 맞춰 줌
  steerPass(dt) {
    const f = this.passFlight;
    if (!f) return;
    const it = f.it, b = it.body;
    f.t += dt;
    // 친구가 잡았거나(주인이 바뀜), 다른 사람이 들었거나, 시간이 지나면 끝
    const gone = !this.mp.players.has(f.target.id);
    if (it.held || it.remote || gone || f.t > f.T + 2) {
      this.passFlight = null;
      return;
    }
    const tp = this.passPoint(f.target, f.foot, 0, this.v);
    const dx = tp.x - b.position.x, dy = tp.y - b.position.y, dz = tp.z - b.position.z;
    const dist = Math.hypot(dx, dy * (f.foot ? 0.3 : 1), dz);

    // 친구 손(발) 앞에 도착: 친구가 잡을 때까지 그 자리에 둠 (최대 1.5초)
    if (f.pinned || dist < (f.foot ? 0.6 : 0.75)) {
      f.pinned += dt;
      if (f.pinned > 1.5) { this.passFlight = null; return; }
      if (f.foot) {
        b.velocity.set(0, Math.min(0, b.velocity.y), 0);
        b.angularVelocity.set(0, 0, 0);
      } else {
        f.target.handPosition(this.v, true);
        b.position.set(this.v.x, this.v.y, this.v.z);
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        it.mesh.position.copy(this.v);
        it.flying = false;
      }
      return;
    }
    if (f.t > f.T + 0.4) return; // 많이 빗나간 공은 그냥 둠
    const Tr = Math.max(0.25, f.T - f.t);
    const v = b.velocity;
    const k = Math.min(1, 5 * dt);
    // 원하는 수평 속도 (처음 속도보다 너무 빨라지지 않게)
    let wx = dx / Tr, wz = dz / Tr;
    const wh = Math.hypot(wx, wz), cap = f.vh * 1.2 + 0.5;
    if (wh > cap) { wx *= cap / wh; wz *= cap / wh; }
    v.x += (wx - v.x) * k;
    v.z += (wz - v.z) * k;
    if (!f.foot) {
      const g = this.flightGravity(it, Math.hypot(v.x, v.z));
      v.y += ((dy + 0.5 * g * Tr * Tr) / Tr - v.y) * k;
    }
  }

  // 나에게 온 패스를 자동으로 받기
  autoCatch() {
    const mp = this.mp;
    const ip = mp && mp.incomingPass;
    if (!ip) return;
    const it = this.items.list[ip.idx];
    if (!it || performance.now() > ip.until || it === this.held || (it.remoteHolder && it.remoteHolder !== ip.from)) {
      mp.incomingPass = null;
      return;
    }
    if (this.movementLocked) return;
    const p = this.avatar.position, b = it.body.position;
    if (ip.foot) {
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 1.3 || b.y > p.y + 1.8) return;
      // 트래핑: 발 앞에 멈춤
      this.claim(it);
      this.avatar.forward(this.fwd);
      it.body.position.set(p.x + this.fwd.x * (0.45 + it.def.r), p.y + it.def.r + 0.02, p.z + this.fwd.z * (0.45 + it.def.r));
      it.body.velocity.set(0, 0, 0);
      it.body.angularVelocity.set(0, 0, 0);
      this.hud.popup('트래핑! ⚽');
    } else {
      if (this.held || !it.def.hold) return;
      const d = Math.hypot(b.x - p.x, b.y - (p.y + 1.1), b.z - p.z);
      if (d > 1.6) return;
      this.grab(it);
      this.avatar.playAction('toss');
      this.hud.popup('나이스 캐치! 🙌');
    }
    this.sound.pop();
    this.avatar.calling = 0;
    mp.incomingPass = null;
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
    this.sound.throw();
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
    this.claim(it);
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('kick');
    this.sound.kick();
    if (it === this.held) {
      this.clearHeld();
      it.body.position.set(a.position.x + dir.x * 0.4, a.position.y + 0.35, a.position.z + dir.z * 0.4);
    }
    const [fwd, up] = it.def.kick;
    this.items.launch(it, dir.x * fwd, up, dir.z * fwd);
  }

  lift(it) {
    this.claim(it);
    const dir = this.faceAim();
    this.avatar.playAction('toss');
    this.sound.kick();
    const [fwd, up] = it.def.lift;
    this.items.launch(it, dir.x * fwd, up, dir.z * fwd);
  }

  toss(it) {
    if (!it) return;
    this.claim(it);
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('toss');
    this.sound.pop();
    if (it === this.held) {
      this.clearHeld();
      it.body.position.set(a.position.x + dir.x * 0.35, a.position.y + 1.7 + it.def.r, a.position.z + dir.z * 0.35);
    }
    const up = it.type === 'bigvolley' ? 4.5 : 6.2;
    this.items.launch(it, dir.x * 0.8, up, dir.z * 0.8);
  }

  spike(it) {
    if (!it) return;
    this.claim(it);
    const dir = this.faceAim();
    this.avatar.playAction('swing');
    this.sound.kick();
    const big = it.type === 'bigvolley';
    this.items.launch(it, dir.x * (big ? 8 : 15), big ? -1.5 : -4, dir.z * (big ? 8 : 15));
  }

  hit() {
    const a = this.avatar;
    const dir = this.faceAim();
    a.playAction('swing');
    this.sound.throw();
    const p = a.position;
    // 라켓 닿는 범위의 셔틀콕
    for (const it of this.items.list) {
      if (!it.def.shuttle || it.held) continue;
      const b = it.body.position;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d > 1.8 || b.y > p.y + 3.3) continue;
      this.claim(it);
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
  // fromNet: 친구가 누른 정리 (알림으로 받음)
  resetAll(fromNet = false) {
    if (this.mp && !fromNet) this.mp.broadcastReset();
    if (this.held) {
      const it = this.held;
      if (it.mesh.parent !== this.items.scene) this.items.scene.add(it.mesh);
      this.clearHeld();
    }
    this.items.reset();
    for (const r of this.resettables) r.reset();
    this.hud.popup('정리 완료!');
    this.sound.whistle();
  }
}
