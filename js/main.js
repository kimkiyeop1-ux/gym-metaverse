import * as THREE from 'three';
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { createPhysics, PHYSICS_STEP } from './physics.js';
import { buildGym } from './gym.js';
import { Avatar, LOOK_OPTIONS, decodeLook, encodeLook } from './avatar.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { Items } from './items.js';
import { BadmintonNet } from './badminton.js';
import { FlagBeltBox, PracticeFriend } from './flagFootball.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { VolleyballFixedNet, ChukballFrame, FutsalGoal } from './equipment.js';
import { Kiosks, Match, SPORTS, SPORT_CODES } from './match.js';
import { buildStorageArea, slotX, STORAGE_Z, NameTag } from './storageArea.js';
import { Sound } from './sound.js';
import { Effects, BlobShadows } from './effects.js';
import { FirebaseRoom, LocalRoom, cleanNickname, cleanRoomCode, matchRoomKey } from './net.js';
import { Multiplayer } from './multiplayer.js';

// ---------- 학교명 표시 ----------
const title = `${CONFIG.schoolName} ${CONFIG.appName}`;
document.title = title;
for (const el of document.querySelectorAll('[data-school-title]')) el.textContent = title;

// 홈 화면 앱 이름에도 학교명 넣기 (config.js 한 곳에서 관리)
document.getElementById('apple-title').setAttribute('content', `${CONFIG.schoolName} 체육관`);
try {
  const base = new URL('./', location.href).href;
  const manifest = {
    name: title,
    short_name: `${CONFIG.schoolName} 체육관`,
    description: `${CONFIG.schoolName} 체육관을 3D로 재현한 가상 체육관`,
    lang: 'ko',
    start_url: base,
    scope: base,
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#1f2a5c',
    theme_color: '#1f2a5c',
    icons: [
      { src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: base + 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  document.getElementById('manifest-link').href =
    'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
} catch {
  /* 실패하면 기본 manifest.webmanifest 사용 */
}

// ---------- 렌더러 (모바일 성능 우선: 그림자 끔, 해상도 배율 제한) ----------
const canvas = document.getElementById('scene');
const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isCoarse, powerPreference: 'high-performance' });
// 화질(해상도 배율): 느린 휴대폰이면 자동으로 낮추고 다음에도 그 값으로 시작 (gym_pixel_ratio)
const maxRatio = Math.min(window.devicePixelRatio || 1, CONFIG.graphics.maxPixelRatio);
let pixelRatio = Math.min(maxRatio, storage.get('pixel_ratio', maxRatio));
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#cfe6f5');

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 120);

// 조명: 반구광 + 방향광 하나 (그림자 없음)
scene.add(new THREE.HemisphereLight('#ffffff', '#b08a60', 2.2));
const sun = new THREE.DirectionalLight('#fff4e0', 1.4);
sun.position.set(8, 20, 6);
scene.add(sun);

// ---------- 물리 + 체육관 + 아바타 ----------
const physics = createPhysics();
const gym = buildGym(scene, physics, renderer);
const avatar = new Avatar(scene, physics);
const camCtl = new ThirdPersonCamera(camera, gym.colliders);
camCtl.distance = storage.get('camera_distance', CONFIG.camera.distance);
const input = new Input(canvas);

// ---------- 2단계: 용기구 ----------
const hud = new Hud();
let mp = null; // 여러 명 접속 (입장할 때 연결)
const sound = new Sound();
const effects = new Effects(scene);
const items = new Items(scene, physics, gym, {
  onGoal: (hoop) => {
    if (match) { match.hoopGoal(hoop); return; } // 경기장: 팀 점수
    if (mp) { mp.sendGoal(hoop); return; } // 여러 명: 모두에게 알림 (알림으로 효과 표시)
    hud.popup('골! 🏀');
    sound.goal();
    effects.confetti(hoop.x, hoop.y + 0.2, hoop.z);
  },
  onImpact: (it, v) => {
    sound.impact(it.type, v);
    // 세게 바닥에 떨어진 공: 먼지 퐁
    const b = it.body.position, r = it.def.r;
    if (v > 6 && b.y - r < groundY(b.x, b.z) + 0.15) effects.dust(b.x, groundY(b.x, b.z), b.z, Math.min(1, (v - 6) / 8) * 0.5);
  },
});

