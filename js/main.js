import * as THREE from 'three';
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { createPhysics, PHYSICS_STEP } from './physics.js';
import { buildGym } from './gym.js';
import { Avatar } from './avatar.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { Items } from './items.js';
import { BadmintonNet } from './badminton.js';
import { FlagBeltBox, PracticeFriend } from './flagFootball.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { VolleyballFixedNet, MovableVolleyPosts, ChukballFrame } from './equipment.js';

// ---------- 학교명 표시 ----------
const title = `${CONFIG.schoolName} ${CONFIG.appName}`;
document.title = title;
for (const el of document.querySelectorAll('[data-school-title]')) el.textContent = title;

// ---------- 렌더러 (모바일 성능 우선: 그림자 끔, 해상도 배율 제한) ----------
const canvas = document.getElementById('scene');
const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isCoarse, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.graphics.maxPixelRatio));
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
const items = new Items(scene, physics, gym, {
  onGoal: () => hud.popup('골! 🏀'),
});
const badmintonNet = new BadmintonNet(scene, physics, 9, 0); // 오른쪽 배드민턴 코트

// ---------- 3단계: 고정·동작 기구 ----------
new VolleyballFixedNet(scene, physics);                       // 가운데 배구 코트 (고정)
const volleyPosts = new MovableVolleyPosts(scene, physics, [{ x: -9.5, z: -9.7 }, { x: -12.5, z: -9.7 }]);
const chukball = new ChukballFrame(scene, physics, -9, 7, +1); // +x 쪽을 바라봄
const beltBox = new FlagBeltBox(scene, physics, 10, -10.2);
const npc = new PracticeFriend(scene, physics, 8, -4, { minX: -15.5, maxX: 16.3, minZ: -10.4, maxZ: 10.4 });
const game = new Game({
  avatar, items, camCtl, input, hud, npc, beltBox,
  resettables: [badmintonNet, volleyPosts, chukball],
});
document.getElementById('btn-reset').addEventListener('click', () => game.resetAll());

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

document.getElementById('btn-start').addEventListener('click', () => {
  if (input.isTouch) tryLandscape();
  startScreen.classList.add('hidden');
  document.body.classList.add('playing');
  running = true;
  if (!storage.get('help_seen', false)) {
    document.getElementById('help').classList.add('show');
    storage.set('help_seen', true);
    setTimeout(() => document.getElementById('help').classList.remove('show'), 7000);
  }
});
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
  if (running) game.update(dt);

  // 이동 방향 (카메라 기준). 줄넘기·훌라후프 중에는 제자리
  const m = running && !game.movementLocked ? input.getMove() : { x: 0, y: 0 };
  camCtl.forward(fwd);
  camCtl.right(right);
  moveDir.set(0, 0, 0).addScaledVector(fwd, m.y).addScaledVector(right, m.x);
  const jump = running && input.consume('jump');

  npc.update(dt, avatar.position);
  avatar.applyInput(dt, moveDir, jump);
  physics.world.step(PHYSICS_STEP, dt, 12);
  avatar.afterPhysics(dt);
  npc.sync(dt);
  items.update(dt);
  badmintonNet.update();
  volleyPosts.update();
  chukball.update();
  game.postPhysics();

  // 앞으로 걸을 때는 카메라가 천천히 등 뒤로
  if (!input.dragging && m.y > 0.3) camCtl.followHeading(avatar.heading, m.y, dt);
  camCtl.update(dt, avatar.position);

  renderer.render(scene, camera);
  input.endFrame();

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
window.__gym = { scene, avatar, camCtl, physics, input, items, game, npc, badmintonNet, volleyPosts, chukball };
