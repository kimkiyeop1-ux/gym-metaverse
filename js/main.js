import * as THREE from 'three';
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { createPhysics } from './physics.js';
import { buildGym } from './gym.js';
import { Avatar } from './avatar.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';

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

// ---------- FPS 표시 (주소 뒤에 ?fps) ----------
const fpsEl = document.getElementById('fps');
const showFps = new URLSearchParams(location.search).has('fps');
if (showFps) fpsEl.hidden = false;
let fpsFrames = 0, fpsTime = 0;

// ---------- 시작 화면 ----------
const startScreen = document.getElementById('start');
let running = false;
document.getElementById('btn-start').addEventListener('click', () => {
  startScreen.classList.add('hidden');
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

  // 이동 방향 (카메라 기준)
  const m = running ? input.getMove() : { x: 0, y: 0 };
  camCtl.forward(fwd);
  camCtl.right(right);
  moveDir.set(0, 0, 0).addScaledVector(fwd, m.y).addScaledVector(right, m.x);
  const jump = running && input.consume('jump');

  avatar.applyInput(dt, moveDir, jump);
  physics.world.step(1 / 60, dt, 4);
  avatar.afterPhysics(dt);

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
window.__gym = { scene, avatar, camCtl, physics, input };