// ---------- 그림자 (사람·공 밑 둥근 그림자) ----------
const STAGE_FRONT = -CONFIG.gym.length / 2 + 0.6;
function groundY(x) {
  return x < STAGE_FRONT ? CONFIG.gym.stageHeight + 0.04 : 0;
}
const shadows = new BlobShadows(scene, groundY);
function updateShadows() {
  shadows.begin();
  const ap = avatar.position;
  shadows.put(ap.x, ap.y, ap.z, 0.85);
  const np = npc.position;
  if (npc.active) shadows.put(np.x, np.y, np.z, 0.85);
  if (mp) for (const ra of mp.players.values()) shadows.put(ra.position.x, ra.position.y, ra.position.z, 0.85);
  for (const it of items.list) {
    if (it.held || it.remoteHolder || it.def.rope || it.def.hoop || !it.mesh.visible) continue;
    const b = it.mesh.position, r = it.def.r;
    shadows.put(b.x, b.y - r, b.z, Math.max(0.18, r * 2.3));
  }
  shadows.end();
}
const badmintonNet = new BadmintonNet(scene, physics, 9, 0); // 오른쪽 배드민턴 코트

// ---------- 3단계: 고정·동작 기구 ----------
// 배구·배드민턴 네트, 풋살 골대는 그 종목 경기장에서만 놓임 (자유 체육관에서는 치움)
const volleyNet = new VolleyballFixedNet(scene, physics);      // 가운데 배구 코트 (고정)
const futsalGoals = [new FutsalGoal(scene, physics, 15.5, -1), new FutsalGoal(scene, physics, -15.5, 1)];
const kiosks = new Kiosks(scene);                              // 경기장 가는 발판 (+z 벽 쪽)
const chukball = new ChukballFrame(scene, physics, -9, 7, +1); // +x 쪽을 바라봄
chukball.onBounce = () => {
  sound.chuk();
  const p = chukball.body.position;
  effects.ring(p.x + chukball.normal.x * 0.05, 0.75, p.z, chukball.normal);
};
buildStorageArea(scene);
const beltBox = new FlagBeltBox(scene, physics, slotX('flagbelt'), STORAGE_Z);
const npc = new PracticeFriend(scene, physics, 8, -4, { minX: -15.5, maxX: 16.3, minZ: -8.6, maxZ: 10.4 });
// 가까이 가면 이름이 뜨는 큰 기구 (위치는 매 프레임 읽음) — 자유 체육관 전용
const lobbyLandmarks = [
  { name: '🚩 플래그 벨트', pos: () => beltBox.pos, y: 1.0 },
  { name: '추크볼 골대', pos: () => chukball.body.position, y: 1.7 },
];
const game = new Game({
  avatar, items, camCtl, input, hud, npc, beltBox,
  resettables: [chukball],
  nameTag: new NameTag(scene),
  sound,
  effects,
  landmarks: lobbyLandmarks,
});
game.kiosks = kiosks;
game.onJoinSport = (code) => switchSpace(code);

// ---------- 공간: 자유 체육관(로비) ↔ 종목 경기장 ----------
let space = null;      // null = 자유 체육관, 'bb'·'fs'·'vb'·'bd' = 경기장
let match = null;      // 경기 진행 (경기장에서만)
let roomCode = null;   // 여러 명: 입장한 방 코드
let myName = null;
let unwatchCounts = null;
let switching = false;

function applySpaceLayout(code) {
  const lobby = !code;
  game.releaseAll();
  volleyNet.setActive(code === 'vb');
  badmintonNet.setActive(code === 'bd');
  for (const g of futsalGoals) g.setActive(code === 'fs');
  chukball.setActive(lobby);
  beltBox.setActive(lobby);
  npc.setActive(lobby);
  kiosks.setActive(lobby);
  if (!lobby) avatar.setWearingFlags(false);
  items.setSpace(lobby ? null : SPORTS[code].items);
  game.landmarks = lobby ? lobbyLandmarks : [];
  game.resettables = lobby ? [chukball] : [];
  game.setAutoRacket(code === 'bd');
  // 배구 경기장: 네트(x = 0) 앞에서 블로킹, 스파이크는 네트를 넘겨 상대 코트로
  game.blockNet = code === 'vb' ? { x: 0, h: CONFIG.equipment.volleyNetHeight } : null;
  document.getElementById('btn-reset').textContent = lobby ? '🧺 정리' : '🔄 공 놓기';
}
applySpaceLayout(null);

