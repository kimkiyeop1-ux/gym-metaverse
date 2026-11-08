// ============================================================
//  여러 명 접속용 연결 (방 하나 = 체육관 하나)
//   - FirebaseRoom: 실제 서비스 (Firebase 실시간 데이터베이스 + 익명 로그인)
//   - LocalRoom   : 테스트용. 같은 브라우저의 여러 탭끼리 연결 (주소에 ?net=local)
//  두 방식 모두 같은 함수를 제공한다.
//
//  데이터 구조 (Firebase): rooms/{방}/
//     p/{사용자id}  = { n: 닉네임, s: 상태문자열, t: 입장시각 }   ← 나가면 자동 삭제
//     i/{번호}      = { o: 주인id, s: 상태문자열, h: 들고있는사람id }   ← 공·기구
//     npc           = { o: 계산하는사람id, s: 상태문자열 }
//     e/{자동키}     = { k: 종류, b: 보낸사람id, ..., t: 시각 }   ← 골·플래그 등 알림
// ============================================================
export const MAX_PLAYERS = 30;

// 방 코드: 글자·숫자·한글·-_ 만, 최대 12자. 비우면 '공용'
export function cleanRoomCode(s) {
  const c = String(s || '').trim().replace(/[^0-9A-Za-z가-힣_-]/g, '').slice(0, 12);
  return c || '공용';
}

