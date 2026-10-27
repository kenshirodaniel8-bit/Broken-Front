// Enemy soldier decision making as a pure state machine. The world layer
// supplies a perception snapshot each think step and carries out the
// returned intent (move, look, fire, call out). This keeps the behaviour
// testable without three.js.
//
// States: patrol, guard, investigate, search, combat, cover, return, dead.

export const ALERT_RADIUS = 55;

export function createEnemyBrain({ mode = 'patrol', post = null, routeIdx = 0, aggression = 1 } = {}) {
  return {
    state: mode === 'guard' ? 'guard' : 'patrol',
    home: mode,
    post,
    routeIdx,
    suspicion: 0,
    target: null,
    lastKnown: null,
    lostTime: 0,
    timer: 0,
    searchQueue: [],
    aimTime: 0,
    burstLeft: 0,
    shotTimer: 0,
    pause: 0,
    aggression,
    lookAround: 0,
    reported: false,
  };
}

const enter = (b, state, extra = {}) => {
  b.state = state;
  b.timer = 0;
  Object.assign(b, extra);
};

// p: {
//   pos, seePlayer, visibility (0..1), playerPos, playerDist,
//   noise: {x, z, loud} | null, allyAlert: {x, z} | null,
//   hurt, healthFrac, arrived, cover: {x,z}|null, searchSpots: [{x,z}],
//   routePoint(i), routeLen, rng, range
// }
export function thinkEnemy(b, p, dt) {
  const out = { move: null, speed: 'walk', look: null, fire: false, say: null, alert: null, crouch: false };
  if (b.state === 'dead') return out;
  b.timer += dt;
  const rng = p.rng || Math.random;

  // --- Perception -> suspicion ---------------------------------------------
  if (p.seePlayer) {
    const near = p.playerDist < 8 ? 3 : p.playerDist < 20 ? 1.3 : p.playerDist < 40 ? 0.7 : 0.35;
    const alertMult = b.state === 'patrol' || b.state === 'guard' ? 1 : 2.2;
    b.suspicion = Math.min(1.2, b.suspicion + p.visibility * near * alertMult * dt);
    if (b.suspicion > 0.3) b.lastKnown = { ...p.playerPos };
  } else if (b.state === 'patrol' || b.state === 'guard' || b.state === 'return') {
    b.suspicion = Math.max(0, b.suspicion - dt * 0.07);
  }

  const calm = b.state === 'patrol' || b.state === 'guard' || b.state === 'return' || b.state === 'search' || b.state === 'investigate';
  if (calm) {
    if (b.suspicion >= 1 || (p.hurt && p.playerPos)) {
      enter(b, 'combat', { lastKnown: { ...p.playerPos }, lostTime: 0, aimTime: 0 });
      out.say = 'contact';
      out.alert = { ...p.playerPos };
      b.reported = true;
    } else if (p.noise && p.noise.loud >= 0.75 && b.state !== 'investigate') {
      enter(b, 'investigate', { target: { x: p.noise.x, z: p.noise.z }, urgent: true });
      out.say = 'gunfire';
      out.alert = { x: p.noise.x, z: p.noise.z };
    } else if (p.allyAlert && b.state !== 'investigate') {
      enter(b, 'investigate', { target: { ...p.allyAlert }, urgent: true });
      out.say = 'moving';
    } else if (b.suspicion >= 0.35 && b.lastKnown && b.state !== 'investigate') {
      enter(b, 'investigate', { target: { ...b.lastKnown }, urgent: false });
      out.say = 'suspicious';
    } else if (p.noise && b.state !== 'investigate' && b.state !== 'search') {
      enter(b, 'investigate', { target: { x: p.noise.x, z: p.noise.z }, urgent: false });
      out.say = 'noise';
    }
  }

  switch (b.state) {
    case 'patrol': {
      const pt = p.routePoint(b.routeIdx);
      if (p.arrived) b.routeIdx = (b.routeIdx + 1) % p.routeLen;
      out.move = p.routePoint(b.routeIdx) || pt;
      out.speed = 'walk';
      if (b.suspicion > 0.15 && p.playerPos) out.look = p.playerPos;
      break;
    }
    case 'guard': {
      if (b.post) out.move = b.post;
      b.lookAround -= dt;
      if (b.lookAround <= 0) {
        b.lookAround = 3 + rng() * 4;
        const a = rng() * Math.PI * 2;
        b.lookDir = { x: (b.post?.x ?? p.pos.x) + Math.sin(a) * 10, z: (b.post?.z ?? p.pos.z) + Math.cos(a) * 10 };
      }
      out.look = b.suspicion > 0.15 && p.playerPos ? p.playerPos : b.lookDir;
      break;
    }
    case 'investigate': {
      out.move = b.target;
      out.speed = b.urgent ? 'run' : 'walk';
      if (p.arrived || b.timer > 40) {
        enter(b, 'search', { searchQueue: (p.searchSpots || []).slice(0, 4) });
        out.say = 'searching';
      }
      break;
    }
    case 'search': {
      if (b.searchQueue.length) {
        out.move = b.searchQueue[0];
        out.speed = 'walk';
        if (p.arrived) {
          b.lookAround -= dt;
          if (b.lookAround <= 0) { b.searchQueue.shift(); b.lookAround = 2 + rng() * 2; }
        }
      }
      if (b.timer > 25 || !b.searchQueue.length) {
        b.suspicion = Math.min(b.suspicion, 0.2);
        enter(b, b.home === 'guard' ? 'guard' : 'return');
        out.say = 'clear';
      }
      break;
    }
    case 'return': {
      out.move = b.home === 'guard' ? b.post : p.routePoint(b.routeIdx);
      if (p.arrived) enter(b, b.home === 'guard' ? 'guard' : 'patrol');
      break;
    }
    case 'combat':
    case 'cover': {
      if (p.seePlayer) {
        b.lastKnown = { ...p.playerPos };
        b.lostTime = 0;
        b.aimTime += dt;
      } else {
        b.lostTime += dt;
        b.aimTime = Math.max(0, b.aimTime - dt * 2);
      }
      out.look = b.lastKnown;
      if (b.state === 'combat' && p.hurt && p.healthFrac < 0.6 && p.cover) {
        enter(b, 'cover', { coverPos: { ...p.cover } });
        out.say = 'cover';
      }
      if (b.state === 'cover') {
        out.move = b.coverPos;
        out.speed = 'run';
        out.crouch = !!p.arrived;
        if (b.timer > 7) enter(b, 'combat');
      } else if (p.seePlayer) {
        if (p.playerDist > (p.range || 60) * 0.6) { out.move = p.playerPos; out.speed = 'run'; } else out.move = null;
        out.crouch = p.playerDist > 18 && rng() < 0.002 ? !b.crouched : b.crouched;
      } else {
        out.move = b.lastKnown;
        out.speed = 'run';
        if (b.lostTime > 12 || (p.arrived && b.lostTime > 4)) {
          enter(b, 'search', { searchQueue: (p.searchSpots || []).slice(0, 5) });
          out.say = 'lost';
          b.suspicion = 0.6;
        }
      }
      // Fire control: aim first, then short bursts with pauses.
      if (p.seePlayer && p.playerDist < (p.range || 60)) {
        b.pause -= dt;
        if (b.pause <= 0 && b.aimTime > 0.7 / b.aggression) {
          if (b.burstLeft <= 0) b.burstLeft = 2 + Math.floor(rng() * 4);
          b.shotTimer -= dt;
          if (b.shotTimer <= 0) {
            out.fire = true;
            b.shotTimer = 0.11;
            b.burstLeft -= 1;
            if (b.burstLeft <= 0) b.pause = 0.8 + rng() * 1.4;
          }
        }
      }
      break;
    }
    default: break;
  }
  b.crouched = out.crouch;
  return out;
}

// How easy the player is to see, 0..1. Inputs are plain numbers so the game
// can compute them however it likes.
export function playerVisibility({ dist, crouched, moving, sprinting, darkness, flashlight, inSmoke, indoorsDark, fov = true }) {
  if (!fov || inSmoke) return 0;
  let v = 1;
  if (crouched) v *= 0.45;
  if (!moving) v *= 0.7;
  if (sprinting) v *= 1.4;
  v *= 1 - darkness * 0.75;
  if (flashlight) v = Math.max(v, 0.9);
  if (indoorsDark) v *= 0.7;
  if (dist > 60) v *= 0.4;
  else if (dist > 35) v *= 0.7;
  return Math.max(0, Math.min(1, v));
}
