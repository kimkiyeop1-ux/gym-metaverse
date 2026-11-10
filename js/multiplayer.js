import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RemoteAvatar, encodePlayerState } from './remoteAvatar.js';

// ============================================================
//  여러 명 접속: 친구 아바타, 공·기구 공유, 연습 친구, 알림
//
//  공 공유 방식 ("주인" 방식)
//   - 공마다 주인이 한 명. 주인의 기기가 물리 계산을 하고 위치를 보냄(초당 10번, 움직일 때만)
//   - 다른 사람 화면에서는 받은 위치를 부드럽게 따라감
//   - 누가 잡기·차기 등을 하거나 몸으로 밀면 그 사람이 새 주인이 됨 → 패스가 자연스럽게 이어짐
//   - 주인이 나가면 남은 사람이 다시 계산
// ============================================================
const SEND_HZ = 10;

function makeRing(color) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  m.renderOrder = 5;
  m.visible = false;
  return m;
}

function makeArrow() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffd23f';
  g.strokeStyle = '#1f2a5c';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(8, 12); g.lineTo(56, 12); g.lineTo(32, 54); g.closePath();
  g.fill();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.07, 0.07, 1);
  s.renderOrder = 11;
  s.visible = false;
  return s;
}
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

export class Multiplayer {
  // space: null = 자유 체육관(로비), 'bb'·'fs'·'vb'·'bd' = 종목 경기장
  constructor({ room, scene, physics, avatar, items, game, npc, hud, sound, effects, equipment, space = null }) {
    Object.assign(this, { room, scene, physics, avatar, items, game, npc, hud, sound, effects, space });
    this.match = null; // 경기장: Match (main.js 가 연결)
    this.me = room.myId;
    this.players = new Map();   // id -> RemoteAvatar
    this.names = new Map();     // id -> 닉네임 (나 포함)
    this.joinTimes = new Map(); // id -> 입장 시각 (방장 정하기)
    this.actionSeq = 0;
    this.sendTimer = 0;
    this.lastMyState = '';
    this.npcTimer = 0;
    this.cleanTimer = 20;
    this.pullCooldown = new Map();
    this.incomingPass = null; // 나에게 오는 패스 { idx, foot, until, from }

    // 패스 표시 원: 받을 친구 발밑(노랑), 나에게 오는 패스(내 발밑)
    this.aimRing = makeRing(0xffd23f);
    this.myRing = makeRing(0xffd23f);
    this.aimArrow = makeArrow(); // 받을 친구 머리 위 화살표 (내 아바타에 가려도 보이게)
    scene.add(this.aimRing, this.myRing, this.aimArrow);

    // 공유할 물체: 공·작은 기구 + 밀 수 있는 큰 기구
    this.entries = items.list.map((it, idx) => ({ idx, it, body: it.body, kind: 'item', owner: null, last: '', changedAt: 0, target: null }));
    for (const eq of equipment) {
      this.entries.push({ idx: this.entries.length, eq, body: eq.body, kind: 'equip', owner: null, last: '', changedAt: 0, target: null });
    }

    room.on('player', (id, d) => this.onPlayer(id, d));
    room.on('playerRemove', (id) => this.onPlayerRemove(id));
    room.on('item', (idx, d) => this.onItem(idx, d));
    room.on('npc', (d) => this.onNpc(d));
    room.on('event', (ev) => this.onEvent(ev));

    // 아바타 동작이 바뀌면 번호를 올려 다른 사람 화면에서도 같은 동작이 나오게
    this.origPlayAction = avatar.playAction;
    const orig = avatar.playAction.bind(avatar);
    avatar.playAction = (name) => {
      this.actionSeq++;
      avatar.lastAction = name;
      orig(name);
    };
  }