// 방 연결 (code: null 이면 자유 체육관). 실패하면 이유 문자열
async function connect(code) {
  const conn = netMode === 'local' ? new LocalRoom() : new FirebaseRoom(CONFIG.firebase);
  const res = await withTimeout(conn.join(matchRoomKey(roomCode, code), myName), 12000);
  if (!res.ok) { conn.leave(); return res.reason === 'full' ? 'full' : 'error'; }
  mp = new Multiplayer({
    room: conn, scene, physics, avatar, items, game, npc, hud, sound, effects,
    equipment: code ? [] : [chukball],
    space: code,
  });
  game.mp = mp;
  window.__gym.mp = mp;
  hud.setPlayers(mp.playerList());
  if (!code) unwatchCounts = conn.watchCounts(roomCode, SPORT_CODES, (c, n) => kiosks.setCount(c, n));
  return null;
}

function disconnect() {
  if (unwatchCounts) { unwatchCounts(); unwatchCounts = null; }
  if (mp) { mp.dispose(); mp = null; game.mp = null; window.__gym.mp = null; }
}

async function switchSpace(code, from = space) {
  if (switching) return;
  switching = true;
  try {
    if (match) { match.leave(); match = null; }
    disconnect();
    space = code;
    applySpaceLayout(code);
    if (!code) {
      // 자유 체육관으로 돌아옴: 방금 경기한 종목 발판 앞
      const k = from ? kiosks.spot(from) : null;
      avatar.body.position.set(k ? k.x : CONFIG.player.spawn.x, 0.1, k ? k.z - 1.6 : CONFIG.player.spawn.z);
      avatar.body.velocity.set(0, 0, 0);
      avatar.heading = Math.PI;
      camCtl.yaw = 0;
    }
    if (netMode && roomCode) {
      hud.toast(code ? `${SPORTS[code].icon} ${SPORTS[code].name} 경기장으로 이동 중...` : '자유 체육관으로 이동 중...');
      let fail = null;
      try { fail = await connect(code); } catch (e) { console.warn('connect failed', e); fail = 'error'; }
      if (fail) {
        hud.toast(fail === 'full' ? '경기장이 가득 찼어요 (최대 30명)' : '연결하지 못했어요. 잠시 뒤 다시 해 주세요.');
        if (code) { switching = false; return switchSpace(null, code); }
      }
    }
    if (code) {
      match = new Match({ code, mp, avatar, camCtl, items, game, hud, sound, effects });
      if (mp) mp.match = match;
      match.enter();
    } else if (mp) {
      hud.toast(`'${roomCode}' 방 자유 체육관 · 발판에 서면 종목별 경기장으로 갈 수 있어요`);
    }
    sound.whistle();
  } finally {
    switching = false;
  }
}
document.getElementById('btn-exit').addEventListener('click', () => switchSpace(null));
document.getElementById('btn-match-start').addEventListener('click', () => { if (match) match.requestStart(); });
document.getElementById('btn-reset').addEventListener('click', () => game.resetAll());

