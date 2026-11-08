import * as THREE from 'three';

// 나무 바닥 + 코트 라인을 캔버스 한 장에 그려 텍스처로 만든다.
// (라인을 3D 물체로 만들지 않으므로 모바일에서도 가볍다)
//
// 좌표: 캔버스 px = (x + L/2) * S, py = (z + W/2) * S
const S = 48; // 1m 당 픽셀

const COLORS = {
  basketball: '#ffffff',
  volleyball: '#ffd23f',
  badminton: '#3fbf6f',
  key: 'rgba(200, 70, 50, 0.35)',
  centerCircle: 'rgba(30, 50, 120, 0.25)',
};

export function createFloorTexture(length, width, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(length * S);
  canvas.height = Math.round(width * S);
  const ctx = canvas.getContext('2d');

  const px = (x) => (x + length / 2) * S;
  const pz = (z) => (z + width / 2) * S;

  drawWood(ctx, canvas.width, canvas.height);

  // ---------- 배드민턴 (초록) : 긴 쪽이 z 방향, 3면 ----------
  for (const cx of [-9, 0, 9]) drawBadminton(ctx, px, pz, cx, 0);

  // ---------- 배구 (노랑) : 18 x 9 ----------
  drawVolleyball(ctx, px, pz);

  // ---------- 농구 (흰색) : 28 x 15 ----------
  drawBasketball(ctx, px, pz);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function rand(seed) {
  // 매번 같은 무늬가 나오도록 간단한 의사 난수
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function drawWood(ctx, w, h) {
  const r = rand(12345);
  ctx.fillStyle = '#d8a46a';
  ctx.fillRect(0, 0, w, h);
  const plankW = 0.14 * S; // 판자 폭
  for (let y = 0; y < h; y += plankW) {
    let x = -r() * 3 * S;
    while (x < w) {
      const len = (1.8 + r() * 2.2) * S;
      const t = r();
      const light = 62 + t * 10;
      ctx.fillStyle = `hsl(32, 52%, ${light}%)`;
      ctx.fillRect(x, y, len, plankW);
      // 판자 끝 이음새
      ctx.fillStyle = 'rgba(90, 55, 20, 0.25)';
      ctx.fillRect(x, y, 1, plankW);
      x += len;
    }
    // 판자 사이 줄
    ctx.fillStyle = 'rgba(90, 55, 20, 0.18)';
    ctx.fillRect(0, y, w, 1);
  }
}

function line(ctx, color, width = 0.05) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width * S;
  ctx.lineCap = 'butt';
}

function rect(ctx, px, pz, x1, z1, x2, z2) {
  ctx.strokeRect(px(x1), pz(z1), px(x2) - px(x1), pz(z2) - pz(z1));
}

function seg(ctx, px, pz, x1, z1, x2, z2) {
  ctx.beginPath();
  ctx.moveTo(px(x1), pz(z1));
  ctx.lineTo(px(x2), pz(z2));
  ctx.stroke();
}

function drawBasketball(ctx, px, pz) {
  const hl = 14, hw = 7.5;
  const rimFromBaseline = 1.575;
  const threeR = 6.75;
  const threeSide = 6.6; // 사이드라인에서 0.9m 안쪽

  // 페인트 영역 / 센터 서클 색칠
  ctx.fillStyle = COLORS.key;
  for (const s of [-1, 1]) {
    const x1 = s * hl, x2 = s * (hl - 5.8);
    ctx.fillRect(Math.min(px(x1), px(x2)), pz(-2.45), Math.abs(px(x2) - px(x1)), pz(2.45) - pz(-2.45));
  }
  ctx.fillStyle = COLORS.centerCircle;
  ctx.beginPath();
  ctx.arc(px(0), pz(0), 1.8 * S, 0, Math.PI * 2);
  ctx.fill();

  line(ctx, COLORS.basketball);
  rect(ctx, px, pz, -hl, -hw, hl, hw);
  seg(ctx, px, pz, 0, -hw, 0, hw);
  ctx.beginPath();
  ctx.arc(px(0), pz(0), 1.8 * S, 0, Math.PI * 2);
  ctx.stroke();

  for (const s of [-1, 1]) {
    const base = s * hl;
    const ft = s * (hl - 5.8); // 자유투 라인
    // 제한구역
    rect(ctx, px, pz, Math.min(base, ft), -2.45, Math.max(base, ft), 2.45);
    // 자유투 원
    ctx.beginPath();
    ctx.arc(px(ft), pz(0), 1.8 * S, 0, Math.PI * 2);
    ctx.stroke();
    // 3점 라인
    const rimX = s * (hl - rimFromBaseline);
    const dx = Math.sqrt(threeR * threeR - threeSide * threeSide); // 직선→호 만나는 지점
    const joinX = rimX - s * dx;
    seg(ctx, px, pz, base, -threeSide, joinX, -threeSide);
    seg(ctx, px, pz, base, threeSide, joinX, threeSide);
    const a = Math.asin(threeSide / threeR);
    ctx.beginPath();
    if (s > 0) ctx.arc(px(rimX), pz(0), threeR * S, Math.PI - a, Math.PI + a);
    else ctx.arc(px(rimX), pz(0), threeR * S, -a, a);
    ctx.stroke();
    // 노차지 반원
    ctx.beginPath();
    if (s > 0) ctx.arc(px(rimX), pz(0), 1.25 * S, Math.PI / 2, Math.PI * 1.5);
    else ctx.arc(px(rimX), pz(0), 1.25 * S, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
}

function drawVolleyball(ctx, px, pz) {
  line(ctx, COLORS.volleyball);
  rect(ctx, px, pz, -9, -4.5, 9, 4.5);
  seg(ctx, px, pz, 0, -4.5, 0, 4.5);
  seg(ctx, px, pz, -3, -4.5, -3, 4.5);
  seg(ctx, px, pz, 3, -4.5, 3, 4.5);
}

function drawBadminton(ctx, px, pz, cx, cz) {
  const hw = 3.05, hl = 6.7; // 복식 6.1 x 13.4
  line(ctx, COLORS.badminton, 0.04);
  rect(ctx, px, pz, cx - hw, cz - hl, cx + hw, cz + hl);
  // 단식 사이드라인
  seg(ctx, px, pz, cx - hw + 0.46, cz - hl, cx - hw + 0.46, cz + hl);
  seg(ctx, px, pz, cx + hw - 0.46, cz - hl, cx + hw - 0.46, cz + hl);
  for (const s of [-1, 1]) {
    // 숏 서비스 라인
    seg(ctx, px, pz, cx - hw, cz + s * 1.98, cx + hw, cz + s * 1.98);
    // 복식 롱 서비스 라인
    seg(ctx, px, pz, cx - hw, cz + s * (hl - 0.76), cx + hw, cz + s * (hl - 0.76));
    // 센터 라인
    seg(ctx, px, pz, cx, cz + s * 1.98, cx, cz + s * hl);
  }
}
