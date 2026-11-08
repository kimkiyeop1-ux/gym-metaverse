import * as THREE from 'three';

// 가벼운 이펙트: 골 색종이, 플래그 반짝임, 추크볼 고리. 미리 만들어 둔 물체를 재사용(모바일 부담 적게).
const COLORS = ['#ff5fa2', '#ffd23f', '#2ec4b6', '#2a5bd7', '#e63946', '#7bd389'];

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
