import * as THREE from 'three';
import { JumpRope, HulaHoop } from './activities.js';
import { makeItemMesh } from './items.js';
import { SPORTS } from './match.js';

// 동작 판단·실행: 지금 할 수 있는 동작을 고르고, 버튼/키 입력에 따라 실행한다.
//   E: 잡기·놓기·플래그 뽑기·플래그 착용
//   Q: 던지기 (꾹 눌러 힘 모으기, 농구공은 골대를 보면 '슛')
//   F: 차기·치기(라켓)·스파이크·띄우기(킨볼)
//   R: 토스 (배구공·빅발리볼), 손이 비면 '패스 해줘' 손들기 (여러 명일 때)
//   친구 쪽을 보고 있으면 Q '패스'·F '차서 패스'가 친구에게 자동으로 날아가고,
//   받는 친구는 자동으로 잡음(발 패스는 발 앞에 멈춤)
const CHARGE_TIME = 1.1;      // 힘이 꽉 차는 시간(초)
// 슛 게이지의 초록 구간: 멀수록 좁아짐 (거리별 난이도)
const THREE_PT_R = 6.75;   // 3점 라인 (림 중심에서)
const THREE_PT_SIDE = 6.6; // 코너 3점 (사이드라인 쪽 직선 구간: |z| ≥ 6.6)
function shotSweet(d) {
  if (d < 3) return [0.55, 0.85];      // 골밑
  if (d < THREE_PT_R) return [0.6, 0.8]; // 중거리
  if (d < 8.5) return [0.65, 0.77];      // 3점
  return [0.68, 0.75];                   // 장거리 3점
}
// 이 자리에서 쏘면 3점인지 (림 기준)
export function isThreePoint(from, hoop) {
  return Math.hypot(from.x - hoop.x, from.z - hoop.z) >= THREE_PT_R || Math.abs(from.z) >= THREE_PT_SIDE;
}
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
    this.shotSweet = shotSweet(0);
    this.shotThree = false;
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

    // E: 경기 참가(로비 발판) > 플래그 뽑기 > 플래그 착용/벗기 > 잡기/놓기
    const friend = this.mp ? this.mp.pullablePlayer(pos) : null;
    const kiosk = !held && this.kiosks ? this.kiosks.near(pos) : null;
    if (kiosk) {
      const sp = SPORTS[kiosk];
      acts.push({ id: 'join', label: `${sp.icon} ${sp.name}\n경기장`, key: 'E', color: 'throw', target: kiosk });
    } else if (this.npc.canPull(pos)) {
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
        if (this.shotTarget) {
          const h = this.shotTarget;
          this.shotSweet = shotSweet(Math.hypot(h.x - pos.x, h.z - pos.z));
          this.shotThree = isThreePoint(pos, h);
        }
        if (pt) acts.push({ id: 'pass', label: '패스', key: 'Q', color: 'throw', target: pt });
        else acts.push({ id: 'throw', label: this.shotTarget ? (this.shotThree ? '3점\n슛' : '슛') : '던지기', key: 'Q', hold: true, color: 'throw' });
        if (held.def.toss) acts.push({ id: 'toss', label: '토스', key: 'R', color: 'toss' });
        if (held.def.kick) acts.push(pt
          ? { id: 'kickpass', label: '차서\n패스', key: 'F', color: 'kick', target: pt }
          : { id: 'kick', label: '차기', key: 'F', color: 'kick' });
      }
      if (!acts.some((x) => x.key === 'E')) acts.push({ id: 'drop', label: '놓기', key: 'E' });
    } else {
      // 떠 있는 배구공 근처: F 스파이크(자동 점프해서 때림), 손 닿는 공은 R 토스
      const sp = this.pendingSpike ? null : this.findSpikeBall();
      if (sp) acts.push({ id: 'spike', label: '스파\n이크', key: 'F', color: 'kick', target: sp });
      const air = this.findAirBall();
      if (air) acts.push({ id: 'toss', label: '토스', key: 'R', color: 'toss', target: air });
      // 배구 경기장 네트 앞: Q 블로킹
      if (this.blockNet && Math.abs(pos.x - this.blockNet.x) < 1.8) {
        acts.push({ id: 'block', label: '블로\n킹', key: 'Q', color: 'throw' });
      }
      // 농구 경기장: 근처에 친구가 든 공·날아가는 공이 있으면 Q 블락
      if (this.space === 'bb' && !acts.some((x) => x.key === 'Q') && this.findBlockBall(3.2)) {
        acts.push({ id: 'block', label: '블락', key: 'Q', color: 'throw' });
      }
      if (!acts.some((x) => x.key === 'E')) {
        const g = this.findGrab();
        if (g) acts.push({ id: 'grab', label: '잡기', key: 'E', target: g });
      }
      // 배드민턴 경기장: 셔틀콕이 닿는 거리면 기술 버튼 (F 하이클리어 · Q 드롭 · R 헤어핀 · E 스매시)
      if (this.space === 'bd') {
        const sh = this.findShuttle();
        if (sh) {
          const b = sh.body.position;
          acts.push({ id: 'clear', label: '하이\n클리어', key: 'F', color: 'kick', target: sh });
          acts.push({ id: 'dropshot', label: '드롭', key: 'Q', color: 'throw', target: sh });
          if (Math.abs(pos.z) < 2.6 && b.y < pos.y + 1.5) acts.push({ id: 'hairpin', label: '헤어핀', key: 'R', color: 'toss', target: sh });
          if (b.y > pos.y + 1.9) acts.push({ id: 'smash', label: '스매시', key: 'E', color: 'kick', target: sh });
        }
      } else if (this.autoRacket && !acts.some((x) => x.key === 'F')) acts.push({ id: 'hit', label: '치기', key: 'F', color: 'kick' });
      if (!acts.some((x) => x.key === 'F')) {
        const kin = items.nearest(pos, 0.8, (it) => it.def.lift);
        const kick = items.nearest(pos, this.space === 'fs' ? 0.95 : 0.7, (it) => it.def.kick && it.body.position.y < 0.6 + it.def.r);
        // 풋살 경기장: 발 앞 공 + 상대 골문 쪽을 보면 Q 슛 (꾹 눌러 힘 모으기)
        if (this.space === 'fs' && kick) {
          const g = this.futsalGoal();
          if (g && !acts.some((x) => x.key === 'Q')) acts.push({ id: 'fshoot', label: '슛', key: 'Q', hold: true, color: 'throw', target: kick });
        }
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

  // 배드민턴 경기장: 모두 '내 라켓'을 오른손에 들고 시작 (공유 라켓과 별개)
  setAutoRacket(on) {
    this.autoRacket = on;
    if (on && !this.myRacket) {
      this.myRacket = makeItemMesh('racket');
      this.myRacket.position.set(0, 0, 0.02);
      this.myRacket.rotation.set(Math.PI + 0.3, 0, 0);
      this.avatar.parts.rightHand.add(this.myRacket);
    }
    if (this.myRacket) this.myRacket.visible = on;
    if (!this.held) this.avatar.holdPose = on ? 'racket' : null;
  }

  // 다른 공간으로 갈 때: 들고 있던 물건 내려놓기 (줄넘기·훌라후프 멈춤)
  releaseAll() {
    const it = this.held;
    if (!it) return;
    if (it.mesh.parent !== this.items.scene) this.items.scene.add(it.mesh);
    this.items.setHeld(it, false);
    this.clearHeld();
  }

  // 잡을 물건 고르기: 1.1m 안에서, 아바타가 바라보는 앞쪽에 있는 것을 우선
  findGrab() {
    const a = this.avatar, p = a.position;
    a.forward(this.right);
    let best = null, bestScore = Infinity;
    for (const it of this.items.list) {
      if (it.held || it.busy || it.remoteHolder || !it.def.hold) continue;
      if (this.autoRacket && (it.def.shuttle || it.def.racket)) continue; // 배드민턴 경기장: 라켓으로 치기만
      if (this.space === 'fs' && it.type === 'futsal') continue;            // 풋살 경기장: 손은 안 씀 (발로만)
      const b = it.body.position;
      if (b.y > p.y + 2.2) continue;
      const dx = b.x - p.x, dz = b.z - p.z;
      const dy = Math.max(0, Math.abs(b.y - (p.y + 0.7)) - 0.9);
      const d = Math.hypot(dx, dz, dy) - it.def.r;
      if (d > 1.1) continue;
      const h = Math.hypot(dx, dz) || 1;
      const front = (dx * this.right.x + dz * this.right.z) / h; // 1 = 정면, -1 = 뒤
      const score = d - front * 0.35;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  // 잡힐 물건 밑에 흰 원 표시
  showGrabMark(it) {
    if (!this.grabMark) {
      this.grabMark = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }),
      );
      this.grabMark.renderOrder = 4;
      this.items.scene.add(this.grabMark);
    }
    const m = this.grabMark;
    m.visible = !!it;
    if (!it) return;
    const b = it.mesh.position, r = it.def.r;
    const s = (r + 0.1) * (1 + Math.sin(this.clock * 7) * 0.08);
    m.scale.set(s, 1, s);
    m.position.set(b.x, Math.max(0.02, b.y - r + 0.02), b.z);
  }

  // 카메라가 보는 방향과 어떤 지점 사이의 각도
  angleTo(q) {
    const p = this.avatar.position;
    this.aimDir(this.fwd);
    const dx = q.x - p.x, dz = q.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    return Math.acos(THREE.MathUtils.clamp((dx * this.fwd.x + dz * this.fwd.z) / d, -1, 1));
  }

  // 스파이크할 수 있는 공: 떠 있고(1.4m 이상) 2.8m 안
  findSpikeBall() {
    const p = this.avatar.position;
    let best = null, bestD = 2.8;
    for (const it of this.items.list) {
      if (it.held || !it.def.spike) continue;
      const b = it.body.position;
      if (b.y < p.y + 1.4 || b.y > p.y + 4.5) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
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
    const grabAct = this.actions.find((x) => x.id === 'grab');
    this.showGrabMark(grabAct ? grabAct.target : null);

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

    // 풋살 슛 힘 모으기
    const fc = this.fsCharge;
    if (fc) {
      fc.power = Math.min(1, fc.power + dt / CHARGE_TIME);
      const ball = fc.it, p = this.avatar.position, b = ball.body.position;
      const lost = ball.held || ball.remote || Math.hypot(b.x - p.x, b.z - p.z) > 1.3;
      if (lost) this.fsCharge = null;
      else if (!input.isHeld(fc.token)) { this.fsCharge = null; this.footShot(ball, fc.power); }
    }

    const throwable = this.held && !this.held.def.racket;
    this.hud.setAim(!!throwable);
    if (this.fsCharge) {
      const g = this.futsalGoal();
      this.hud.setGauge(this.fsCharge.power, g ? this.footSweet(g) : null, '초록에서 떼면 골!');
    } else if (this.charging) {
      this.hud.setGauge(this.power, this.shotTarget ? this.shotSweet : null,
        this.shotTarget ? (this.shotThree ? '3점 슛! 초록에서 떼기' : '초록에서 떼면 골!') : '힘');
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
      case 'fshoot':
        this.fsCharge = { token, power: 0, it: act.target };
        return;
      case 'pass': return this.passTo(this.held, act.target, false);
      case 'kickpass': return this.passTo(act.ball || this.held, act.target, true);
      case 'join':
        if (this.onJoinSport) this.onJoinSport(act.target);
        return;
      case 'call':
        a.calling = 3;
        this.sound.pop();
        return;
      case 'lift': return this.lift(act.target);
      case 'toss': return this.toss(act.target || this.held);
      case 'spike': return this.startSpike(act.target);
      case 'block': return this.startBlock();
      case 'hit': return this.hit();
      case 'clear': case 'dropshot': case 'hairpin': case 'smash': return this.stroke(act.id === 'dropshot' ? 'drop' : act.id, act.target);
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
    if (it) it.shotFrom = null; // 다른 사람이 만지면 새 공격
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
    this.avatar.holdPose = this.autoRacket ? 'racket' : null;
    this.avatar.dribble = false;
    this.avatar.charge = 0;
    this.charging = false;
  }

  // 물리 계산 후: 들고 있는 물건 위치 맞추기 (드리블 포함)
  postPhysics(dt = 1 / 60) {
    this.updateDribble(dt);
    this.updateSpike(dt);
    this.updateBlock(dt);
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
    this.dribbleCool = 0.6;
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

    // 농구공: 쏜 자리 기억 (골이 들어가면 2점/3점 판단)
    if (it.type === 'basketball') it.shotFrom = { x: a.position.x, z: a.position.z };
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
    const sw = this.shotSweet;
    const sweetMid = (sw[0] + sw[1]) / 2;
    let err = 0;
    if (power < sw[0] || power > sw[1]) err = (power - sweetMid) * 0.35;
    const v = Math.sqrt(Math.max(v2, 1)) * (1 + err);
    return { x: (dx / d) * v * Math.cos(theta), y: v * Math.sin(theta), z: (dz / d) * v * Math.cos(theta) };
  }

  // ---------------- 차기·띄우기·토스·스파이크·치기 ----------------
  kick(it) {
    if (!it) return;
    this.dribbleCool = 0.6;
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

  // ---------------- 풋살: 드리블·슛 (빨강은 +x 골문 공격, 골라인 x = ±15.5, 골문 폭 3m·높이 2m) ----------------
  // 공격할 골문 (바라보는 방향이 골문 쪽일 때만)
  futsalGoal() {
    const team = this.avatar.team;
    const p = this.avatar.position;
    const gx = team === 'b' ? -15.5 : team === 'r' ? 15.5 : (p.x >= 0 ? 15.5 : -15.5);
    const d = Math.abs(gx - p.x);
    if (d > 17) return null;
    const ang = this.angleTo({ x: gx, z: 0 });
    return ang < 1.0 ? { x: gx, z: 0, d } : null;
  }

  // 슛 게이지 초록 구간: 멀수록 좁음
  footSweet(g) {
    const d = g.d;
    if (d < 5) return [0.45, 0.8];
    if (d < 9) return [0.55, 0.78];
    return [0.62, 0.76];
  }

  // 슛: 초록 구간이면 바라본 쪽 골문 구석으로 낮고 강하게. 약하면 힘없이, 세면 골대 위로·옆으로 빗나감
  footShot(it, power) {
    const g = this.futsalGoal() || { x: (this.avatar.team === 'b' ? -15.5 : 15.5), z: 0, d: 10 };
    const sw = this.footSweet(g);
    const a = this.avatar, p = a.position;
    this.claim(it);
    this.aimDir(this.fwd);
    // 바라본 방향이 골라인과 만나는 z → 골포스트 안쪽으로
    const t = Math.abs(this.fwd.x) > 0.05 ? (g.x - p.x) / this.fwd.x : 0;
    let tz = THREE.MathUtils.clamp(p.z + this.fwd.z * Math.max(0, t), -1.2, 1.2);
    let ty = 0.45;
    let speed = 15 + power * 6;
    if (power < sw[0]) {
      speed = 7 + power * 10; // 힘없는 슛
      ty = 0.2;
    } else if (power > sw[1]) {
      const over = power - sw[1];
      ty = 2.3 + over * 6;                                      // 골대 위로
      tz += (Math.random() < 0.5 ? -1 : 1) * (0.6 + over * 5);  // 옆으로도
    }
    const b = it.body.position;
    const gxIn = g.x + Math.sign(g.x) * 0.3; // 골라인 조금 안쪽을 노림
    const dist = Math.hypot(gxIn - b.x, tz - b.z);
    const T = Math.max(0.15, dist / speed);
    const vy = (ty - b.y + 0.5 * G * T * T) / T;
    a.faceDirection((gxIn - b.x) / dist, (tz - b.z) / dist);
    a.playAction('kick');
    this.sound.kick();
    this.dribbleCool = 0.6;
    this.items.launch(it, ((gxIn - b.x) / dist) * speed, Math.min(vy, 14), ((tz - b.z) / dist) * speed);
    this.hud.popup(power >= sw[0] && power <= sw[1] ? '슛! ⚽' : power < sw[0] ? '약한 슛' : '빗나감!');
  }

  // 드리블: 풋살 경기장에서 공이 발 앞에 있으면 걸을 때 공이 발 앞에 붙어 따라옴
  updateDribble(dt) {
    this.dribbleCool = Math.max(0, (this.dribbleCool || 0) - dt);
    const was = this.dribbleBall;
    this.dribbling = false;
    this.dribbleBall = null;
    this.dribbleStep(dt);
    // 드리블 중에는 공이 사람 몸에 걸리지 않게 (돌아설 때 공이 몸에 막히지 않도록). 끝나면 원래대로
    const now = this.dribbleBall;
    if (was && was !== now && !was.held) was.body.collisionFilterMask = -1;
    if (now) now.body.collisionFilterMask = 1;
  }

  dribbleStep(dt) {
    if (this.space !== 'fs' || this.held || this.dribbleCool > 0) return;
    const a = this.avatar;
    if (!a.grounded) return;
    const p = a.position;
    a.forward(this.right);
    let ball = null;
    for (const it of this.items.list) if (it.type === 'futsal') ball = it;
    if (!ball || ball.held || ball.remoteHolder) return;
    const b = ball.body.position, r = ball.def.r;
    if (b.y > r + 0.35) return;
    const dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.95) return;
    // 상대가 드리블하는 공: 아주 가까이 붙으면 뺏기 (주인이 바뀐 뒤 1.5초는 보호)
    if (ball.remote) {
      const o = this.mp && this.mp.ownerOf(ball);
      const opp = o && o.player && o.player.team && o.player.team !== a.team;
      if (!(opp && d < 0.65 && o.since > 1500)) return;
      this.hud.popup('뺏었다! 🦶');
      this.sound.pop();
    }
    this.claim(ball);
    this.dribbling = true;
    this.dribbleBall = ball;
    const v = ball.body.velocity, av = a.body.velocity;
    const tx = p.x + this.right.x * 0.55, tz = p.z + this.right.z * 0.55;
    const moving = a.anim.moveAmount > 0.2;
    const k = moving ? 7 : 4;
    v.x = av.x + (tx - b.x) * k;
    v.z = av.z + (tz - b.z) * k;
    ball.body.angularVelocity.set(v.z / r, 0, -v.x / r); // 굴러가는 모양
    ball.body.wakeUp();
    // 걸을 때 톡톡 차는 모습
    this.dribbleTouch = (this.dribbleTouch || 0) - dt;
    if (moving && this.dribbleTouch <= 0) {
      this.dribbleTouch = 0.55;
      a.playAction('kick');
    }
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

  // ---------------- 스파이크·블로킹 ----------------
  // 스파이크 버튼: 땅에 있으면 점프하고, 손이 공에 닿는 순간 자동으로 때림
  startSpike(it) {
    if (!it) return;
    this.avatar.tryJump();
    this.pendingSpike = { it, t: 0 };
  }

  updateSpike(dt) {
    const ps = this.pendingSpike;
    if (!ps) return;
    const a = this.avatar, p = a.position, it = ps.it, b = it.body.position;
    ps.t += dt;
    if (it.held || ps.t > 1.1 || (ps.t > 0.2 && a.grounded)) { this.pendingSpike = null; return; }
    // 공 쪽을 보며 손을 뻗음
    const dx = b.x - p.x, dz = b.z - p.z, h = Math.hypot(dx, dz) || 1;
    a.faceDirection(dx / h, dz / h);
    const reach = Math.hypot(Math.max(0, h - 0.3), b.y - (p.y + 2.3));
    if (reach < 1.05) {
      this.pendingSpike = null;
      this.spike(it);
    }
  }

  spike(it) {
    if (!it) return;
    this.claim(it);
    const dir = this.spikeDir();
    this.avatar.faceDirection(dir.x, dir.z);
    this.avatar.playAction('swing');
    this.sound.kick();
    if (it.type === 'bigvolley') {
      this.items.launch(it, dir.x * 8, -1.5, dir.z * 8);
    } else {
      const v = this.spikeVelocity(it, dir);
      this.items.launch(it, v.x, v.y, v.z);
    }
    this.hud.popup('스파이크! 💥');
    const b = it.body.position;
    this.effects.sparkle(b.x, b.y, b.z);
  }

  // 때리는 방향: 카메라가 보는 쪽. 배구 경기장에서는 상대 코트 쪽으로 보정
  spikeDir() {
    const dir = this.aimDir(this.fwd).clone();
    const net = this.blockNet;
    const team = this.avatar.team;
    if (net && team) {
      const attack = team === 'r' ? 1 : -1; // 빨강은 +x 쪽 코트를 공격
      if (dir.x * attack < 0.6) {
        dir.x = attack * 0.6;
        dir.z = Math.sign(dir.z || 1) * Math.min(Math.abs(dir.z), 0.8);
      }
      dir.y = 0;
      dir.normalize();
    }
    return dir;
  }

  // 공이 (네트를 넘어) 땅에 꽂히는 속도. 네트에 걸릴 것 같으면 조금 높게
  spikeVelocity(it, dir) {
    const b = it.body.position, r = it.def.r, net = this.blockNet;
    let D = 5;
    let dn = -1; // 네트까지 거리 (방향 따라)
    if (net && Math.abs(dir.x) > 0.05) {
      dn = (net.x - b.x) / dir.x;
      if (dn > 0) {
        D = dn + 4;
        // 상대 코트 끝을 넘지 않게
        const maxD = (Math.sign(dir.x) * 8.5 - b.x) / dir.x;
        D = Math.max(dn + 1, Math.min(D, maxD));
      } else D = 4;
    }
    let vx = 0, vy = 0, vz = 0;
    for (let s = 15; s >= 6; s -= 1.5) {
      const t = D / s;
      vy = (r - b.y + 0.5 * G * t * t) / t;
      vx = dir.x * s;
      vz = dir.z * s;
      if (dn <= 0) break;
      const tn = dn / s;
      const hn = b.y + vy * tn - 0.5 * G * tn * tn;
      if (hn > net.h + r + 0.08) break;
    }
    return { x: vx, y: vy, z: vz };
  }

  // 블로킹 버튼: 두 팔을 들고 점프. 그동안 손에 닿는 공은 상대 쪽으로 떨어뜨림
  startBlock() {
    this.avatar.tryJump();
    this.avatar.playAction('block');
    this.blocking = 0.75;
    this.blockDone = false;
  }

  // 농구 블락할 수 있는 공 (친구가 들고 있거나 날아가는 중), 가로 거리 range 안
  findBlockBall(range) {
    const p = this.avatar.position;
    for (const it of this.items.list) {
      if (it.type !== 'basketball' || it.held) continue;
      const b = it.body.position;
      if (Math.hypot(b.x - p.x, b.z - p.z) > range) continue;
      if (it.remoteHolder || b.y > p.y + 1.2) return it;
    }
    return null;
  }

  // 농구 블락: 점프한 손에 닿은 슛을 쳐 냄
  updateHoopBlock() {
    const p = this.avatar.position;
    for (const it of this.items.list) {
      if (it.type !== 'basketball' || it.held || it.remoteHolder) continue;
      const b = it.body.position, v = it.body.velocity;
      if (Math.hypot(b.x - p.x, b.z - p.z) > 0.95 + it.def.r) continue;
      if (b.y < p.y + 1.4 || b.y > p.y + 3.3) continue;
      if (v.length() < 1.5) continue; // 멈춰 있는 공은 아님
      this.blockDone = true;
      this.claim(it); // 쏜 사람 공격은 끝 (3점 기록도 지움)
      // 공이 날아온 쪽으로, 아래로 쳐 냄 (몸과 겹치지 않게 손 앞에 둠)
      let hx = -v.x, hz = -v.z;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl; hz /= hl;
      it.body.position.set(p.x + hx * 0.6, Math.max(b.y, p.y + 2.1), p.z + hz * 0.6);
      it.body.velocity.set(hx * 4 + (Math.random() - 0.5) * 2, -1.5, hz * 4 + (Math.random() - 0.5) * 2);
      it.body.wakeUp();
      it.flying = true;
      this.sound.pop();
      this.hud.popup('블락! 🖐️');
      this.effects.sparkle(b.x, b.y, b.z);
      return;
    }
  }

  updateBlock(dt) {
    if (!(this.blocking > 0)) return;
    this.blocking -= dt;
    if (this.blockDone) return;
    if (this.space === 'bb') { this.updateHoopBlock(); return; }
    const p = this.avatar.position;
    for (const it of this.items.list) {
      if (it.held || !it.def.spike) continue;
      const b = it.body.position, v = it.body.velocity;
      if (Math.hypot(b.x - p.x, b.z - p.z) > 0.85 + it.def.r) continue;
      if (b.y < p.y + 1.5 || b.y > p.y + 3.2) continue;
      // 손 쪽으로 오는 공만 (멈춰 있는 공은 그대로)
      if (Math.hypot(v.x, v.z) < 1 && !it.remote) continue;
      this.blockDone = true;
      this.claim(it);
      // 상대 코트 쪽(네트 너머)으로. 네트가 없으면 공이 온 쪽으로
      const net = this.blockNet;
      const sx = (net && Math.sign(net.x - p.x)) || -Math.sign(v.x) || 1;
      // 몸과 겹치지 않게 손 위에 두고 떨어뜨림 (겹치면 물리 계산이 공을 튕겨 냄).
      // 네트가 있으면 손이 네트 위로 넘어간 것처럼 네트 바로 너머·네트보다 높게 → 상대 코트로 떨어짐
      // 진짜 블로킹처럼 네트 바로 앞(상대 코트)에 내리꽂음
      if (net) {
        it.body.position.set(net.x + sx * 0.2, Math.max(b.y, net.h + it.def.r + 0.12), b.z);
        it.body.velocity.set(sx * 1.3, -6, v.z * 0.2);
      } else {
        it.body.position.set(p.x + sx * 0.6, Math.max(b.y, p.y + 2.05), b.z);
        it.body.velocity.set(sx * 3, -2, v.z * 0.3);
      }
      it.body.wakeUp();
      it.flying = true;
      this.sound.pop();
      this.hud.popup('블로킹! 🙌');
      this.effects.sparkle(b.x, b.y, b.z);
      return;
    }
  }

  // ---------------- 배드민턴 기술 (배드민턴 경기장: 네트 z = 0, 코트 가운데 x = 9) ----------------
  findShuttle() {
    const p = this.avatar.position;
    let best = null, bestD = 1.9;
    for (const it of this.items.list) {
      if (!it.def.shuttle || it.held) continue;
      const b = it.body.position;
      if (b.y > p.y + 3.4) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // kind: clear(높고 길게) · drop(네트 앞에 뚝) · hairpin(네트에 붙여 살짝) · smash(빠르게 내리꽂기)
  stroke(kind, it) {
    if (!it) return;
    const a = this.avatar, p = a.position;
    const b = it.body.position;
    const NET_TOP = 1.524, CX = 9, HALF_W = 3.05, HALF_L = 6.7;
    // 상대 코트 방향: 빨강은 -z 쪽에 서서 +z 로 침. 팀이 없으면 내가 선 쪽의 반대편
    const team = a.team;
    const s = team === 'r' ? 1 : team === 'b' ? -1 : (p.z < 0 ? 1 : -1);
    // 좌우: 카메라가 보는 방향으로 조금씩
    this.aimDir(this.fwd);
    const side = THREE.MathUtils.clamp(this.fwd.x * 3.2, -1, 1) * (HALF_W - 0.5);
    const depth = { clear: HALF_L - 0.7, drop: 1.3, hairpin: 0.45, smash: 3.6 }[kind];
    const tx = THREE.MathUtils.clamp(CX + side, CX - HALF_W + 0.3, CX + HALF_W - 0.3);
    const tz = s * depth;
    const r = it.def.r;
    // 라켓 앞에서 출발 (몸과 겹친 채 날아가면 물리 계산이 튕겨 내 궤도가 틀어짐)
    {
      const dx = tx - p.x, dz = tz - p.z, dl = Math.hypot(dx, dz) || 1;
      const sy = THREE.MathUtils.clamp(b.y, 0.35, p.y + 2.7);
      it.body.position.set(p.x + (dx / dl) * 0.6, sy, p.z + (dz / dl) * 0.6);
      it.body.velocity.set(0, 0, 0);
    }
    const dist = Math.hypot(tx - b.x, tz - b.z);
    let T = { clear: 1.7, drop: 1.15, hairpin: 0.9, smash: Math.max(0.32, dist / 17) }[kind];
    // 네트를 넘을 때까지 시간을 늘려 궤도를 높임
    let vx, vy, vz;
    for (let i = 0; i < 12; i++) {
      vx = (tx - b.x) / T;
      vz = (tz - b.z) / T;
      vy = (r - b.y + 0.5 * G * T * T) / T;
      if (Math.sign(vz) !== s || (b.z - 0) * s > 0) break; // 이미 네트 너머면 검사 안 함
      const tn = (0 - b.z) / vz;
      const hn = b.y + vy * tn - 0.5 * G * tn * tn;
      if (hn > NET_TOP + 0.18) break;
      T += 0.08;
    }
    this.claim(it);
    if (kind === 'smash') a.tryJump();
    a.faceDirection(0, s);
    a.playAction('swing');
    if (kind === 'smash') this.sound.kick(); else this.sound.throw();
    this.items.launch(it, vx, vy, vz);
    it.guided = true;
    const name = { clear: '하이클리어', drop: '드롭', hairpin: '헤어핀', smash: '스매시! 💥' }[kind];
    this.hud.popup(name);
    if (kind === 'smash') this.effects.sparkle(b.x, b.y, b.z);
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
