import * as CANNON from 'cannon-es';

// 물리 세계 생성. 중력은 실제 값(공 물리에 필요), 아바타는 추가 중력을 따로 받는다.
export function createPhysics() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 8;

  const materials = {
    static: new CANNON.Material('static'),
    player: new CANNON.Material('player'),
  };

  // 아바타는 벽에 붙지 않도록 마찰 0
  world.addContactMaterial(
    new CANNON.ContactMaterial(materials.player, materials.static, {
      friction: 0,
      restitution: 0,
    })
  );

  // 고정된 상자 충돌체 추가
  function addStaticBox(x, y, z, hx, hy, hz, quaternion = null) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: materials.static,
      shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    });
    body.position.set(x, y, z);
    if (quaternion) body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    world.addBody(body);
    return body;
  }

  return { world, materials, addStaticBox };
}