  // 다른 공간으로 옮길 때: 친구 아바타·표시 지우고, 공은 다시 내 화면에서 계산
  dispose() {
    for (const ra of this.players.values()) ra.dispose();
    this.players.clear();
    this.scene.remove(this.aimRing, this.myRing, this.aimArrow);
    this.avatar.playAction = this.origPlayAction;
    for (const e of this.entries) {
      e.owner = null;
      e.target = null;
      this.makeLocal(e, false);
    }
    this.npc.remote = false;
    this.room.leave();
  }

  get count() {
    return this.players.size + 1;
  }

  get isHost() {
    let best = this.me, bestT = this.joinTimes.get(this.me) ?? Infinity;
    for (const [id, t] of this.joinTimes) {
      if (t < bestT || (t === bestT && id < best)) { best = id; bestT = t; }
    }
    return best === this.me;
  }

  nameOf(id) {
    return this.names.get(id) || '친구';
  }

  // ---------------- 사람 ----------------
  onPlayer(id, d) {
    if (!d) return;
    this.names.set(id, d.n);
    if (typeof d.t === 'number') this.joinTimes.set(id, d.t);
    if (id === this.me) return;
    let ra = this.players.get(id);
    if (!ra) {
      ra = new RemoteAvatar(this.scene, this.physics, id, d.n);
      if (this.space === 'bd') ra.setRacket(true); // 배드민턴 경기장: 모두 라켓을 듦
      this.players.set(id, ra);
      this.hud.toast(`${d.n} 님이 들어왔어요 👋`);
      this.hud.setPlayers(this.playerList());
    }
    if (d.s) ra.setState(d.s);
  }

  onPlayerRemove(id) {
    const ra = this.players.get(id);
    if (ra) {
      this.hud.toast(`${ra.name} 님이 나갔어요`);
      ra.dispose();
      this.players.delete(id);
    }
    this.joinTimes.delete(id);
    // 나간 사람이 주인이던 공은 내 화면에서 계속 계산
    for (const e of this.entries) if (e.owner === id) this.makeLocal(e, false);
    this.hud.setPlayers(this.playerList());
  }

  playerList() {
    const me = { name: this.nameOf(this.me) + ' (나)', me: true };
    return [me, ...[...this.players.values()].map((p) => ({ name: p.name }))];
  }

