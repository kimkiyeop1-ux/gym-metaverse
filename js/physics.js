import * as CANNON from 'cannon-es';

// 물리 세계 생성. 중력은 실제 값(공 물리에 필요), 아바타는 추가 중력을 따로 받는다.
export const PHYSICS_STEP = 1 / 120; // 빠른 공이 벽을 뚫지 않도록 잘게 계산

export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  // 기본(Naive) 방식 사용: SAP 방식은 물체가 움직여도 정렬이 갱신되지 않아
  // 아바타가 배드민턴 네트를 통과하는 등 충돌을 놓치는 문제가 있었다.
  // 물체 수가 많지 않아 성능 차이는 작다.
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = true;
  world.solver.iterations = 8;
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.3;

  const materials = {
    static: new CANNON.Material('static'), // 바닥·벽·무대·백보드
    player: new CANNON.Material('player'),
    rim: new CANNON.Material('rim'),
    net: new CANNON.Material('net'),       // 배드민턴 네트 (공이 걸림)
    equipment: new CANNON.Material('equipment'), // 밀 수 있는 기구 (지주 등)
    trampoline: new CANNON.Material('trampoline'), // 추크볼 그물
  };
  const cm = (a, b, friction, restitution) =>
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));

  cm(materials.player, materials.static, 0, 0);          // 아바타는 벽에 붙지 않도록 마찰 0
  cm(materials.player, materials.equipment, 0, 0);
  cm(materials.player, materials.net, 0, 0);
  cm(materials.equipment, materials.static, 0.4, 0);
  cm(materials.player, materials.trampoline, 0, 0);
  cm(materials.trampoline, materials.static, 0.4, 0);

  // 공(용기구)별 재질: 바닥·벽에서 튀는 정도가 다름
  function addItemMaterial({ friction, restitution }) {
    const m = new CANNON.Material('item');
    cm(m, materials.static, friction, restitution);
    cm(m, materials.rim, 0.3, restitution * 0.75);
    cm(m, materials.net, 0.9, 0.02);
    cm(m, materials.equipment, 0.4, restitution * 0.6);
    cm(m, materials.player, 0.2, 0.2);
    cm(m, materials.trampoline, 0.3, 0.9);
    return m;
  }

  function addStaticBox(x, y, z, hx, hy, hz, quaternion = null, material = materials.static) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    });
    body.position.set(x, y, z);
    if (quaternion) body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    world.addBody(body);
    return body;
  }

  function addStaticSphere(x, y, z, r, material = materials.static) {
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material, shape: new CANNON.Sphere(r) });
    body.position.set(x, y, z);
    world.addBody(body);
    return body;
  }

  return { world, materials, addStaticBox, addStaticSphere, addItemMaterial };
}
