import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createFloorTexture } from './courtLines.js';

// 체육관 만들기: 바닥·라인·벽·천장·창문·출입문·무대·농구대
// 반환값 colliders: 카메라가 벽을 뚫지 않도록 검사할 메시 목록
export function buildGym(scene, physics, renderer) {
  const { length: L, width: W, height: H, stageDepth: SD, stageHeight: SH } = CONFIG.gym;
  const hx = L / 2, hz = W / 2;
  const T = 0.4; // 벽 두께
  const stageBack = -hx - SD;     // 무대 뒷벽 x
  const stageFront = -hx + 0.6;   // 무대 앞(에이프런) x

  const colliders = [];
  const matCache = new Map();
  const mat = (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
    return matCache.get(key);
  };

  // 상자 하나 (보이는 메시 + 선택적으로 물리 충돌체)
  function box(w, h, d, x, y, z, color, { collide = true, camBlock = collide, material } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material || mat(color));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    if (collide) physics.addStaticBox(x, y, z, w / 2, h / 2, d / 2);
    if (camBlock) colliders.push(mesh);
    return mesh;
  }

  // ---------------- 바닥 ----------------
  const floorTex = createFloorTexture(L, W, renderer);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshLambertMaterial({ map: floorTex })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  colliders.push(floor);
  // 바닥 충돌체 (무대 영역까지 포함)
  physics.addStaticBox((stageBack + hx) / 2, -0.5, 0, (hx - stageBack) / 2 + 1, 0.5, hz + 1);

  // ---------------- 벽 ----------------
  const wallColor = '#f3ead8';
  const padColor = '#3c7d8c';
  const innerLen = hx - stageBack; // 무대 포함 전체 길이
  const midX = (hx + stageBack) / 2;

  for (const s of [-1, 1]) {
    // 긴 벽 (z = ±hz)
    box(innerLen + 2 * T, H, T, midX, H / 2, s * (hz + T / 2), wallColor);
    // 벽 아래 보호 매트
    box(L, 2, 0.08, 0, 1, s * (hz - 0.04), padColor, { collide: false, camBlock: false });
  }
  // +x 끝벽
  box(T, H, W, hx + T / 2, H / 2, 0, wallColor);
  box(0.08, 2, W, hx - 0.04, 1, 0, padColor, { collide: false, camBlock: false });
  // 무대 뒷벽
  box(T, H, W, stageBack - T / 2, H / 2, 0, '#e8dcc4');

  // ---------------- 천장 ----------------
  box(innerLen + 2 * T, T, W + 2 * T, midX, H + T / 2, 0, '#dfe3e8');
  // 천장 보 (깊이감)
  for (let x = -14; x <= 14; x += 4) {
    box(0.3, 0.5, W, x, H - 0.25, 0, '#b9c0c8', { collide: false, camBlock: false });
  }
  // 천장 조명 (빛나는 판)
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fffbe8' });
  for (let x = -12; x <= 12; x += 8) {
    for (const z of [-6, 0, 6]) {
      box(1.6, 0.08, 0.6, x, H - 0.55, z, null, { collide: false, camBlock: false, material: lampMat });
    }
  }

  // ---------------- 높은 창문 ----------------
  const glassMat = new THREE.MeshBasicMaterial({ color: '#bfe3f7' });
  const frameColor = '#8a9aa6';
  for (const s of [-1, 1]) {
    for (let x = -12; x <= 12; x += 6) {
      const z = s * (hz - 0.03);
      box(3.6, 2.2, 0.04, x, 5.9, z, null, { collide: false, camBlock: false, material: glassMat });
      // 창틀
      box(3.8, 0.12, 0.08, x, 7.0, z, frameColor, { collide: false, camBlock: false });
      box(3.8, 0.12, 0.08, x, 4.8, z, frameColor, { collide: false, camBlock: false });
      box(0.1, 2.2, 0.08, x, 5.9, z, frameColor, { collide: false, camBlock: false });
      box(3.6, 0.06, 0.08, x, 5.9, z, frameColor, { collide: false, camBlock: false });
    }
  }

  // ---------------- 출입문 (+z 벽, +x 쪽) ----------------
  {
    const dx = 12.5, z = hz - 0.06;
    box(2.8, 2.9, 0.1, dx, 1.45, z, '#5b4636', { collide: false, camBlock: false }); // 문틀
    for (const o of [-0.62, 0.62]) {
      box(1.15, 2.6, 0.1, dx + o, 1.3, z - 0.03, '#a0704a', { collide: false, camBlock: false });
      box(0.4, 0.6, 0.02, dx + o, 1.85, z - 0.09, null, { collide: false, camBlock: false, material: glassMat });
      box(0.06, 0.4, 0.06, dx + o * 0.15, 1.1, z - 0.12, '#cccccc', { collide: false, camBlock: false });
    }
    // 비상구 표시
    const exitMat = new THREE.MeshBasicMaterial({ color: '#2fbf5f' });
    box(0.9, 0.35, 0.05, dx, 3.2, z - 0.05, null, { collide: false, camBlock: false, material: exitMat });
  }

  // ---------------- 무대 ----------------
  // 무대 바닥 (에이프런 포함)
  box(stageFront - stageBack, SH, W, (stageFront + stageBack) / 2, SH / 2, 0, '#8b5a3c');
  box(stageFront - stageBack, 0.04, W, (stageFront + stageBack) / 2, SH + 0.02, 0, '#c58a55', { collide: false, camBlock: false });
  // 무대 앞 프로시니엄 벽 (가운데 개구부 폭 12m, 높이 SH~SH+4)
  const openHalf = 6, openTop = SH + 4;
  const pX = -hx - T / 2;
  const sideW = hz - openHalf;
  for (const s of [-1, 1]) {
    box(T, H - SH, sideW, pX, SH + (H - SH) / 2, s * (openHalf + sideW / 2), wallColor);
    // 무대 아래쪽(바닥~무대 높이)은 무대 박스가 막아줌
  }
  box(T, H - openTop, openHalf * 2, pX, openTop + (H - openTop) / 2, 0, wallColor);
  // 무대 커튼 (양옆, 장식)
  for (const s of [-1, 1]) {
    box(0.15, 4, 1.4, pX - 0.4, SH + 2, s * (openHalf - 0.7), '#a3263a', { collide: false, camBlock: false });
  }
  box(0.15, 0.7, openHalf * 2, pX - 0.4, openTop - 0.35, 0, '#a3263a', { collide: false, camBlock: false });

  // 학교명 현수막
  scene.add(makeBanner(CONFIG.schoolName, pX + T / 2 + 0.02, H - 0.62));

  // 무대 계단 (양쪽) — 보이는 계단 + 보이지 않는 경사로 충돌체
  const steps = 5, run = 2.0;
  for (const s of [-1, 1]) {
    const cz = s * 4.6;
    for (let i = 0; i < steps; i++) {
      const h = SH * (steps - i) / steps;
      const x = stageFront + (i + 0.5) * (run / steps);
      box(run / steps, h, 1.4, x, h / 2, cz, i % 2 ? '#9a6845' : '#8b5a3c', { collide: false });
    }
    addRamp(physics, stageFront, stageFront + run, SH, cz, 1.4);
  }

  // ---------------- 벽걸이 농구대 2개 ----------------
  const rimFromBaseline = 1.575;
  const hoops = [
    buildHoop(scene, physics, box, +1, 14 - rimFromBaseline, hx),
    buildHoop(scene, physics, box, -1, -(14 - rimFromBaseline), -hx),
  ];

  return { colliders, hoops, bounds: { minX: stageBack, maxX: hx, minZ: -hz, maxZ: hz } };
}

