import * as THREE from 'three';

// 가벼운 이펙트: 골 색종이, 플래그 반짝임, 추크볼 고리. 미리 만들어 둔 물체를 재사용(모바일 부담 적게).
const COLORS = ['#ff5fa2', '#ffd23f', '#2ec4b6', '#2a5bd7', '#e63946', '#7bd389'];

// 가운데가 진하고 가장자리가 흐린 원 (그림자·먼지)
function softCircle(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.6)'));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 둥근 그림자 (진짜 그림자 계산 대신 바닥에 흐린 원을 깔아 모바일 부담 거의 없음)
// 매 프레임 begin() → put(...) 여러 번 → end()
export class BlobShadows {
  constructor(scene, groundY) {
    this.scene = scene;
    this.groundY = groundY; // (x, z) => 바닥 높이
    this.tex = softCircle('rgba(0,0,0,1)');
    this.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pool = [];
    this.used = 0;
  }

  begin() {
    this.used = 0;
  }

  // bottomY: 물체 아래쪽 높이, size: 그림자 지름
  put(x, bottomY, z, size) {
    let m = this.pool[this.used];
    if (!m) {
      m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0.3 }));
      m.renderOrder = 1;
      this.scene.add(m);
      this.pool.push(m);
    }
    this.used++;
    const gy = this.groundY(x, z);
    const h = Math.max(0, bottomY - gy);
    if (h > 6) { m.visible = false; return; }
    const k = 1 - Math.min(0.55, h * 0.13);
    m.visible = true;
    m.position.set(x, gy + 0.014, z);
    m.scale.set(size * k, 1, size * k);
    m.material.opacity = 0.4 * (1 - Math.min(0.75, h * 0.16));
  }

  end() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // 색종이 조각
    const geo = new THREE.PlaneGeometry(0.07, 0.11);
    const mats = COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    this.bits = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      m.visible = false;
      scene.add(m);
      this.bits.push({ m, v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 });
    }
    this.next = 0;
    // 고리 (추크볼)
    this.rings = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.025, 6, 24),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthWrite: false })
      );
      m.visible = false;
      scene.add(m);
      return { m, life: 0 };
    });
    this.nextRing = 0;

    // 먼지 (착지·세게 떨어진 공)
    const dustMat = new THREE.SpriteMaterial({ map: softCircle('rgba(255,255,255,1)'), color: '#e9e2d6', transparent: true, depthWrite: false });
    this.dusts = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Sprite(dustMat.clone());
      m.visible = false;
      scene.add(m);
      this.dusts.push({ m, v: new THREE.Vector3(), life: 0, max: 0.5, size: 0.3 });
    }
    this.nextDust = 0;
  }

  // 먼지 퐁: 바닥에서 옆으로 퍼짐. power 0~1
  dust(x, y, z, power = 1) {
    const n = Math.round(4 + power * 4);
    for (let i = 0; i < n; i++) {
      const d = this.dusts[this.nextDust];
      this.nextDust = (this.nextDust + 1) % this.dusts.length;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const sp = (0.8 + Math.random() * 0.6) * (0.5 + power);
      d.v.set(Math.cos(a) * sp, 0.25 + Math.random() * 0.3, Math.sin(a) * sp);
      d.m.position.set(x + Math.cos(a) * 0.15, y + 0.08, z + Math.sin(a) * 0.15);
      d.size = (0.18 + Math.random() * 0.12) * (0.6 + power * 0.6);
      d.m.scale.setScalar(d.size);
      d.m.material.opacity = 0.75;
      d.m.visible = true;
      d.life = 0;
      d.max = 0.45 + Math.random() * 0.2;
    }
  }

  spawn(n, x, y, z, speed, upward, life, scale = 1) {
    for (let i = 0; i < n; i++) {
      const b = this.bits[this.next];
      this.next = (this.next + 1) % this.bits.length;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      b.v.set(Math.cos(a) * s, upward * (0.6 + Math.random() * 0.8), Math.sin(a) * s);
      b.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      b.m.position.set(x, y, z);
      b.m.scale.setScalar(scale);
      b.m.visible = true;
      b.life = 0;
      b.max = life * (0.7 + Math.random() * 0.5);
      b.scale = scale;
    }
  }

  // 골: 림 위에서 색종이 팡!
  confetti(x, y, z) {
    this.spawn(40, x, y, z, 2.2, 4, 1.8);
  }

  // 플래그 뽑기: 작은 반짝임
  sparkle(x, y, z) {
    this.spawn(14, x, y, z, 1.2, 2, 0.8, 0.7);
  }

  // 추크볼: 그물에서 퍼지는 고리. normal = 그물 앞면 방향
  ring(x, y, z, normal) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.m.position.set(x, y, z);
    r.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(normal.x, normal.y, normal.z));
    r.m.scale.setScalar(0.3);
    r.m.material.opacity = 1;
    r.m.visible = true;
    r.life = 0;
  }

  update(dt) {
    for (const b of this.bits) {
      if (!b.m.visible) continue;
      b.life += dt;
      if (b.life >= b.max) { b.m.visible = false; continue; }
      b.v.y -= 6 * dt;
      b.v.multiplyScalar(1 - 1.8 * dt); // 공기 저항으로 천천히 떨어짐
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += b.spin.x * dt;
      b.m.rotation.y += b.spin.y * dt;
      b.m.rotation.z += b.spin.z * dt;
      const k = 1 - Math.max(0, (b.life - b.max * 0.7) / (b.max * 0.3));
      b.m.scale.setScalar(b.scale * k);
    }
    for (const d of this.dusts) {
      if (!d.m.visible) continue;
      d.life += dt;
      const t = d.life / d.max;
      if (t >= 1) { d.m.visible = false; continue; }
      d.v.multiplyScalar(1 - 4 * dt);
      d.m.position.addScaledVector(d.v, dt);
      d.m.scale.setScalar(d.size * (1 + t * 1.6));
      d.m.material.opacity = 0.75 * (1 - t);
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.life += dt;
      const t = r.life / 0.45;
      if (t >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.3 + t * 2.2);
      r.m.material.opacity = 1 - t;
    }
  }
}
