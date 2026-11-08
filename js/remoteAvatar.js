import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { buildBlockPerson, animatePerson, Avatar } from './avatar.js';
import { JumpRope } from './activities.js';
import { makeBubble } from './flagFootball.js';

// ============================================================
//  다른 친구의 아바타 (네트워크로 받은 상태를 부드럽게 따라감)
//  상태 문자열: x,y,z,방향,걷기,땅,들기자세,활동,활동각,점프높이,힘,드리블,벨트,플래그수,동작,동작번호,손들기
// ============================================================
export function encodePlayerState(a, actionSeq) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const p = a.position;
  return [
    r2(p.x), r2(p.y), r2(p.z), r2(a.heading), r2(a.anim.moveAmount), a.grounded ? 1 : 0,
    a.holdPose || '', a.activity || '', r2(a.activityPhase), r2(a.hopY), r2(a.charge), a.dribble ? 1 : 0,
    a.wearingFlags ? 1 : 0, a.flagsLeft ?? 2, a.lastAction || '', actionSeq, a.calling > 0 ? 1 : 0,
  ].join(',');
}

function decode(s) {
  const f = String(s || '').split(',');
  if (f.length < 16) return null;
  const n = (i) => Number(f[i]) || 0;
  return {
    x: n(0), y: n(1), z: n(2), heading: n(3), move: n(4), grounded: f[5] === '1',
    holdPose: f[6] || null, activity: f[7] || null, phase: n(8), hopY: n(9), charge: n(10), dribble: f[11] === '1',
    wear: f[12] === '1', flags: n(13), action: f[14] || null, actionSeq: n(15), call: f[16] === '1',
  };
}

const FONT = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function nameSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = `bold 34px ${FONT}`;
  const w = Math.min(250, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  if (g.roundRect) g.roundRect((256 - w) / 2, 6, w, 52, 26);
  else g.rect((256 - w) / 2, 6, w, 52);
  g.fill();
  g.fillStyle = '#1f2a5c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // 멀리 있어도 같은 크기로 보이게 (sizeAttenuation: false)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.2, 0.05, 1);
  s.renderOrder = 9;
  return s;
}

export class RemoteAvatar {
  constructor(scene, physics, id, name) {
    this.id = id;
    this.name = name;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.parts = buildBlockPerson();
    this.model = this.parts.model;
    this.root.add(this.model);
    this.label = nameSprite(name);
    this.label.position.y = 2.0;
    this.root.add(this.label);
    // '패스!' 말풍선 (손들었을 때)
    this.bubble = makeBubble();
    this.bubble.userData.set('패스!', '#ffd23f', '#1f2a5c');
    // 멀리 있어도 잘 보이게 화면 크기 고정
    this.bubble.material.sizeAttenuation = false;
    this.bubble.scale.set(0.22, 0.0825, 1);
    this.bubble.position.y = 2.45;
    this.bubble.visible = false;
    this.root.add(this.bubble);
    this.calling = 0;

    // Avatar 의 애니메이션 함수를 그대로 쓰기 위한 같은 이름의 값들
    this.heading = 0;
    this.grounded = true;
    this.anim = { walkPhase: 0, moveAmount: 0, grounded: true };
    this.action = null;
    this.actionTime = 0;
    this.holdPose = null;
    this.charge = 0;
    this.dribble = false;
    this.activity = null;
    this.activityPhase = 0;
    this.hopY = 0;
    this.lastSeq = -1;
    this.target = null;
    this.flagsLeft = 2;
    this.wear = false;

    // 내 아바타·공이 부딪힐 수 있게 (움직임은 네트워크가 정함 = KINEMATIC)
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
    body.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(0, 0.28, 0));
    body.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(0, 0.8, 0));
    body.addShape(new CANNON.Sphere(0.28), new CANNON.Vec3(0, 1.32, 0));
    body.collisionFilterGroup = 2;
    body.collisionFilterMask = 1; // 공·벽과만 (다른 사람끼리는 겹쳐도 됨)
    physics.world.addBody(body);
    this.body = body;
    this.world = physics.world;

    this.rope = new JumpRope(scene, this, { setCounter() {} });
  }

  get position() {
    return this.root.position;
  }

  get wearingFlags() {
    return this.wear;
  }

  forward(out) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  handPosition(out, right = true) {
    return Avatar.prototype.handPosition.call(this, out, right);
  }

  setState(s) {
    const st = decode(s);
    if (!st) return;
    const first = !this.target;
    this.target = st;
    if (first) {
      this.root.position.set(st.x, st.y, st.z);
      this.heading = st.heading;
    }
    this.holdPose = st.holdPose;
    this.activity = st.activity;
    this.charge = st.charge;
    this.dribble = st.dribble;
    this.wear = st.wear;
    this.flagsLeft = st.flags;
    this.calling = st.call ? 1 : 0;
    this.bubble.visible = st.call;
    this.parts.belt.visible = st.wear;
    this.parts.flags.forEach((f, i) => { f.visible = i < st.flags; });
    if (st.action && st.actionSeq !== this.lastSeq) {
      if (this.lastSeq !== -1) { this.action = st.action; this.actionTime = 0; }
      this.lastSeq = st.actionSeq;
    }
  }

  update(dt) {
    const t = this.target;
    if (!t) return;
    const k = Math.min(1, 12 * dt);
    const p = this.root.position;
    const px = p.x, pz = p.z;
    p.x += (t.x - p.x) * k;
    p.y += (t.y - p.y) * k;
    p.z += (t.z - p.z) * k;
    let d = t.heading - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * k;
    this.model.rotation.y = this.heading;
    this.anim.moveAmount += (t.move - this.anim.moveAmount) * k;
    this.grounded = t.grounded;
    this.anim.grounded = t.grounded;
    this.activityPhase = t.phase;
    this.hopY = t.hopY;

    this.body.position.set(p.x, p.y, p.z);
    this.body.velocity.set((p.x - px) / Math.max(dt, 0.001), 0, (p.z - pz) / Math.max(dt, 0.001));

    animatePerson(this.parts, this.anim, dt);
    Avatar.prototype.animateActions.call(this, dt);

    // 줄넘기 줄
    const roping = this.holdPose === 'rope' || this.activity === 'rope';
    this.rope.group.visible = roping;
    if (roping) {
      this.rope.phase = this.activity === 'rope' ? t.phase : Math.PI;
      this.rope.drawRope();
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.scene.remove(this.rope.group);
    this.world.removeBody(this.body);
  }
}
