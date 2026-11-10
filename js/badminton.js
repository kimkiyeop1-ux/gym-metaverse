import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// 배드민턴 지주 2개 + 네트 (한 덩어리). 아바타가 밀면 같이 움직인다.
// 가운데 코트(x = -3.05 ~ 3.05)의 z = 0 에 설치.
const NET_W = 6.1;          // 복식 코트 폭
const POST_H = 1.55;
const NET_TOP = 1.524;
const NET_H = 0.76;

export class BadmintonNet {
  constructor(scene, physics, x = 0, z = 0) {
    this.home = { x, z };
    const group = new THREE.Group();
    scene.add(group);
    this.group = group;

    const postMat = new THREE.MeshLambertMaterial({ color: '#2a5bd7' });
    const baseMat = new THREE.MeshLambertMaterial({ color: '#33363d' });
    const halfW = NET_W / 2 + 0.1;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, POST_H, 0.05), postMat);
      post.position.set(s * halfW, POST_H / 2, 0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.45), baseMat);
      base.position.set(s * halfW, 0.04, 0);
      group.add(post, base);
    }
    // 네트 (격자 무늬 반투명)
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(30,30,30,0.9)';
    g.lineWidth = 1;
    for (let i = 0; i <= 256; i += 4) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 32); g.stroke(); }
    for (let j = 0; j <= 32; j += 4) { g.beginPath(); g.moveTo(0, j); g.lineTo(256, j); g.stroke(); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(3, 1);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(NET_W, NET_H),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    );
    net.position.set(0, NET_TOP - NET_H / 2, 0);
    const band = new THREE.Mesh(new THREE.BoxGeometry(NET_W, 0.04, 0.012), new THREE.MeshLambertMaterial({ color: '#ffffff' }));
    band.position.set(0, NET_TOP - 0.02, 0);
    group.add(net, band);

    // 물리: 지주·받침은 기구 재질, 네트는 '걸리는' 재질
    // fixedRotation 을 쓰면 밀리지 않는 문제가 있어, 매 계산마다 똑바로 세워 둔다
    const body = new CANNON.Body({
      mass: 30,
      linearDamping: 0.95,
      material: physics.materials.equipment,
      allowSleep: false, // 잠들면 아바타가 통과하는 문제가 있어 항상 깨어 있게
    });
    for (const s of [-1, 1]) {
      const post = new CANNON.Box(new CANNON.Vec3(0.05, POST_H / 2, 0.05));
      post.material = physics.materials.equipment;
      body.addShape(post, new CANNON.Vec3(s * halfW, POST_H / 2, 0));
      const base = new CANNON.Box(new CANNON.Vec3(0.22, 0.04, 0.22));
      base.material = physics.materials.equipment;
      body.addShape(base, new CANNON.Vec3(s * halfW, 0.04, 0));
    }
    const netShape = new CANNON.Box(new CANNON.Vec3(NET_W / 2, NET_H / 2, 0.02));
    netShape.material = physics.materials.net;
    body.addShape(netShape, new CANNON.Vec3(0, NET_TOP - NET_H / 2, 0));
    body.position.set(x, 0.001, z);
    physics.world.addBody(body);
    this.body = body;
    this.world = physics.world;
    physics.world.addEventListener('preStep', () => {
      body.quaternion.set(0, 0, 0, 1);
      body.angularVelocity.set(0, 0, 0);
    });
  }

  update() {
    const p = this.body.interpolatedPosition;
    this.group.position.set(p.x, 0, p.z);
  }

  reset() {
    this.body.position.set(this.home.x, 0.001, this.home.z);
    this.body.velocity.set(0, 0, 0);
  }

  // 배드민턴 경기장에서만 놓임. 경기 중에는 밀려나지 않게 고정
  setActive(on) {
    const b = this.body, w = this.world;
    if (on) {
      this.reset();
      b.type = CANNON.Body.STATIC;
      b.mass = 0;
      b.updateMassProperties();
      if (!b.world) w.addBody(b);
    } else if (b.world) {
      w.removeBody(b);
    }
    this.group.visible = on;
    this.update();
  }
}
