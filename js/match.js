import * as THREE from 'three';
import { FUTSAL_GOAL } from './equipment.js';

// ============================================================
//  종목별 경기 (7단계)
//   - 자유 체육관(로비)의 경기 발판에서 '경기 참가' → 그 종목 경기장(따로 된 방)으로 이동
//   - 경기장: 자동 팀(빨강/파랑 조끼), 2명 이상이면 '경기 시작', 3·2·1 뒤 5분 경기, 점수 자동 판정
//   - 점수·시간은 방장(가장 먼저 들어온 사람)이 정하고 모두에게 알림 (Firebase 의 npc 자리 사용)
//
//  코트 방향: 빨강 팀은 -x(또는 -z) 쪽에서 시작해 +x 쪽으로 공격
// ============================================================
export const MATCH_SECONDS = 300;
const TEAM_NAME = { r: '빨강', b: '파랑' };
const TEAM_ICON = { r: '🔴', b: '🔵' };
const other = (t) => (t === 'r' ? 'b' : 'r');

// 줄 맞춰 서기: i 번째 사람 위치 (가로 3명씩)
function lineUp(i, frontX, dir, spreadZ = 2.4) {
  const row = Math.floor(i / 3), col = i % 3;
  return { x: frontX - dir * row * 1.6, z: (col - 1) * spreadZ };
}

const FUTSAL_X = 15.5; // 풋살 골라인
// 휴대폰·태블릿이면 키 글자 대신 '버튼'으로 안내
const isTouch = () => document.body.classList.contains('touch');

export const SPORTS = {
  bb: {
    name: '농구', icon: '🏀', color: '#f28c3c', ball: 'basketball',
    items: [['basketball', 0, 0]],
    help: (t) => `${t === 'b' ? '무대 쪽' : '무대 반대편'} 골대 · 2점, 3점 라인 밖 3점 · ${isTouch() ? '블락 버튼' : 'Q 블락'}`,
    spawn: (team, i) => { const d = team === 'r' ? 1 : -1; const p = lineUp(i, -d * 3, d); return { ...p, heading: d * Math.PI / 2 }; },
    restart: () => ({ x: 0, z: 0 }),
  },
  fs: {
    name: '풋살', icon: '⚽', color: '#2ec4b6', ball: 'futsal',
    items: [['futsal', 0, 0]],
    help: (t) => `${t === 'b' ? '무대 쪽' : '무대 반대편'} 골문에 넣으면 1점!`,
    spawn: (team, i) => { const d = team === 'r' ? 1 : -1; const p = lineUp(i, -d * 3, d); return { ...p, heading: d * Math.PI / 2 }; },
    restart: () => ({ x: 0, z: 0 }),
  },
  vb: {
    name: '배구', icon: '🏐', color: '#ffd23f', ball: 'volleyball',
    items: [['volleyball', -9.7, 0]],
    help: () => '공이 상대 코트에 떨어지면 1점! 득점한 팀이 서브',
    spawn: (team, i) => { const d = team === 'r' ? 1 : -1; const p = lineUp(i, -d * 2.5, d, 2.6); return { ...p, heading: d * Math.PI / 2 }; },
    restart: (serve) => ({ x: serve === 'r' ? -9.7 : 9.7, z: 0 }),
    side: (x) => (x < 0 ? 'r' : 'b'),
    inCourt: (x, z) => Math.abs(x) <= 9.05 && Math.abs(z) <= 4.55,
  },
  bd: {
    name: '배드민턴', icon: '🏸', color: '#7ab8ff', ball: 'shuttle',
    items: [['shuttle', 9, -2.5]],
    help: () => (isTouch() ? '상대 코트에 떨어지면 1점 · 기술 버튼으로 치기' : '상대 코트에 떨어지면 1점 · F 클리어 · Q 드롭 · R 헤어핀 · E 스매시'),
    // 배드민턴 코트는 x = 9 를 가운데로, 네트가 z = 0 에 놓임 → 빨강은 -z 쪽
    spawn: (team, i) => {
      const d = team === 'r' ? 1 : -1;
      const row = Math.floor(i / 2), col = i % 2;
      return { x: 9 + (col - 0.5) * 2.2, z: -d * (2.8 + row * 1.6), heading: team === 'r' ? 0 : Math.PI };
    },
    restart: (serve) => ({ x: 9, z: serve === 'r' ? -2.5 : 2.5 }),
    side: (x, z) => (z < 0 ? 'r' : 'b'),
    inCourt: (x, z) => Math.abs(x - 9) <= 3.1 && Math.abs(z) <= 6.75,
  },
};
export const SPORT_CODES = Object.keys(SPORTS);