// 계단 위를 부드럽게 오르내리기 위한 경사로 충돌체
function addRamp(physics, xTop, xBottom, height, cz, width) {
  const run = xBottom - xTop;
  const len = Math.hypot(run, height);
  const angle = -Math.atan2(height, run); // +x 로 갈수록 내려감
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  const thick = 0.1;
  const nx = -Math.sin(angle), ny = Math.cos(angle); // 경사면 법선
  const cx = (xTop + xBottom) / 2 - nx * thick / 2;
  const cy = height / 2 - ny * thick / 2;
  physics.addStaticBox(cx, cy, cz, len / 2 + 0.05, thick / 2, width / 2, q);
}

// 벽걸이 농구대. dir: +1 이면 +x 벽, -1 이면 -x 벽(무대 쪽)
function buildHoop(scene, physics, box, dir, rimX, wallX) {
  const rimY = 3.05;
  const S = CONFIG.equipment.ballScale; // 공을 키운 만큼 림도 키움
  const rimR = 0.225 * S;
  const boardX = rimX + dir * (rimR + 0.15); // 백보드 면
  const boardT = 0.05;
  const boardCX = boardX + dir * boardT / 2;
  const noCam = { collide: false, camBlock: false };

  // 백보드 (반투명) + 테두리
  const boardMat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
  box(boardT, 1.05, 1.8, boardCX, rimY + 0.45, 0, null, { collide: true, camBlock: false, material: boardMat });
  const red = '#d23a2a';
  const fx = boardX - dir * 0.005;
  box(0.02, 0.05, 1.8, fx, rimY + 0.95, 0, red, noCam);
  box(0.02, 0.05, 1.8, fx, rimY - 0.05, 0, red, noCam);
  box(0.02, 1.05, 0.05, fx, rimY + 0.45, 0.88, red, noCam);
  box(0.02, 1.05, 0.05, fx, rimY + 0.45, -0.88, red, noCam);
  // 슈팅 사각형
  box(0.02, 0.04, 0.59, fx, rimY + 0.15, 0, red, noCam);
  box(0.02, 0.04, 0.59, fx, rimY + 0.6, 0, red, noCam);
  box(0.02, 0.45, 0.04, fx, rimY + 0.375, 0.28, red, noCam);
  box(0.02, 0.45, 0.04, fx, rimY + 0.375, -0.28, red, noCam);

  // 림
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rimR, 0.018 * S, 6, 24),
    new THREE.MeshLambertMaterial({ color: '#ff6a1a' })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(rimX, rimY, 0);
  scene.add(rim);
  box(0.15, 0.04, 0.12, rimX + dir * (rimR + 0.075), rimY, 0, '#ff6a1a', noCam); // 림 받침
  // (림을 키운 만큼 백보드가 뒤로 물러남)
  // 림 충돌체: 작은 구 20개를 원형으로 배치 (공이 림에 맞고 튕김)
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    physics.addStaticSphere(rimX + Math.cos(a) * rimR, rimY, Math.sin(a) * rimR, 0.02 * S, physics.materials.rim);
  }

  // 그물 (와이어프레임 원뿔대)
  const net = new THREE.Mesh(
    new THREE.CylinderGeometry(rimR, rimR * 0.6, 0.42 * S, 12, 3, true),
    new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.8 })
  );
  net.position.set(rimX, rimY - 0.21 * S, 0);
  scene.add(net);
  const hoop = { x: rimX, y: rimY, z: 0, r: rimR, dir, net, netY: rimY - 0.21 * S, goals: 0 };

  // 지지대: 백보드 뒤 세로 기둥 + 벽까지 가로 보 + 사선 보
  const steel = '#3d4752';
  const postX = boardX + dir * 0.2;
  const topY = 5.6;
  const postH = topY - rimY + 0.3;
  const postY = (topY + rimY - 0.3) / 2;
  box(0.18, postH, 0.18, postX, postY, 0.55, steel, noCam);
  box(0.18, postH, 0.18, postX, postY, -0.55, steel, noCam);
  box(0.1, 0.1, 1.2, postX, rimY + 0.45, 0, steel, noCam);
  box(0.18, 0.18, 1.3, postX, topY, 0, steel, noCam);
  // 백보드 아래 보호 패드
  box(0.1, 0.07, 1.84, boardCX, rimY - 0.08, 0, '#1f2a5c', noCam);
  const span = Math.abs(wallX - postX);
  const midX = (wallX + postX) / 2;
  for (const z of [0.55, -0.55]) {
    box(span, 0.18, 0.18, midX, topY, z, steel, noCam);
    // 사선 보 (기둥 아래쪽 → 벽 위쪽)
    const y1 = rimY + 0.5, y2 = topY;
    const len = Math.hypot(span, y2 - y1);
    const brace = box(len, 0.12, 0.12, midX, (y1 + y2) / 2, z, steel, noCam);
    brace.rotation.z = Math.atan2(y2 - y1, span) * (dir > 0 ? 1 : -1);
  }
  // 벽 고정판
  box(0.06, 0.8, 1.7, wallX - dir * 0.03, topY, 0, steel, noCam);
  return hoop;
}

function makeBanner(text, x, y) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f2a5c';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px "Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 4, c.width - 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.94), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.rotation.y = Math.PI / 2; // +x 방향(관중석 쪽)을 바라봄
  mesh.position.set(x, y, 0);
  return mesh;
}