  // 플래그를 뽑을 수 있는 가까운 친구
  pullablePlayer(pos) {
    let best = null, bestD = 1.35;
    for (const p of this.players.values()) {
      if (!p.wear || p.flagsLeft <= 0) continue;
      const d = Math.hypot(p.position.x - pos.x, p.position.z - pos.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  pullPlayer(p) {
    const now = performance.now();
    if ((this.pullCooldown.get(p.id) || 0) > now) return false;
    this.pullCooldown.set(p.id, now + 900);
    p.flagsLeft--;
    this.room.sendEvent({ k: 'pull', to: p.id });
    return true;
  }

  // ---------------- 패스 ----------------
  // 바라보는 방향(fwd)에 있는 친구 중 패스 받을 사람. '패스!' 손든 친구는 더 넓게 찾음
  passTarget(pos, fwd) {
    let best = null, bestScore = Infinity;
    for (const p of this.players.values()) {
      const dx = p.position.x - pos.x, dz = p.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2 || d > 18) continue;
      const ang = Math.acos(THREE.MathUtils.clamp((dx * fwd.x + dz * fwd.z) / d, -1, 1));
      if (ang > (p.calling ? 0.75 : 0.45)) continue;
      const score = (ang + 0.05) * d * (p.calling ? 0.5 : 1);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  sendPass(it, to, foot) {
    const idx = this.items.list.indexOf(it);
    this.room.sendEvent({ k: 'pass', to: to.id, i: idx, f: foot ? 1 : 0 });
  }

  // 원 표시 (pos 가 null 이면 숨김)
  showRing(ring, pos, t) {
    ring.visible = !!pos;
    if (!pos) return;
    ring.position.set(pos.x, pos.y + 0.1, pos.z);
    const s = 1 + Math.sin(t * 8) * 0.08;
    ring.scale.set(s, s, s);
  }

  showArrow(target, t) {
    this.aimArrow.visible = !!target;
    if (!target) return;
    const p = target.position;
    this.aimArrow.position.set(p.x, p.y + (target.calling ? 2.85 : 2.4) + Math.abs(Math.sin(t * 5)) * 0.15, p.z);
  }

  // 연습 친구와 가장 가까운 사람 위치 (방장이 연습 친구를 움직일 때)
  nearestPersonTo(pos) {
    let best = this.avatar.position, bestD = Math.hypot(best.x - pos.x, best.z - pos.z);
    for (const p of this.players.values()) {
      const d = Math.hypot(p.position.x - pos.x, p.position.z - pos.z);
      if (d < bestD) { bestD = d; best = p.position; }
    }
    return best;
  }

  // ---------------- 공·기구 ----------------
  stateOf(e) {
    const it = e.it;
    if (it && (it.held || it.busy)) {
      // 들고 있거나 굴러가는 중: 화면 위치 그대로
      const p = it.mesh.getWorldPosition(new THREE.Vector3());
      const q = it.mesh.getWorldQuaternion(new THREE.Quaternion());
      return [r2(p.x), r2(p.y), r2(p.z), r2(q.x), r2(q.y), r2(q.z), r2(q.w), 0, 0, 0].join(',');
    }
    const b = e.body, p = b.position, q = b.quaternion, v = b.velocity;
    return [r2(p.x), r2(p.y), r2(p.z), r2(q.x), r2(q.y), r2(q.z), r2(q.w), r1(v.x), r1(v.y), r1(v.z)].join(',');
  }

  // 내가 주인이 됨 (잡기·차기·밀기 등)
  claim(e) {
    if (e.owner === this.me) return;
    this.makeLocal(e, true);
    e.owner = this.me;
    e.changedAt = performance.now();
    e.last = '';
    this.room.setItem(e.idx, { o: this.me, s: this.stateOf(e), h: '' });
  }

  claimItem(it) {
    const e = this.entries.find((x) => x.it === it);
    if (e) this.claim(e);
  }

  // 잡은 즉시 '내가 들고 있음'을 알림 (옆 친구가 몸으로 밀어 뺏지 못하게)
  markHeld(it) {
    const e = this.entries.find((x) => x.it === it);
    if (!e) return;
    e.last = this.stateOf(e);
    this.room.updateItem(e.idx, { s: e.last, h: this.me });
  }

  // 내 화면에서 물리 계산 (keepVelocity: 받은 속도 이어받기)
  makeLocal(e, keepVelocity) {
    const b = e.body;
    if (b.type === CANNON.Body.KINEMATIC) {
      b.type = CANNON.Body.DYNAMIC;
      b.updateMassProperties();
    }
    if (e.it) {
      e.it.remote = false;
      e.it.remoteHolder = null;
      if (e.it.def.rope) e.it.mesh.visible = true;
    }
    if (e.target) {
      const t = e.target;
      b.position.set(t.x, t.y, t.z);
      if (!e.it || !e.it.def.hoop || !e.it.busy) b.quaternion.set(t.qx, t.qy, t.qz, t.qw);
      if (keepVelocity) b.velocity.set(t.vx, t.vy, t.vz); else b.velocity.set(0, 0, 0);
    }
    b.wakeUp();
    e.owner = e.owner === this.me ? this.me : null;
  }

  makeRemote(e) {
    const b = e.body;
    if (e.it && e.it.held) return; // 내가 들고 있으면 넘기지 않음
    if (b.type !== CANNON.Body.KINEMATIC) {
      b.type = CANNON.Body.KINEMATIC;
      b.velocity.set(0, 0, 0);
      b.angularVelocity.set(0, 0, 0);
      b.wakeUp();
    }
    if (e.it) {
      e.it.remote = true;
      e.it.flying = false;
    }
  }

  onItem(idx, d) {
    const e = this.entries[idx];
    if (!e || !d) return;
    if (d.o === this.me) return; // 내가 보낸 것
    const s = String(d.s || '').split(',').map(Number);
    e.target = s.length >= 10 ? { x: s[0], y: s[1], z: s[2], qx: s[3], qy: s[4], qz: s[5], qw: s[6], vx: s[7], vy: s[8], vz: s[9] } : null;
    if (e.it && e.it.held) {
      // 동시에 잡은 경우: 들고 있는 내가 우선 → 다시 알림
      this.room.setItem(e.idx, { o: this.me, s: this.stateOf(e), h: this.me });
      return;
    }
    if (d.o && (this.players.has(d.o))) {
      e.owner = d.o;
      e.changedAt = performance.now();
      if (e.it) e.it.remoteHolder = d.h || null;
      this.makeRemote(e);
      if (e.it && e.it.def.rope) e.it.mesh.visible = !d.h; // 줄넘기는 친구 손의 줄로 표시
    } else {
      // 주인 없음(정리됨) 또는 나간 사람 → 내 화면에서 계산
      e.owner = null;
      if (!e.target && e.it) {
        const h = e.it.home;
        e.target = { x: h.x, y: h.y, z: h.z, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0 };
      }
      this.makeLocal(e, false);
    }
  }

  // ---------------- 연습 친구 ----------------
  onNpc(d) {
    if (!d) return;
    // 경기장: 이 자리는 경기 상태(점수·시간)를 나르는 데 씀
    if (this.space) { if (this.match) this.match.onState(d); else this.pendingState = d; return; }
    if (d.o === this.me) return;
    this.npcRemote = { o: d.o, s: d.s, b: d.b };
  }

  // ---------------- 알림 ----------------
  onEvent(ev) {
    if (!ev) return;
    const by = this.nameOf(ev.b);
    switch (ev.k) {
      case 'goal': {
        const h = this.items.hoops[ev.h] || this.items.hoops[0];
        this.hud.popup(ev.b === this.me ? '골! 🏀' : `${by} 골! 🏀`);
        this.sound.goal();
        this.effects.confetti(h.x, h.y + 0.2, h.z);
        h.netWobble = 1;
        break;
      }
      case 'pull':
        if (ev.to === this.me) {
          this.avatar.loseFlag();
          this.hud.popup(`앗! ${by}에게 플래그를 뺏겼어요`);
          this.sound.fail();
        } else if (ev.b !== this.me) {
          const p = this.players.get(ev.to);
          if (p) this.effects.sparkle(p.position.x, p.position.y + 0.75, p.position.z);
        }
        break;
      case 'pass':
        if (ev.to === this.me && ev.b !== this.me) {
          this.incomingPass = { idx: ev.i, foot: !!ev.f, until: performance.now() + 4000, from: ev.b };
          this.hud.toast(`${by}의 패스! 🙌`);
        }
        break;
      case 'pt': case 'start': case 'rs':
        if (this.match) this.match.onEvent(ev);
        break;
      case 'npcpull':
        if (this.isHost && ev.b !== this.me) this.npc.pullFlag();
        break;
      case 'reset':
        if (ev.b !== this.me) {
          this.game.resetAll(true);
          this.hud.toast(`${by} 님이 정리했어요 🧺`);
        }
        for (const e of this.entries) { e.owner = null; e.target = null; this.makeLocal(e, false); }
        break;
    }
  }

  // 정리 버튼: 모두의 체육관을 정리
  broadcastReset() {
    this.room.sendEvent({ k: 'reset' });
    for (const e of this.entries) this.room.setItem(e.idx, { o: '', s: '', h: '' });
  }

  sendGoal(hoop) {
    this.room.sendEvent({ k: 'goal', h: this.items.hoops.indexOf(hoop) });
  }

  // ---------------- 매 프레임 (물리 계산 뒤) ----------------
  update(dt) {
    const now = performance.now();
    this.sendTimer -= dt;
    const sendNow = this.sendTimer <= 0;
    if (sendNow) this.sendTimer = 1 / SEND_HZ;

    // 내 상태 보내기 (바뀌었을 때만)
    if (sendNow) {
      const s = encodePlayerState(this.avatar, this.actionSeq);
      if (s !== this.lastMyState) {
        this.lastMyState = s;
        this.room.setMyState(s);
      }
    }

    for (const p of this.players.values()) p.update(dt);

    const me = this.avatar.position;
    for (const e of this.entries) {
      const remote = e.owner && e.owner !== this.me;
      if (remote) {
        // 받은 위치로 부드럽게
        const t = e.target;
        if (t) {
          const b = e.body;
          const k = Math.min(1, 15 * dt);
          const nx = b.position.x + (t.x - b.position.x) * k;
          const ny = b.position.y + (t.y - b.position.y) * k;
          const nz = b.position.z + (t.z - b.position.z) * k;
          b.velocity.set((nx - b.position.x) / Math.max(dt, 0.001), (ny - b.position.y) / Math.max(dt, 0.001), (nz - b.position.z) / Math.max(dt, 0.001));
          b.position.set(nx, ny, nz);
          if (e.it) {
            e.it.mesh.position.set(nx, ny, nz);
            const q = new THREE.Quaternion(t.qx, t.qy, t.qz, t.qw).normalize();
            e.it.mesh.quaternion.slerp(q, k);
            if (e.it.def.hoop) b.quaternion.set(0, 0, 0, 1);
            else b.quaternion.set(q.x, q.y, q.z, q.w);
          }
        }
        // 몸으로 밀면 내가 주인 (친구가 들고 있지 않고, 방금 바뀌지 않았을 때)
        if (!(e.it && e.it.remoteHolder) && now - e.changedAt > 1000 && this.touching(e, me)) this.claim(e);
      } else if (e.owner === this.me && sendNow) {
        const s = this.stateOf(e);
        if (s !== e.last) {
          e.last = s;
          const holder = e.it && e.it.held ? this.me : '';
          this.room.updateItem(e.idx, { s, h: holder });
        }
      } else if (!e.owner && this.touching(e, me) && this.count > 1) {
        // 아무도 주인이 아닌 공을 밀면 내가 주인
        this.claim(e);
      }
    }

    if (!this.space) this.updateNpc(dt);

    if (this.isHost) {
      this.cleanTimer -= dt;
      if (this.cleanTimer <= 0) { this.cleanTimer = 30; this.room.cleanEvents(); }
    }
  }

  // 내 아바타가 이 물체에 닿았나 (밀기)
  touching(e, me) {
    const b = e.body;
    if (e.kind === 'equip') {
      b.updateAABB();
      const a = b.aabb;
      const m = 0.45;
      return me.x > a.lowerBound.x - m && me.x < a.upperBound.x + m && me.z > a.lowerBound.z - m && me.z < a.upperBound.z + m;
    }
    const r = e.it.def.r;
    const dy = b.position.y - (me.y + 0.8);
    if (Math.abs(dy) > 0.8 + r) return false;
    return Math.hypot(b.position.x - me.x, b.position.z - me.z) < r + 0.42;
  }

  // 연습 친구: 방장이 움직이고, 나머지는 따라 그림
  updateNpc(dt) {
    const npc = this.npc;
    if (this.isHost) {
      npc.remote = false;
      this.npcTimer -= dt;
      if (this.npcTimer <= 0) {
        this.npcTimer = 1 / 8;
        const p = npc.body.position;
        const s = [r2(p.x), r2(p.z), r2(npc.heading), r2(npc.anim.moveAmount), npc.flagsLeft].join(',');
        if (s !== this.lastNpc || npc.bubbleText !== this.lastBubble) {
          this.lastNpc = s;
          this.lastBubble = npc.bubbleText;
          this.room.setNpc({ o: this.me, s, b: npc.bubbleText || '' });
        }
      }
    } else if (this.npcRemote) {
      npc.applyRemote(this.npcRemote, dt);
    }
  }
}
