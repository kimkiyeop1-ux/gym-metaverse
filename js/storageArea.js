import * as THREE from 'three';

// ============================================================
//  용기구 보관 구역 (-z 벽 쪽)
//  칸마다 바닥 매트(이름 표시) + 벽 이름표. 정리 버튼을 누르면 각자 칸으로 돌아감.
// ============================================================
export const STORAGE_Z = -10.15; // 보관 칸 중심 z (벽은 -11)
const MAT_D = 1.4;               // 매트 깊이

// key: 칸 이름, items: [[용기구 종류, x], ...]
export const STORAGE_SLOTS = [
  { key: 'basketball', name: '농구공', icon: '🏀', x: -13.4, w: 1.6, color: '#f7c8a4',
    items: [['basketball', -13.85], ['basketball', -12.95]] },
  { key: 'futsal', name: '풋살공', icon: '⚽', x: -11.9, w: 1.1, color: '#e5e7eb', items: [['futsal', -11.9]] },
  { key: 'dodgeball', name: '피구공', icon: '🔴', x: -10.7, w: 1.1, color: '#f6c1c7', items: [['dodgeball', -10.7]] },
  { key: 'volleyball', name: '배구공', icon: '🏐', x: -9.5, w: 1.1, color: '#fbe7a1', items: [['volleyball', -9.5]] },
  { key: 'football', name: '플래그풋볼 공', icon: '🏈', x: -8.2, w: 1.3, color: '#e6c7a8', items: [['football', -8.2]] },
  { key: 'bigvolley', name: '빅발리볼', icon: '🎈', x: -6.7, w: 1.5, color: '#fcd5de', items: [['bigvolley', -6.7]] },
  { key: 'kinball', name: '킨볼', icon: '🩷', x: -4.75, w: 2.1, color: '#f9c6dc', items: [['kinball', -4.75]] },
  { key: 'frisbee', name: '플라잉디스크', icon: '🥏', x: -3.1, w: 1.0, color: '#bfeee8', items: [['frisbee', -3.1]] },
  { key: 'badminton', name: '라켓·셔틀콕', icon: '🏸', x: -1.8, w: 1.4, color: '#d5e4fb',
    items: [['racket', -2.15], ['shuttle', -1.45]] },
  { key: 'jumprope', name: '줄넘기', icon: '🪢', x: -0.4, w: 1.2, color: '#ffe0bf', items: [['jumprope', -0.4]] },
  { key: 'hulahoop', name: '훌라후프', icon: '⭕', x: 1.15, w: 1.5, color: '#e9d5fb', items: [['hulahoop', 1.15]] },
  { key: 'flagbelt', name: '플래그 벨트', icon: '🚩', x: 2.85, w: 1.5, color: '#ffd6d6', items: [] },
];

// 용기구 → 처음 자리 [type, x, z]
export function storagePlacement() {
  const out = [];
  for (const s of STORAGE_SLOTS) for (const [type, x] of s.items) out.push([type, x, STORAGE_Z]);
  return out;
}

export function slotX(key) {
  return STORAGE_SLOTS.find((s) => s.key === key).x;
}

const FONT = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function textTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

export function buildStorageArea(scene) {
  const wallZ = -10.94; // 벽 보호 매트 바로 앞

  // 전체 제목 (벽 위쪽)
  const left = STORAGE_SLOTS[0].x - STORAGE_SLOTS[0].w / 2;
  const last = STORAGE_SLOTS[STORAGE_SLOTS.length - 1];
  const right = last.x + last.w / 2;
  const titleW = 5;
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(titleW, 0.6),
    new THREE.MeshBasicMaterial({
      map: textTexture(1000, 120, (g, w, h) => {
        g.fillStyle = '#1f2a5c';
        roundRect(g, 0, 0, w, h, 30);
        g.fill();
        g.fillStyle = '#ffd23f';
        g.font = `bold 66px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🧺 용기구 보관 구역', w / 2, h / 2 + 3);
      }),
      transparent: true,
    })
  );
  title.position.set((left + right) / 2, 3.2, wallZ);
  scene.add(title);

  // 보관 구역 바닥 테두리 (노란 선)
  const border = new THREE.Mesh(
    new THREE.PlaneGeometry(right - left + 0.3, MAT_D + 0.3),
    new THREE.MeshBasicMaterial({ color: '#ffd23f' })
  );
  border.rotation.x = -Math.PI / 2;
  border.position.set((left + right) / 2, 0.003, STORAGE_Z);
  scene.add(border);

  for (const s of STORAGE_SLOTS) {
    // 바닥 매트 (칸 이름이 앞쪽에 적혀 있음)
    const pxW = Math.round(s.w * 160), pxH = Math.round(MAT_D * 160);
    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(s.w - 0.06, MAT_D),
      new THREE.MeshLambertMaterial({
        map: textTexture(pxW, pxH, (g, w, h) => {
          g.fillStyle = s.color;
          g.fillRect(0, 0, w, h);
          g.strokeStyle = 'rgba(31,42,92,0.55)';
          g.lineWidth = 6;
          g.strokeRect(3, 3, w - 6, h - 6);
          g.fillStyle = '#1f2a5c';
          g.font = `bold ${Math.min(30, (w / s.name.length) * 1.1)}px ${FONT}`;
          g.textAlign = 'center';
          g.textBaseline = 'bottom';
          g.fillText(s.name, w / 2, h - 10, w - 12);
        }),
      })
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(s.x, 0.006, STORAGE_Z);
    scene.add(mat);

    // 벽 이름표
    const signW = Math.min(s.w - 0.1, 1.4);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(signW, 0.5),
      new THREE.MeshBasicMaterial({
        map: textTexture(Math.round(signW * 200), 100, (g, w, h) => {
          g.fillStyle = '#ffffff';
          roundRect(g, 0, 0, w, h, 18);
          g.fill();
          g.strokeStyle = '#1f2a5c';
          g.lineWidth = 6;
          roundRect(g, 3, 3, w - 6, h - 6, 16);
          g.stroke();
          g.fillStyle = '#1f2a5c';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = `bold 34px ${FONT}`;
          g.fillText(s.icon, w / 2, 30);
          g.font = `bold ${Math.min(30, (w / s.name.length) * 1.15)}px ${FONT}`;
          g.fillText(s.name, w / 2, 72, w - 12);
        }),
        transparent: true,
      })
    );
    sign.position.set(s.x, 2.35, wallZ);
    scene.add(sign);
  }
}

// ============================================================
//  가까이 간 용기구 이름표 (머리 위에 떠 있는 말풍선 하나를 옮겨 다님)
// ============================================================
export class NameTag {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 80;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true }));
    this.sprite.scale.set(1.2, 0.3, 1);
    this.sprite.renderOrder = 11;
    this.sprite.visible = false;
    scene.add(this.sprite);
    this.text = '';
  }

  show(text, x, y, z) {
    if (!text) {
      this.sprite.visible = false;
      return;
    }
    if (text !== this.text) {
      this.text = text;
      const g = this.canvas.getContext('2d');
      g.clearRect(0, 0, 320, 80);
      g.font = `bold 40px ${FONT}`;
      const w = Math.min(310, g.measureText(text).width + 40);
      g.fillStyle = 'rgba(31,42,92,0.88)';
      roundRect(g, (320 - w) / 2, 6, w, 66, 33);
      g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 160, 41, 300);
      this.tex.needsUpdate = true;
    }
    this.sprite.position.set(x, y, z);
    this.sprite.visible = true;
  }
}
