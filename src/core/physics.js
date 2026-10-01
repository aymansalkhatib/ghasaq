import * as CANNON from 'cannon-es';

/* The cannon-es world, collision groups and small helpers for kinematic actors. */

export { CANNON };
export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 9;
world.defaultContactMaterial.friction = 0.45;
world.defaultContactMaterial.restitution = 0.1;

export const G = { STATIC: 1, PROP: 2, RAG: 4, ACTOR: 8, NADE: 16 };
export const cv = (v) => new CANNON.Vec3(v.x, v.y, v.z);

export const nadeMaterial = new CANNON.Material('nade');
world.addContactMaterial(new CANNON.ContactMaterial(nadeMaterial, world.defaultMaterial, { friction: 0.35, restitution: 0.38 }));

/** Static bodies for the ground and every collision box. Returns them so a map can be unloaded. */
export function buildStaticPhysics(colliders) {
  const bodies = [];
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), collisionFilterGroup: G.STATIC, collisionFilterMask: G.PROP | G.RAG | G.NADE });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  bodies.push(ground);
  for (const c of colliders) {
    const hx = (c.max.x - c.min.x) / 2, hy = (c.max.y - c.min.y) / 2, hz = (c.max.z - c.min.z) / 2;
    const b = new CANNON.Body({
      mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
      position: new CANNON.Vec3(c.min.x + hx, c.min.y + hy, c.min.z + hz),
      collisionFilterGroup: G.STATIC, collisionFilterMask: G.PROP | G.RAG | G.NADE,
    });
    world.addBody(b);
    bodies.push(b);
  }
  return bodies;
}

/** A kinematic box that lets a walking character shove props and bodies aside. */
export function makeActorBody() {
  const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(0.33, 0.85, 0.33)), collisionFilterGroup: G.ACTOR, collisionFilterMask: G.PROP });
  world.addBody(b);
  return b;
}
export function driveActor(b, pos, vel) {
  b.position.set(pos.x, pos.y + 0.87, pos.z);
  b.velocity.set(vel.x, 0, vel.z);
}