// ---------- 꾸미기 (👕) : 머리 모양·머리색·신발색·등번호. 이 기기에 저장(gym_look), 친구 화면에도 보임 ----------
avatar.setLook(decodeLook(storage.get('look', '')) || avatar.look);
const lookPanel = document.getElementById('look-panel');
let lookOpen = false;
let lookSaved = null; // 열기 전 카메라
function renderLookPanel() {
  const l = avatar.look;
  const fill = (id, list, key, swatch) => {
    const el = document.getElementById(id);
    el.innerHTML = '';
    list.forEach((v, i) => {
      const b = document.createElement('button');
      if (swatch) { b.style.background = v; b.setAttribute('aria-label', `${i + 1}번 색`); } else b.textContent = v;
      b.classList.toggle('on', l[key] === i);
      b.addEventListener('click', () => setLookPart(key, i));
      el.appendChild(b);
    });
  };
  fill('look-h', LOOK_OPTIONS.hairStyles, 'h', false);
  fill('look-c', LOOK_OPTIONS.hairColors, 'c', true);
  fill('look-s', LOOK_OPTIONS.shoeColors, 's', true);
  document.getElementById('look-n').textContent = l.n;
}
function setLookPart(key, v) {
  avatar.setLook({ ...avatar.look, [key]: v });
  storage.set('look', encodeLook(avatar.look));
  renderLookPanel();
  sound.pop();
}
function openLook() {
  if (lookOpen || !running) return;
  lookOpen = true;
  lookSaved = { pitch: camCtl.pitch, distance: camCtl.distance };
  camCtl.yaw = avatar.heading; // 아바타 앞모습
  camCtl.pitch = 0.12;
  camCtl.distance = 2.6;
  renderLookPanel();
  game.showGrabMark(null);
  lookPanel.hidden = false;
  document.body.classList.add('looking');
}
function closeLook() {
  if (!lookOpen) return;
  lookOpen = false;
  camCtl.yaw = avatar.heading + Math.PI; // 다시 등 뒤로
  camCtl.pitch = lookSaved.pitch;
  camCtl.distance = lookSaved.distance;
  lookPanel.hidden = true;
  document.body.classList.remove('looking');
}
document.getElementById('btn-look').addEventListener('click', () => (lookOpen ? closeLook() : openLook()));
document.getElementById('look-done').addEventListener('click', closeLook);
document.getElementById('look-random').addEventListener('click', () => {
  const r = (n) => Math.floor(Math.random() * n);
  avatar.setLook({ h: r(LOOK_OPTIONS.hairStyles.length), c: r(LOOK_OPTIONS.hairColors.length), s: r(LOOK_OPTIONS.shoeColors.length), n: r(100) });
  storage.set('look', encodeLook(avatar.look));
  renderLookPanel();
  sound.pop();
});
// 번호 버튼: 꾹 누르면 빠르게 바뀜
for (const [id, d] of [['look-minus', -1], ['look-plus', 1]]) {
  const btn = document.getElementById(id);
  let timer = null;
  const step = () => {
    avatar.setLook({ ...avatar.look, n: (avatar.look.n + d + 100) % 100 });
    document.getElementById('look-n').textContent = avatar.look.n;
  };
  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; storage.set('look', encodeLook(avatar.look)); }
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    step();
    let n = 0;
    timer = setInterval(() => { if (++n > 4) step(); }, 90);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
}
window.addEventListener('keydown', (e) => { if (lookOpen && e.key === 'Escape') closeLook(); });

// ---------- FPS 표시 (주소 뒤에 ?fps) ----------
const fpsEl = document.getElementById('fps');
const showFps = new URLSearchParams(location.search).has('fps');
if (showFps) fpsEl.hidden = false;
let fpsFrames = 0, fpsTime = 0;

// ---------- 시작 화면 ----------
const startScreen = document.getElementById('start');
let running = false;
// ---------- 가로/세로 전환 ----------
// 안드로이드 크롬 등: 전체화면 + 화면 방향 고정으로 전환
// 아이폰 등 미지원 브라우저: 직접 돌려 달라는 안내 표시
const canLock = !!(document.documentElement.requestFullscreen && screen.orientation && screen.orientation.lock);
const portraitMQ = window.matchMedia('(orientation: portrait)');
const orientBtn = document.getElementById('btn-orient');
const toastEl = document.getElementById('toast');
let toastTimer = 0;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
}

async function lockOrientation(mode) {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock(mode);
    return true;
  } catch {
    return false;
  }
}

function tryLandscape() {
  if (canLock) return lockOrientation('landscape');
  return Promise.resolve(false);
}

async function toggleOrientation() {
  const toLandscape = portraitMQ.matches;
  if (!toLandscape) document.body.classList.add('portrait-ok'); // 세로를 직접 고름 → 안내 화면 안 띄움
  const ok = canLock && (await lockOrientation(toLandscape ? 'landscape' : 'portrait'));
  if (!ok) {
    toast(toLandscape
      ? '이 브라우저는 자동 전환을 지원하지 않아요. 휴대폰을 직접 가로로 돌려 주세요 (화면 자동 회전 켜기).'
      : '휴대폰을 직접 세로로 돌려 주세요.');
  }
}

function updateOrientBtn() {
  orientBtn.textContent = portraitMQ.matches ? '📱 가로로' : '📱 세로로';
}
portraitMQ.addEventListener('change', updateOrientBtn);
updateOrientBtn();
orientBtn.addEventListener('click', toggleOrientation);

document.getElementById('version').textContent = `버전 ${CONFIG.version}`;
if (!canLock) document.getElementById('btn-landscape').hidden = true;
document.getElementById('btn-landscape').addEventListener('click', tryLandscape);
document.getElementById('btn-portrait').addEventListener('click', () => {
  document.body.classList.add('portrait-ok');
});