// ------------------------------------------------------------
//  로비의 경기 발판 + 간판 (+z 벽 쪽)
// ------------------------------------------------------------
const KIOSK_Z = 9.2;
const KIOSK_X = { bb: -9, fs: -3, vb: 3, bd: 9 };
const FONT = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

export class Kiosks {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.signs = {};
    this.active = true;
    this.t = 0;
    for (const code of SPORT_CODES) {
      const sp = SPORTS[code];
      const x = KIOSK_X[code];
      // 바닥 발판 (빛나는 원)
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: sp.color, transparent: true, opacity: 0.75, depthWrite: false })
      );
      pad.position.set(x, 0.016, KIOSK_Z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })
      );
      ring.position.set(x, 0.018, KIOSK_Z);
      // 간판 (기둥 2개 + 판)
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 160;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.06), new THREE.MeshBasicMaterial({ map: tex }));
      board.position.set(x, 1.95, KIOSK_Z + 1.15);
      board.rotation.y = Math.PI; // 체육관 가운데(-z 쪽)를 바라봄
      const postMat = new THREE.MeshLambertMaterial({ color: '#3d4752' });
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.06), postMat);
        post.position.set(x + s * 0.8, 1.2, KIOSK_Z + 1.17);
        this.group.add(post);
      }
      this.group.add(pad, ring, board);
      this.signs[code] = { c, tex, count: 0, pad, ring };
      this.drawSign(code);
    }
  }

  drawSign(code) {
    const sp = SPORTS[code];
    const s = this.signs[code];
    const g = s.c.getContext('2d');
    g.fillStyle = '#1f2a5c';
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = sp.color;
    g.fillRect(0, 0, 256, 12);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 38px ${FONT}`;
    g.fillText(`${sp.icon} ${sp.name}`, 128, 52, 240);
    g.font = `bold 24px ${FONT}`;
    g.fillStyle = '#ffd23f';
    g.fillText('경기장 ▶', 128, 98, 240);
    g.font = `20px ${FONT}`;
    g.fillStyle = '#c9d1f0';
    g.fillText(s.count > 0 ? `지금 ${s.count}명 있어요` : '발판에 올라서요', 128, 134, 240);
    s.tex.needsUpdate = true;
  }

  setCount(code, n) {
    const s = this.signs[code];
    if (!s || s.count === n) return;
    s.count = n;
    this.drawSign(code);
  }

  // 발판 위에 서 있으면 그 종목 코드
  near(p) {
    if (!this.active) return null;
    for (const code of SPORT_CODES) {
      if (Math.hypot(p.x - KIOSK_X[code], p.z - KIOSK_Z) < 1.1) return code;
    }
    return null;
  }

  spot(code) {
    return { x: KIOSK_X[code], z: KIOSK_Z };
  }

  setActive(on) {
    this.active = on;
    this.group.visible = on;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    for (const code of SPORT_CODES) {
      const s = this.signs[code];
      const k = 1 + Math.sin(this.t * 3 + KIOSK_X[code]) * 0.04;
      s.ring.scale.set(k, 1, k);
    }
  }
}

// ------------------------------------------------------------
//  경기 진행
// ------------------------------------------------------------
export class Match {
  constructor({ code, mp, avatar, camCtl, items, game, hud, sound, effects }) {
    Object.assign(this, { code, mp, avatar, camCtl, items, game, hud, sound, effects });
    this.sport = SPORTS[code];
    this.state = { phase: 'wait', startAt: 0, endsAt: 0, endedAt: 0, r: 0, b: 0, serve: 'r', seq: 0 };
    this.armed = false;   // 배구·배드민턴: 공이 떠올랐다가 바닥에 닿으면 판정
    this.goalArmed = true; // 풋살: 골 한 번만
    this.pubTimer = 0;
    this.lastCount = -1;
    this.el = {
      bar: document.getElementById('matchbar'),
      r: document.getElementById('mb-r'),
      b: document.getElementById('mb-b'),
      time: document.getElementById('mb-time'),
      info: document.getElementById('mb-info'),
      start: document.getElementById('btn-match-start'),
      count: document.getElementById('countdown'),
      title: document.getElementById('mb-title'),
    };
  }

  get ball() {
    return this.items.list.find((i) => i.type === this.sport.ball);
  }

  now() {
    return this.mp ? this.mp.room.now() : Date.now();
  }

  get isHost() {
    return this.mp ? this.mp.isHost : true;
  }

  get playerCount() {
    return this.mp ? this.mp.count : 1;
  }

  // ---------------- 들어오기·나가기 ----------------
  enter() {
    this.el.title.textContent = `${this.sport.icon} ${this.sport.name}`;
    this.el.bar.hidden = false;
    document.body.classList.add('inmatch');
    if (this.mp && this.mp.pendingState) this.onState(this.mp.pendingState);
    // 먼저 와 있던 친구들의 팀 정보가 도착한 뒤에 팀 고르기
    this.avatar.setTeam('r');
    this.teleport();
    this.render(true);
    this.teamTimer = setTimeout(() => this.pickTeam(), this.mp ? 900 : 0);
  }

  // 팀: 사람이 적은 쪽 (같으면 빨강)
  pickTeam() {
    let team = 'r';
    if (this.mp) {
      let r = 0, b = 0;
      for (const p of this.mp.players.values()) { if (p.team === 'r') r++; else if (p.team === 'b') b++; }
      team = b < r ? 'b' : 'r';
    }
    this.avatar.setTeam(team);
    this.teleport();
    this.render(true);
    this.hud.toast(`${this.sport.icon} ${this.sport.name} 경기장 · 나는 ${TEAM_ICON[team]} ${TEAM_NAME[team]} 팀`);
  }

  leave() {
    clearTimeout(this.teamTimer);
    clearTimeout(this.resetTimer);
    this.avatar.setTeam('');
    this.el.bar.hidden = true;
    this.el.count.classList.remove('show');
    document.body.classList.remove('inmatch');
  }

  // 내 팀 안에서 몇 번째인지 → 줄 서는 자리
  teleport() {
    const team = this.avatar.team;
    let idx = 0;
    if (this.mp) {
      const mates = this.sortedIds().filter((id) => (id === this.mp.me ? team : this.mp.players.get(id)?.team) === team);
      idx = Math.max(0, mates.indexOf(this.mp.me));
    }
    const s = this.sport.spawn(team, idx);
    const b = this.avatar.body;
    b.position.set(s.x, 0.1, s.z);
    b.velocity.set(0, 0, 0);
    this.avatar.heading = s.heading;
    this.camCtl.yaw = s.heading + Math.PI;
  }

  // 입장 순서 (모든 기기에서 같은 순서)
  sortedIds() {
    const mp = this.mp;
    const ids = [mp.me, ...mp.players.keys()];
    const t = (id) => mp.joinTimes.get(id) ?? Infinity;
    return ids.sort((a, b) => t(a) - t(b) || (a < b ? -1 : 1));
  }

  // ---------------- 경기 상태 (방장이 정함) ----------------
  encode(st) {
    return [st.phase, st.startAt, st.endsAt, st.endedAt, st.r, st.b, st.serve, st.seq].join(',');
  }

  decode(s) {
    const f = String(s || '').split(',');
    if (f.length < 8) return null;
    const n = (i) => Number(f[i]) || 0;
    return { phase: f[0], startAt: n(1), endsAt: n(2), endedAt: n(3), r: n(4), b: n(5), serve: f[6] === 'b' ? 'b' : 'r', seq: n(7) };
  }

  publish(st) {
    st.seq = (this.state.seq || 0) + 1;
    this.apply(st);
    if (this.mp) this.mp.room.setNpc({ o: this.mp.me, s: this.encode(st), b: '' });
  }

  onState(d) {
    if (!d || (this.mp && d.o === this.mp.me)) return; // 내가 보낸 것 (이미 적용)
    const st = this.decode(d.s);
    if (!st || st.seq < this.state.seq) return; // 예전 소식
    this.apply(st);
  }

  apply(st) {
    const old = this.state, now = this.now();
    this.state = st;
    // (예전에 끝난 경기 기록을 받은 경우에는 시작·결과 표시를 하지 않음)
    if (st.phase === 'run' && old.phase !== 'run' && now < st.endsAt) this.onStart();
    if (st.phase === 'end' && old.phase === 'run' && now - st.endedAt < 5000) this.onEnd();
    if (st.r !== old.r || st.b !== old.b) this.render(true);
  }

  // 경기 시작: 입장 순서대로 빨강·파랑 번갈아 → 자기 자리로
  onStart() {
    if (this.mp) {
      const ids = this.sortedIds();
      this.avatar.setTeam(ids.indexOf(this.mp.me) % 2 === 0 ? 'r' : 'b');
    }
    this.teleport();
    this.armed = false;
    this.goalArmed = true;
    this.sound.whistle();
  }

  onEnd() {
    const { r, b } = this.state;
    const win = r === b ? null : r > b ? 'r' : 'b';
    this.hud.popup(win ? `${TEAM_ICON[win]} ${TEAM_NAME[win]} 팀 승리! ${r} : ${b}` : `무승부! ${r} : ${b}`);
    this.sound.whistle();
    if (win && win === this.avatar.team) {
      const p = this.avatar.position;
      this.effects.confetti(p.x, p.y + 2.2, p.z);
    }
  }

  requestStart() {
    if (this.playerCount < 2) { this.hud.toast('친구가 1명 이상 더 있어야 경기를 시작할 수 있어요'); return; }
    if (this.state.phase === 'run') return;
    if (this.mp) this.mp.room.sendEvent({ k: 'start' });
  }

  start() {
    const now = this.now();
    const startAt = now + 3500;
    this.publish({ phase: 'run', startAt, endsAt: startAt + MATCH_SECONDS * 1000, endedAt: 0, r: 0, b: 0, serve: 'r' });
    this.resetBall('r', 600);
  }

  get playing() {
    const st = this.state, now = this.now();
    return st.phase === 'run' && now >= st.startAt && now < st.endsAt;
  }

  // ---------------- 점수 ----------------
  point(team, n = 1) {
    this.lockUntil = performance.now() + 2600; // 공을 다시 놓을 때까지 판정 쉬기 (튀어서 두 번 점수 나지 않게)
    const ev = { k: 'pt', tm: team, n };
    if (this.mp) this.mp.room.sendEvent(ev);
    else this.onEvent({ ...ev, b: 'me' });
  }

  hoopGoal(hoop, n = 2) {
    this.point(hoop.x > 0 ? 'r' : 'b', n); // +x 골대 = 빨강이 공격하는 골대, 3점 라인 밖이면 3점
  }

  onEvent(ev) {
    switch (ev.k) {
      case 'start':
        if (this.isHost && this.state.phase !== 'run') this.start();
        break;
      case 'pt': {
        const tm = ev.tm === 'b' ? 'b' : 'r';
        const n = Math.max(1, Math.min(3, Number(ev.n) || 1));
        const who = this.mp && ev.b !== this.mp.me ? this.mp.nameOf(ev.b) : '';
        const counted = this.playing;
        this.hud.popup(counted ? `${TEAM_ICON[tm]} ${TEAM_NAME[tm]} +${n}${n === 3 ? ' 3점 슛!' : ''}${who ? ` (${who})` : ''}` : `${this.sport.icon} ${n === 3 ? '3점 ' : ''}골! (연습)`);
        this.sound.goal();
        if (this.isHost && counted) {
          const st = { ...this.state };
          st[tm] += n;
          st.serve = tm;
          this.publish(st);
          this.resetBall(this.code === 'vb' || this.code === 'bd' ? tm : other(tm), 1500);
        }
        break;
      }
      case 'rs': {
        // 공 다시 놓기: 들고 있던 사람은 내려놓음
        const it = this.ball;
        if (it && this.game.held === it) {
          this.items.setHeld(it, false);
          this.game.clearHeld();
        }
        break;
      }
    }
  }

  // 방장: 잠시 뒤 공을 다시 놓을 자리에 (모두 들고 있던 공을 놓게 알리고, 내가 주인이 되어 옮김)
  resetBall(serve, delay) {
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.mp) this.mp.room.sendEvent({ k: 'rs' });
      else this.onEvent({ k: 'rs' });
      setTimeout(() => {
        const it = this.ball;
        if (!it) return;
        if (this.game.held === it) { this.items.setHeld(it, false); this.game.clearHeld(); }
        if (this.mp) this.mp.claimItem(it);
        it.shotFrom = null;
        const p = this.sport.restart(serve);
        const b = it.body;
        b.position.set(p.x, it.home.y + 0.02, p.z);
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        b.wakeUp();
        it.flying = false;
        it.mesh.position.set(p.x, it.home.y, p.z);
        this.armed = false;
        this.goalArmed = true;
      }, 350);
    }, delay);
  }

  // ---------------- 매 프레임 ----------------
  update(dt) {
    const st = this.state, now = this.now();

    // 방장 할 일: 시간 끝 → 결과, 결과 6초 뒤 → 대기. 가끔 상태 다시 알림(늦게 온 사람용)
    if (this.isHost) {
      if (st.phase === 'run' && now >= st.endsAt + 5000) {
        this.publish({ ...st, phase: 'wait', r: 0, b: 0 }); // 아무도 없을 때 끝난 예전 경기
      } else if (st.phase === 'run' && now >= st.endsAt) {
        this.publish({ ...st, phase: 'end', endedAt: now });
      } else if (st.phase === 'end' && now >= st.endedAt + 6000) {
        this.publish({ ...st, phase: 'wait' });
      } else if (this.mp) {
        this.pubTimer -= dt;
        if (this.pubTimer <= 0) {
          this.pubTimer = 3;
          this.mp.room.setNpc({ o: this.mp.me, s: this.encode(this.state), b: '' });
        }
      }
    }

    this.detect();
    this.render(false);
  }

  // 내 화면에서 계산 중인 공으로 점수 판정 (주인 = 마지막으로 만진 사람)
  detect() {
    const it = this.ball;
    if (!it || it.held || it.remote || performance.now() < (this.lockUntil || 0)) return;
    const b = it.body.position, r = it.def.r;
    if (this.code === 'vb' || this.code === 'bd') {
      if (b.y > r + 0.5) this.armed = true;
      if (this.armed && b.y <= r + 0.05) {
        this.armed = false;
        if (!this.playing) return;
        const sp = this.sport;
        // 코트 안: 떨어진 쪽 팀이 실점 / 밖: 마지막으로 친 팀(나)이 실점
        const loser = sp.inCourt(b.x, b.z) ? sp.side(b.x, b.z) : (this.avatar.team || 'r');
        this.point(other(loser), 1);
      }
    } else if (this.code === 'fs') {
      if (Math.abs(b.x) < FUTSAL_X - 1.5) this.goalArmed = true;
      if (this.goalArmed && Math.abs(b.x) > FUTSAL_X + r && Math.abs(b.z) < FUTSAL_GOAL.halfW && b.y < FUTSAL_GOAL.h) {
        this.goalArmed = false;
        this.point(b.x > 0 ? 'r' : 'b', 1);
      }
    }
  }

  // ---------------- 화면 ----------------
  render(force) {
    const st = this.state, now = this.now(), el = this.el;
    const n = this.playerCount;
    let time = '5:00', info = '', count = '';
    const team = this.avatar.team;
    const me = team ? `나: ${TEAM_ICON[team]} ${TEAM_NAME[team]}` : '';
    if (st.phase === 'run') {
      if (now < st.startAt) {
        count = String(Math.ceil((st.startAt - now) / 1000));
        info = `${me} · 곧 시작!`;
      } else {
        const left = Math.max(0, Math.ceil((st.endsAt - now) / 1000));
        time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        info = `${me} · ${this.sport.help(team)}`;
        if (now - st.startAt < 1200) count = '시작!';
      }
    } else if (st.phase === 'end') {
      time = '종료';
      info = `${me} · 잠시 뒤 다시 경기할 수 있어요`;
    } else {
      info = n < 2 ? `${me} · 연습 중 · ${this.sport.help(team)}` : `${me} · ${n}명 · '경기 시작'을 누르면 시작해요`;
    }
    const key = [time, info, count, st.r, st.b, st.phase, n].join('|');
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    el.r.textContent = st.r;
    el.b.textContent = st.b;
    el.time.textContent = time;
    el.info.textContent = info;
    el.start.hidden = st.phase === 'run' || n < 2 || !this.mp;
    el.count.textContent = count;
    el.count.classList.toggle('show', !!count);
  }
}
