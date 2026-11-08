import * as THREE from 'three';
import { CONFIG } from './config.js';

// 3인칭 카메라: 아바타 뒤를 부드럽게 따라가고, 벽을 뚫지 않도록 당겨진다.
export class ThirdPersonCamera {
  constructor(camera, colliders) {
    const c = CONFIG.camera;
    this.camera = camera;
    this.colliders = colliders;
    this.yaw = 0;            // 0 이면 카메라가 +z 쪽에서 -z 를 바라봄
    this.pitch = c.pitch;
    this.distance = c.distance;
    this.currentDistance = c.distance;
    this.target = new THREE.Vector3();
    this.hasTarget = false;
    this.raycaster = new THREE.Raycaster();
    this.tmpDir = new THREE.Vector3();
    this.desired = new THREE.Vector3();
  }

  rotate(dx, dy) {
    const c = CONFIG.camera;
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, c.minPitch, c.maxPitch);
  }

  zoom(delta) {
    const c = CONFIG.camera;
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta), c.minDistance, c.maxDistance);
  }

  // 카메라 기준 앞/오른쪽 방향 (수평)
  forward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // 이동 중에는 카메라가 아바타 등 뒤로 천천히 돌아감
  followHeading(heading, amount, dt) {
    const behind = heading + Math.PI; // 아바타 뒤쪽 yaw
    let diff = behind - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, 1.2 * amount * dt);
  }

  update(dt, avatarPos) {
    const head = this.desired.set(avatarPos.x, avatarPos.y + 1.4, avatarPos.z);
    if (!this.hasTarget) {
      this.target.copy(head);
      this.hasTarget = true;
    } else {
      this.target.lerp(head, Math.min(1, 12 * dt));
    }

    const cp = Math.cos(this.pitch);
    const dir = this.tmpDir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // 벽·천장에 막히면 카메라를 앞으로 당김
    let d = this.distance;
    this.raycaster.set(this.target, dir);
    this.raycaster.far = d + 0.3;
    const hit = this.raycaster.intersectObjects(this.colliders, false)[0];
    if (hit) d = Math.max(0.6, hit.distance - 0.3);

    // 당길 땐 즉시, 멀어질 땐 부드럽게
    if (d < this.currentDistance) this.currentDistance = d;
    else this.currentDistance += (d - this.currentDistance) * Math.min(1, 5 * dt);

    const pos = this.camera.position.copy(this.target).addScaledVector(dir, this.currentDistance);
    if (pos.y < 0.3) pos.y = 0.3;
    this.camera.lookAt(this.target);
  }
}