// ---------- 홈 화면에 추가 ----------
const installBtn = document.getElementById('btn-install');
const isStandalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  || window.navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  // 안드로이드 크롬 등: 설치 창을 버튼으로 띄움
  e.preventDefault();
  installEvent = e;
  if (!isStandalone) installBtn.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  toast('홈 화면에 추가됐어요! 아이콘으로 바로 들어올 수 있어요.');
});
if (isIOS && !isStandalone) installBtn.hidden = false;
installBtn.addEventListener('click', async () => {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    installBtn.hidden = true;
  } else if (isIOS) {
    toast('사파리 아래쪽 공유 버튼(□↑)을 누르고 "홈 화면에 추가"를 고르세요.');
  }
});

// 소리 켜기/끄기 버튼
const soundBtn = document.getElementById('btn-sound');
function updateSoundBtn() {
  soundBtn.textContent = sound.enabled ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-label', sound.enabled ? '소리 끄기' : '소리 켜기');
}
soundBtn.addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  updateSoundBtn();
});
updateSoundBtn();

// ---------- 입장 (혼자 / 여러 명) ----------
// 여러 명: config.js 에 firebase 설정이 있으면 사용. 주소에 ?net=local 이면 같은 브라우저 탭끼리 테스트
// 사본(Fork) 사이트에서는 원래 주인의 Firebase 를 쓰지 않음 (config.js 의 firebaseSite 와 주소가 같을 때만)
const isDevHost = ['localhost', '127.0.0.1'].includes(location.hostname);
const firebaseOk = !!CONFIG.firebase && (isDevHost || !CONFIG.firebaseSite || location.hostname === CONFIG.firebaseSite);
const netMode = new URLSearchParams(location.search).get('net') === 'local' ? 'local'
  : firebaseOk ? 'firebase' : null;
if (CONFIG.firebase && !firebaseOk) {
  console.info('[가상 체육관] 이 주소는 config.js 의 firebaseSite 와 달라 여러 명 접속을 껐어요. README 의 "내 학교용으로 만들기"를 보세요.');
  document.getElementById('version').textContent += ' · 혼자 하기';
}
const startBtn = document.getElementById('btn-start');
const soloBtn = document.getElementById('btn-solo');
const nickEl = document.getElementById('nickname');
const roomEl = document.getElementById('roomcode');
const errEl = document.getElementById('join-error');
if (netMode) {
  document.getElementById('join-fields').hidden = false;
  soloBtn.hidden = false;
  nickEl.value = storage.get('nickname', '');
  roomEl.value = storage.get('room', '');
}

function showJoinError(msg) {
  errEl.textContent = msg;
  errEl.hidden = !msg;
}

function enterGame() {
  startScreen.classList.add('hidden');
  document.body.classList.add('playing');
  running = true;
  if (!storage.get('help_seen', false)) {
    document.getElementById('help').classList.add('show');
    storage.set('help_seen', true);
    setTimeout(() => document.getElementById('help').classList.remove('show'), 7000);
  }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function joinRoom() {
  const name = cleanNickname(nickEl.value);
  if (!name || name.length < 2) {
    showJoinError('닉네임을 2~8글자로 넣어 주세요 (바르고 고운 말로!)');
    nickEl.focus();
    return;
  }
  const room = cleanRoomCode(roomEl.value);
  storage.set('nickname', name);
  storage.set('room', roomEl.value.trim());
  showJoinError('');
  startBtn.disabled = true;
  startBtn.textContent = '연결 중...';
  try {
    roomCode = room;
    myName = name;
    const fail = await connect(null);
    if (fail) {
      roomCode = null;
      showJoinError(fail === 'full' ? '방이 가득 찼어요 (최대 30명). 다른 방 코드를 써 주세요.' : '들어갈 수 없어요.');
      return;
    }
    hud.toast(`'${room}' 방에 들어왔어요 · ${name} · 벽 쪽 발판에서 종목별 경기를 할 수 있어요`);
    enterGame();
  } catch (e) {
    console.warn('join failed', e);
    showJoinError('연결하지 못했어요. 인터넷을 확인하거나 [혼자 연습하기]를 눌러 주세요.');
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = '입장하기';
  }
}

startBtn.addEventListener('click', () => {
  sound.unlock();
  if (input.isTouch) tryLandscape(); // 터치한 순간에 해야 함
  if (netMode) joinRoom();
  else enterGame();
});
soloBtn.addEventListener('click', () => {
  sound.unlock();
  if (input.isTouch) tryLandscape();
  enterGame();
});
for (const el of [nickEl, roomEl]) {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBtn.click(); });
}
document.getElementById('btn-help').addEventListener('click', () => {
  document.getElementById('help').classList.toggle('show');
});