const BAD_WORDS = ['시발', '씨발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '개새', '좆', '존나', 'ㅈㄴ', '니애미', '느금', 'fuck', 'shit', 'bitch'];
// 닉네임: 1~8자, 공백 정리, 나쁜 말 막기. 문제가 있으면 null
export function cleanNickname(s) {
  const n = String(s || '').replace(/\s+/g, ' ').trim().slice(0, 8);
  if (!n) return null;
  const low = n.toLowerCase().replace(/\s/g, '');
  if (BAD_WORDS.some((w) => low.includes(w))) return null;
  return n;
}

// ------------------------------------------------------------
//  Firebase
// ------------------------------------------------------------
export class FirebaseRoom {
  constructor(config) {
    this.config = config;
    this.handlers = { player: [], playerRemove: [], item: [], npc: [], event: [] };
    this.offset = 0;
  }

  // 받는 쪽이 아직 준비되지 않았을 때 온 소식은 모아 뒀다가 전달
  on(type, fn) {
    this.handlers[type].push(fn);
    const rest = [];
    for (const [t, a] of this.pending || []) (t === type ? fn(...a) : rest.push([t, a]));
    this.pending = rest;
  }

  emit(type, ...a) {
    if (!this.handlers[type].length) { (this.pending ||= []).push([type, a]); return; }
    for (const f of this.handlers[type]) f(...a);
  }

  async join(room, name) {
    const fb = await import('firebase-lib');
    this.fb = fb;
    const app = fb.initializeApp(this.config, 'gym-metaverse');
    // 탭마다 따로 로그인 (같은 기기에서 탭 2개를 열어도 다른 사람으로 보이게)
    const auth = fb.initializeAuth(app, { persistence: fb.inMemoryPersistence });
    const cred = await fb.signInAnonymously(auth);
    this.myId = cred.user.uid;
    const db = fb.getDatabase(app);
    this.db = db;
    this.base = fb.ref(db, `rooms/${room}`);

    // 서버 시간 차이 (알림 순서용)
    fb.onValue(fb.ref(db, '.info/serverTimeOffset'), (snap) => { this.offset = snap.val() || 0; });

    // 정원 확인
    const ps = await fb.get(fb.child(this.base, 'p'));
    const count = ps.exists() ? Object.keys(ps.val()).length : 0;
    if (count >= MAX_PLAYERS && !(ps.val() || {})[this.myId]) return { ok: false, reason: 'full' };

    this.meRef = fb.child(this.base, `p/${this.myId}`);
    await fb.onDisconnect(this.meRef).remove();
    await fb.set(this.meRef, { n: name, s: '', t: fb.serverTimestamp() });

    const pRef = fb.child(this.base, 'p');
    fb.onChildAdded(pRef, (s) => this.emit('player', s.key, s.val()));
    fb.onChildChanged(pRef, (s) => this.emit('player', s.key, s.val()));
    fb.onChildRemoved(pRef, (s) => this.emit('playerRemove', s.key));

    const iRef = fb.child(this.base, 'i');
    fb.onChildAdded(iRef, (s) => this.emit('item', Number(s.key), s.val()));
    fb.onChildChanged(iRef, (s) => this.emit('item', Number(s.key), s.val()));

    fb.onValue(fb.child(this.base, 'npc'), (s) => { if (s.exists()) this.emit('npc', s.val()); });

    // 입장한 뒤에 생긴 알림만 받기
    const since = Date.now() + this.offset - 2000;
    const eQ = fb.query(fb.child(this.base, 'e'), fb.orderByChild('t'), fb.startAt(since));
    fb.onChildAdded(eQ, (s) => this.emit('event', s.val(), s.key));
    return { ok: true };
  }

  now() {
    return Date.now() + this.offset;
  }

  setMyState(s) {
    this.fb.update(this.meRef, { s });
  }

  // 주인 바꾸기 (전체 덮어쓰기)
  setItem(idx, data) {
    this.fb.set(this.fb.child(this.base, `i/${idx}`), data).catch(() => {});
  }

  // 위치만 갱신 (주인은 그대로). 이미 다른 사람이 주인이면 보안 규칙이 거절함
  updateItem(idx, data) {
    this.fb.update(this.fb.child(this.base, `i/${idx}`), data).catch(() => {});
  }

  setNpc(data) {
    this.fb.set(this.fb.child(this.base, 'npc'), data).catch(() => {});
  }

  sendEvent(ev) {
    this.fb.push(this.fb.child(this.base, 'e'), { ...ev, b: this.myId, t: this.fb.serverTimestamp() });
  }

  // 오래된 알림 지우기 (방장만 가끔 호출)
  async cleanEvents() {
    const fb = this.fb;
    const old = fb.query(fb.child(this.base, 'e'), fb.orderByChild('t'), fb.startAt(0));
    const snap = await fb.get(old);
    if (!snap.exists()) return;
    const cut = this.now() - 60000;
    const upd = {};
    snap.forEach((c) => { if ((c.val().t || 0) < cut) upd[c.key] = null; });
    if (Object.keys(upd).length) fb.update(fb.child(this.base, 'e'), upd);
  }

  leave() {
    if (this.meRef) this.fb.remove(this.meRef);
  }
}

// ------------------------------------------------------------
//  테스트용: 같은 브라우저 탭끼리 (BroadcastChannel)
// ------------------------------------------------------------
export class LocalRoom {
  constructor() {
    this.handlers = { player: [], playerRemove: [], item: [], npc: [], event: [] };
    this.players = new Map(); // id -> {data, seen}
    this.items = new Map();
  }

  // 받는 쪽이 아직 준비되지 않았을 때 온 소식은 모아 뒀다가 전달
  on(type, fn) {
    this.handlers[type].push(fn);
    const rest = [];
    for (const [t, a] of this.pending || []) (t === type ? fn(...a) : rest.push([t, a]));
    this.pending = rest;
  }

  emit(type, ...a) {
    if (!this.handlers[type].length) { (this.pending ||= []).push([type, a]); return; }
    for (const f of this.handlers[type]) f(...a);
  }

  async join(room, name) {
    this.myId = 'L' + Math.random().toString(36).slice(2, 9);
    this.me = { n: name, s: '', t: Date.now() };
    this.ch = new BroadcastChannel('gym-net-' + room);
    this.ch.onmessage = (e) => this.recv(e.data);
    this.emit('player', this.myId, this.me);
    this.send({ k: 'hello', id: this.myId, d: this.me });
    this.beat = setInterval(() => {
      this.send({ k: 'p', id: this.myId, d: this.me });
      const now = Date.now();
      for (const [id, p] of this.players) {
        if (now - p.seen > 6000) { this.players.delete(id); this.emit('playerRemove', id); }
      }
    }, 2000);
    window.addEventListener('pagehide', () => this.leave());
    return { ok: true };
  }

  send(m) {
    this.ch.postMessage(m);
  }

  recv(m) {
    switch (m.k) {
      case 'hello':
        this.gotPlayer(m.id, m.d);
        // 새로 온 사람에게 내 정보·공 상태 알려주기
        this.send({ k: 'p', id: this.myId, d: this.me });
        for (const [idx, d] of this.items) if (d.o === this.myId) this.send({ k: 'i', idx, d });
        break;
      case 'p': this.gotPlayer(m.id, m.d); break;
      case 'bye': this.players.delete(m.id); this.emit('playerRemove', m.id); break;
      case 'i': this.items.set(m.idx, m.d); this.emit('item', m.idx, m.d); break;
      case 'npc': this.emit('npc', m.d); break;
      case 'e': this.emit('event', m.d); break;
    }
  }

  gotPlayer(id, d) {
    this.players.set(id, { data: d, seen: Date.now() });
    this.emit('player', id, d);
  }

  now() {
    return Date.now();
  }

  setMyState(s) {
    this.me.s = s;
    this.send({ k: 'p', id: this.myId, d: this.me });
  }

  setItem(idx, d) {
    this.items.set(idx, d);
    this.send({ k: 'i', idx, d });
  }

  updateItem(idx, d) {
    const cur = this.items.get(idx);
    if (cur && cur.o && cur.o !== this.myId) return; // Firebase 규칙과 같게: 주인이 아니면 무시
    const merged = { ...(cur || { o: this.myId }), ...d };
    this.items.set(idx, merged);
    this.send({ k: 'i', idx, d: merged });
  }

  setNpc(d) {
    this.send({ k: 'npc', d });
  }

  sendEvent(ev) {
    const d = { ...ev, b: this.myId, t: Date.now() };
    this.send({ k: 'e', d });
    this.emit('event', d); // 나에게도
  }

  cleanEvents() {}

  leave() {
    if (!this.ch) return;
    this.send({ k: 'bye', id: this.myId });
    clearInterval(this.beat);
  }
}