// ---------- 창 크기 변경 ----------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// ---------- 저사양 자동 조절: 4초 평균이 28fps 미만이면 해상도 배율을 한 단계 낮춤 ----------
const RATIO_STEPS = [1.5, 1.25, 1, 0.85, 0.7];
let speedFrames = 0, speedTime = 0, speedWarm = 3;
function checkSpeed(dt) {
  if (!running || document.hidden) { speedFrames = 0; speedTime = 0; return; }
  if (speedWarm > 0) { speedWarm -= dt; return; } // 처음 몇 초는 로딩 때문에 느릴 수 있어 건너뜀
  speedFrames++;
  speedTime += dt;
  if (speedTime < 4) return;
  const fps = speedFrames / speedTime;
  speedFrames = 0;
  speedTime = 0;
  if (fps >= 28) return;
  const next = RATIO_STEPS.find((r) => r < pixelRatio - 0.01);
  if (!next) return;
  pixelRatio = next;
  renderer.setPixelRatio(pixelRatio);
  storage.set('pixel_ratio', pixelRatio);
  hud.toast('부드럽게 움직이도록 화질을 조금 낮췄어요');
  speedWarm = 1;
}

// ---------- 메인 루프 ----------
const clock = new THREE.Clock();
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const moveDir = new THREE.Vector3();
let zoomSaveTimer = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);

  // 시점 회전 / 확대
  const look = input.takeLook();
  camCtl.rotate(look.x, look.y);
  const z = input.takeZoom();
  if (z) {
    camCtl.zoom(z);
    zoomSaveTimer = 0.5;
  }
  if (zoomSaveTimer > 0 && (zoomSaveTimer -= dt) <= 0) storage.set('camera_distance', camCtl.distance);

  // 기구 동작 (줄넘기 중이면 점프 입력을 '뛰기'로 먼저 가져감)
  if (running && !lookOpen) game.update(dt);

  // 이동 방향 (카메라 기준). 줄넘기·훌라후프 중에는 제자리
  const m = running && !lookOpen && !game.movementLocked ? input.getMove() : { x: 0, y: 0 };
  camCtl.forward(fwd);
  camCtl.right(right);
  moveDir.set(0, 0, 0).addScaledVector(fwd, m.y).addScaledVector(right, m.x);
  const jump = running && !lookOpen && input.consume('jump');

  // 연습 친구: 혼자일 때·방장일 때만 직접 움직임 (나머지는 방장 화면을 따라감)
  if (npc.active && (!mp || mp.isHost)) npc.update(dt, mp ? mp.nearestPersonTo(npc.position) : avatar.position);
  const wasGrounded = avatar.grounded;
  const fallSpeed = avatar.body.velocity.y;
  avatar.applyInput(dt, moveDir, jump);
  physics.world.step(PHYSICS_STEP, dt, 12);
  avatar.afterPhysics(dt);
  // 착지 먼지
  if (!wasGrounded && avatar.grounded && fallSpeed < -3.5) {
    const p = avatar.position;
    effects.dust(p.x, p.y, p.z, Math.min(1, (-fallSpeed - 3.5) / 5));
  }
  if (npc.active) npc.sync(dt);
  items.update(dt);
  badmintonNet.update();
  chukball.update();
  effects.update(dt);
  game.postPhysics(dt);
  if (mp) mp.update(dt);
  if (match && running) match.update(dt);
  kiosks.update(dt);

  // 앞으로 걸을 때는 카메라가 천천히 등 뒤로
  if (!input.dragging && m.y > 0.3) camCtl.followHeading(avatar.heading, m.y, dt);
  camCtl.update(dt, avatar.position);
  // 카메라가 아주 가까우면 내 아바타를 반투명하게 (앞이 가리지 않게)
  avatar.setFade(THREE.MathUtils.clamp((camCtl.currentDistance - 0.7) / 0.9, 0.25, 1));
  updateShadows();

  renderer.render(scene, camera);
  input.endFrame();

  checkSpeed(dt);

  if (showFps) {
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  }
}
renderer.setAnimationLoop(frame);

// 디버그/테스트용 (콘솔에서 확인)
window.__gym = { scene, avatar, camCtl, physics, input, items, game, npc, badmintonNet, chukball, kiosks,
  get match() { return match; }, get space() { return space; }, switchSpace };
