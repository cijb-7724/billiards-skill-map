/**
 * Browser-side billiards physics.
 * Motion and collision equations are adapted from pooltool 0.6.0
 * (Copyright Evan Kiefl and contributors, Apache-2.0).
 * See THIRD_PARTY_NOTICES.md.
 */
export type Quaternion = [number, number, number, number];
export type ShotPoint = { t: number; x: number; y: number; q: Quaternion; visible?: boolean };
export type ShotTrajectory = { ballId: string; color: string; points: ShotPoint[] };
export type BrowserShot = {
  duration: number;
  trajectories: ShotTrajectory[];
  engine: string;
  calculationMs?: number;
};

export type SimulationRequest = {
  requestId: number;
  balls: Array<{ id: string; color: string; x: number; y: number }>;
  aimPoint: { x: number; y: number };
  cue: { x: number; y: number; speedMps: number; elevationDeg: number };
  baselineCue?: { x: number; y: number; speedMps: number; elevationDeg: number };
  referenceShot?: BrowserShot;
};

type V3 = [number, number, number];
type SimBall = {
  id: string;
  color: string;
  r: V3;
  v: V3;
  w: V3;
  q: Quaternion;
  pocketed: boolean;
  restFrames: number;
};

const TABLE_LENGTH = 2.54;
const TABLE_WIDTH = 1.27;
const DIAMOND_M = TABLE_LENGTH / 8;
const R = 0.028575;
const MASS = 0.170097;
const INERTIA = (2 / 5) * MASS * R * R;
const G = 9.81;
const SLIDING_FRICTION = 0.24;
const ROLLING_FRICTION = 0.018;
const SPIN_FRICTION = 0.55 * R;
const BALL_RESTITUTION = 0.95;
const CUSHION_RESTITUTION = 0.85;
const CUSHION_FRICTION = 0.2;
const CUE_MASS = 0.567;
const CUE_END_MASS = MASS / 30;
const STEP = 1 / 240;
const SAMPLE_STEP = 1 / 60;
const MAX_TIME = 8;
const CORNER_POCKET_RADIUS = 0.12;
const SIDE_POCKET_RADIUS = 0.075;
const CORNER_OPENING = 0.18;
const SIDE_OPENING = 0.13;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, value: number): V3 => [a[0] * value, a[1] * value, a[2] * value];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
  const magnitude = length(a);
  return magnitude > 1e-12 ? scale(a, 1 / magnitude) : [0, 0, 0];
};
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

function rotateXY(vector: V3, angle: number): V3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [cosine * vector[0] - sine * vector[1], sine * vector[0] + cosine * vector[1], vector[2]];
}

function multiplyQuaternion(left: Quaternion, right: Quaternion): Quaternion {
  const [lw, lx, ly, lz] = left;
  const [rw, rx, ry, rz] = right;
  return [
    lw * rw - lx * rx - ly * ry - lz * rz,
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
  ];
}

function integrateOrientation(q: Quaternion, omega: V3, dt: number): Quaternion {
  const magnitude = length(omega);
  if (magnitude < 1e-9) return q;
  const halfAngle = magnitude * dt / 2;
  const factor = Math.sin(halfAngle) / magnitude;
  const next = multiplyQuaternion(
    [Math.cos(halfAngle), omega[0] * factor, omega[1] * factor, omega[2] * factor],
    q,
  );
  const norm = Math.hypot(...next) || 1;
  return next.map((value) => value / norm) as Quaternion;
}

function cueStrike(request: SimulationRequest): { v: V3; w: V3 } {
  const cb = request.balls.find((ball) => ball.id === "CB") ?? request.balls[0];
  const cbPool: V3 = [cb.y * DIAMOND_M, cb.x * DIAMOND_M, R];
  const targetPool: V3 = [request.aimPoint.y * DIAMOND_M, request.aimPoint.x * DIAMOND_M, R];
  const phi = Math.atan2(targetPool[1] - cbPool[1], targetPool[0] - cbPool[0]);
  const theta = request.cue.elevationDeg * Math.PI / 180;
  const a = clamp(-request.cue.x, -.82, .82);
  const b = clamp(request.cue.y, -.82, .82);
  const radial = Math.hypot(a, b);
  const safeScale = radial > .86 ? .86 / radial : 1;
  const safeA = a * safeScale;
  const safeB = b * safeScale;
  const cueC = Math.sqrt(Math.max(0, 1 - safeA * safeA - safeB * safeB));
  const ballA = safeA;
  const ballC = Math.cos(theta) * cueC - Math.sin(theta) * safeB;
  const ballB = Math.sin(theta) * cueC + Math.cos(theta) * safeB;
  const qa = R * ballA;
  const qc = R * ballC;
  const qb = R * ballB;
  const inertiaOverMass = (2 / 5) * R * R;
  const temp = qa * qa
    + (qb * Math.cos(theta)) ** 2
    + (qc * Math.sin(theta)) ** 2
    - 2 * qb * qc * Math.cos(theta) * Math.sin(theta);
  const strikeSpeed = 2 * request.cue.speedMps / (1 + MASS / CUE_MASS + temp / inertiaOverMass);
  let v = rotateXY([0, -strikeSpeed * Math.cos(theta), 0], phi + Math.PI / 2);
  const localW: V3 = [
    strikeSpeed / inertiaOverMass * (-qc * Math.sin(theta) + qb * Math.cos(theta)),
    strikeSpeed / inertiaOverMass * (qa * Math.sin(theta)),
    strikeSpeed / inertiaOverMass * (-qa * Math.cos(theta)),
  ];
  const w = rotateXY(localW, phi + Math.PI / 2);
  const relativeMass = MASS / CUE_END_MASS;
  const A = Math.max(0, 1 - ballA * ballA);
  const squirt = -Math.atan2(2.5 * ballA * Math.sqrt(A), 1 + relativeMass + 2.5 * A);
  v = rotateXY(v, squirt);
  return { v, w };
}

function decaySpin(ball: SimBall, dt: number) {
  const alpha = 5 * SPIN_FRICTION * G / (2 * R);
  const amount = Math.min(Math.abs(ball.w[2]), alpha * dt);
  ball.w[2] -= Math.sign(ball.w[2]) * amount;
}

function evolve(ball: SimBall, dt: number) {
  if (ball.pocketed) return;
  const slip: V3 = [ball.v[0] - R * ball.w[1], ball.v[1] + R * ball.w[0], 0];
  const slipSpeed = length(slip);
  let remaining = dt;
  if (slipSpeed > 1e-7) {
    const direction = unit(slip);
    const acceleration = scale(direction, -SLIDING_FRICTION * G);
    const transitionTime = 2 * slipSpeed / (7 * SLIDING_FRICTION * G);
    const slidingTime = Math.min(remaining, transitionTime);
    ball.r = add(ball.r, add(scale(ball.v, slidingTime), scale(acceleration, .5 * slidingTime * slidingTime)));
    ball.v = add(ball.v, scale(acceleration, slidingTime));
    const angularChange = scale(cross(direction, [0, 0, 1]), -(5 / (2 * R)) * SLIDING_FRICTION * G * slidingTime);
    ball.w = add(ball.w, angularChange);
    remaining -= slidingTime;
  }
  const speed = Math.hypot(ball.v[0], ball.v[1]);
  if (remaining > 1e-9 && speed > 1e-7) {
    const direction: V3 = [ball.v[0] / speed, ball.v[1] / speed, 0];
    const deceleration = ROLLING_FRICTION * G;
    const rollingTime = Math.min(remaining, speed / deceleration);
    const nextSpeed = Math.max(0, speed - deceleration * rollingTime);
    const travelled = (speed + nextSpeed) * .5 * rollingTime;
    ball.r = add(ball.r, scale(direction, travelled));
    ball.v = scale(direction, nextSpeed);
    ball.w[0] = -ball.v[1] / R;
    ball.w[1] = ball.v[0] / R;
  }
  decaySpin(ball, dt);
  ball.q = integrateOrientation(ball.q, ball.w, dt);
  const quiet = Math.hypot(ball.v[0], ball.v[1]) < .004 && Math.abs(ball.w[2]) < .08;
  ball.restFrames = quiet ? ball.restFrames + 1 : 0;
  if (ball.restFrames > 12) {
    ball.v = [0, 0, 0];
    ball.w = [0, 0, 0];
  }
}

const pocketCenters: V3[] = [
  [0, 0, 0], [0, TABLE_LENGTH / 2, 0], [0, TABLE_LENGTH, 0],
  [TABLE_WIDTH, 0, 0], [TABLE_WIDTH, TABLE_LENGTH / 2, 0], [TABLE_WIDTH, TABLE_LENGTH, 0],
];

function nearPocket(ball: SimBall) {
  return pocketCenters.some((pocket) => {
    const isSidePocket = Math.abs(pocket[1] - TABLE_LENGTH / 2) < 1e-9;
    return Math.hypot(ball.r[0] - pocket[0], ball.r[1] - pocket[1]) < (isSidePocket ? SIDE_POCKET_RADIUS : CORNER_POCKET_RADIUS);
  });
}

function openingOnShortRail(longPosition: number) {
  return Math.abs(longPosition) < CORNER_OPENING
    || Math.abs(longPosition - TABLE_LENGTH) < CORNER_OPENING
    || Math.abs(longPosition - TABLE_LENGTH / 2) < SIDE_OPENING;
}

function openingOnLongRail(shortPosition: number) {
  return Math.abs(shortPosition) < CORNER_OPENING || Math.abs(shortPosition - TABLE_WIDTH) < CORNER_OPENING;
}

function resolveCushion(ball: SimBall, normal: V3) {
  const contactOffset = scale(normal, -R);
  const contactVelocity = add(ball.v, cross(ball.w, contactOffset));
  const normalSpeed = dot(contactVelocity, normal);
  if (normalSpeed >= 0) return;
  const normalImpulseMagnitude = -(1 + CUSHION_RESTITUTION) * normalSpeed * MASS;
  const normalImpulse = scale(normal, normalImpulseMagnitude);
  const tangentVelocity = sub(contactVelocity, scale(normal, normalSpeed));
  const tangentMagnitude = length(tangentVelocity);
  let tangentImpulse: V3 = [0, 0, 0];
  if (tangentMagnitude > 1e-9) {
    const idealMagnitude = MASS * tangentMagnitude / 3.5;
    const actualMagnitude = Math.min(idealMagnitude, CUSHION_FRICTION * normalImpulseMagnitude);
    tangentImpulse = scale(tangentVelocity, -actualMagnitude / tangentMagnitude);
  }
  const impulse = add(normalImpulse, tangentImpulse);
  ball.v = add(ball.v, scale(impulse, 1 / MASS));
  ball.w = add(ball.w, scale(cross(contactOffset, impulse), 1 / INERTIA));
}

function resolveRails(ball: SimBall) {
  if (ball.pocketed || nearPocket(ball)) {
    if (nearPocket(ball)) ball.pocketed = true;
    return;
  }
  if (ball.r[0] < R && !openingOnShortRail(ball.r[1])) {
    ball.r[0] = R; resolveCushion(ball, [1, 0, 0]);
  } else if (ball.r[0] > TABLE_WIDTH - R && !openingOnShortRail(ball.r[1])) {
    ball.r[0] = TABLE_WIDTH - R; resolveCushion(ball, [-1, 0, 0]);
  }
  if (ball.r[1] < R && !openingOnLongRail(ball.r[0])) {
    ball.r[1] = R; resolveCushion(ball, [0, 1, 0]);
  } else if (ball.r[1] > TABLE_LENGTH - R && !openingOnLongRail(ball.r[0])) {
    ball.r[1] = TABLE_LENGTH - R; resolveCushion(ball, [0, -1, 0]);
  }
  if (ball.r[0] < -R || ball.r[0] > TABLE_WIDTH + R || ball.r[1] < -R || ball.r[1] > TABLE_LENGTH + R) {
    ball.pocketed = true;
  }
}

function resolveBallPair(first: SimBall, second: SimBall) {
  if (first.pocketed || second.pocketed) return;
  const delta: V3 = [second.r[0] - first.r[0], second.r[1] - first.r[1], 0];
  const separation = length(delta);
  if (separation >= 2 * R || separation < 1e-10) return;
  const normal = scale(delta, 1 / separation);
  const overlap = 2 * R - separation;
  first.r = add(first.r, scale(normal, -overlap / 2));
  second.r = add(second.r, scale(normal, overlap / 2));
  const theta = Math.atan2(normal[1], normal[0]);
  let v1 = rotateXY(first.v, -theta);
  let v2 = rotateXY(second.v, -theta);
  let w1 = rotateXY(first.w, -theta);
  let w2 = rotateXY(second.w, -theta);
  if (v1[0] - v2[0] <= 0) return;
  const finalV1Normal = .5 * ((1 - BALL_RESTITUTION) * v1[0] + (1 + BALL_RESTITUTION) * v2[0]);
  const finalV2Normal = .5 * ((1 + BALL_RESTITUTION) * v1[0] + (1 - BALL_RESTITUTION) * v2[0]);
  const normalVelocityChange = Math.abs(finalV2Normal - finalV1Normal);
  const savedW1Normal = w1[0];
  const savedW2Normal = w2[0];
  v1 = [0, v1[1], v1[2]];
  v2 = [0, v2[1], v2[2]];
  w1 = [0, w1[1], w1[2]];
  w2 = [0, w2[1], w2[2]];
  const axis: V3 = [1, 0, 0];
  const surfaceVelocity = (v: V3, w: V3, direction: V3) => add(sub(v, scale(direction, dot(v, direction))), cross(w, scale(direction, R)));
  const firstSurface = surfaceVelocity(v1, w1, axis);
  const secondSurface = surfaceVelocity(v2, w2, scale(axis, -1));
  const relativeSurface = sub(firstSurface, secondSurface);
  const relativeSurfaceMagnitude = length(relativeSurface);
  const ballFriction = .009951 + .108 * Math.exp(-1.088 * relativeSurfaceMagnitude);
  let finalV1 = [...v1] as V3;
  let finalV2 = [...v2] as V3;
  let finalW1 = [...w1] as V3;
  let finalW2 = [...w2] as V3;
  let useNoSlip = relativeSurfaceMagnitude < 1e-9;
  if (!useNoSlip) {
    const deltaV1Tangent = scale(relativeSurface, -ballFriction * normalVelocityChange / relativeSurfaceMagnitude);
    const deltaW1 = scale(cross(axis, deltaV1Tangent), 2.5 / R);
    finalV1 = add(v1, deltaV1Tangent);
    finalV2 = sub(v2, deltaV1Tangent);
    finalW1 = add(w1, deltaW1);
    finalW2 = add(w2, deltaW1);
    const finalRelative = sub(surfaceVelocity(finalV1, finalW1, axis), surfaceVelocity(finalV2, finalW2, scale(axis, -1)));
    useNoSlip = dot(relativeSurface, finalRelative) <= 0;
  }
  if (useNoSlip) {
    const deltaV1Tangent = scale(add(sub(v1, v2), scale(cross(add(w1, w2), axis), R)), -1 / 7);
    const deltaW1 = scale(add(scale(cross(axis, sub(v1, v2)), 1 / R), add(w1, w2)), -5 / 14);
    finalV1 = add(v1, deltaV1Tangent);
    finalV2 = sub(v2, deltaV1Tangent);
    finalW1 = add(w1, deltaW1);
    finalW2 = add(w2, deltaW1);
  }
  finalV1[0] = finalV1Normal;
  finalV2[0] = finalV2Normal;
  finalW1[0] = savedW1Normal;
  finalW2[0] = savedW2Normal;
  finalV1[2] = 0;
  finalV2[2] = 0;
  first.v = rotateXY(finalV1, theta);
  second.v = rotateXY(finalV2, theta);
  first.w = rotateXY(finalW1, theta);
  second.w = rotateXY(finalW2, theta);
  first.restFrames = 0;
  second.restFrames = 0;
}

function samplePoint(ball: SimBall, time: number): ShotPoint {
  if (ball.pocketed) {
    const pocket = pocketCenters.reduce((best, candidate) => (
      Math.hypot(ball.r[0] - candidate[0], ball.r[1] - candidate[1])
        < Math.hypot(ball.r[0] - best[0], ball.r[1] - best[1]) ? candidate : best
    ));
    return {
      t: Number(time.toFixed(4)),
      x: Number((pocket[1] / DIAMOND_M).toFixed(4)),
      y: Number((pocket[0] / DIAMOND_M).toFixed(4)),
      q: ball.q.map((value) => Number(value.toFixed(6))) as Quaternion,
      visible: false,
    };
  }
  return {
    t: Number(time.toFixed(4)),
    x: Number((ball.r[1] / DIAMOND_M).toFixed(4)),
    y: Number((ball.r[0] / DIAMOND_M).toFixed(4)),
    q: ball.q.map((value) => Number(value.toFixed(6))) as Quaternion,
  };
}

export function simulateBrowserShot(request: SimulationRequest): BrowserShot {
  const started = performance.now();
  const balls: SimBall[] = request.balls.map((ball) => ({
    id: ball.id,
    color: ball.color,
    r: [ball.y * DIAMOND_M, ball.x * DIAMOND_M, R],
    v: [0, 0, 0],
    w: [0, 0, 0],
    q: [1, 0, 0, 0],
    pocketed: false,
    restFrames: 0,
  }));
  const cueBall = balls.find((ball) => ball.id === "CB") ?? balls[0];
  const strike = cueStrike(request);
  cueBall.v = strike.v;
  cueBall.w = strike.w;
  const samples = new Map<string, ShotPoint[]>(balls.map((ball) => [ball.id, [samplePoint(ball, 0)]]));
  let time = 0;
  let nextSample = SAMPLE_STEP;
  while (time < MAX_TIME) {
    balls.forEach((ball) => evolve(ball, STEP));
    for (let first = 0; first < balls.length; first++) {
      for (let second = first + 1; second < balls.length; second++) resolveBallPair(balls[first], balls[second]);
    }
    balls.forEach(resolveRails);
    time += STEP;
    if (time + 1e-9 >= nextSample) {
      balls.forEach((ball) => samples.get(ball.id)!.push(samplePoint(ball, time)));
      nextSample += SAMPLE_STEP;
    }
    const finished = balls.every((ball) => ball.pocketed || ball.restFrames > 12);
    if (finished && time > .12) break;
  }
  balls.forEach((ball) => {
    const points = samples.get(ball.id)!;
    if (points.at(-1)!.t < time - .001) points.push(samplePoint(ball, time));
  });
  return {
    duration: Number(time.toFixed(4)),
    engine: "ブラウザー物理モデル 0.1",
    calculationMs: Number((performance.now() - started).toFixed(2)),
    trajectories: balls.map((ball) => ({ ballId: ball.id, color: ball.color, points: samples.get(ball.id)! })),
  };
}

function interpolateTrajectory(points: ShotPoint[], normalizedTime: number): ShotPoint {
  const time = clamp(normalizedTime, 0, 1) * points.at(-1)!.t;
  if (time <= points[0].t) return points[0];
  if (time >= points.at(-1)!.t) return points.at(-1)!;
  const index = points.findIndex((point) => point.t >= time);
  const start = points[index - 1];
  const end = points[index];
  const ratio = (time - start.t) / Math.max(1e-9, end.t - start.t);
  let endQ = end.q;
  if (dot4(start.q, endQ) < 0) endQ = endQ.map((value) => -value) as Quaternion;
  return {
    t: time,
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    q: normalize4(start.q.map((value, qIndex) => value + (endQ[qIndex] - value) * ratio) as Quaternion),
    visible: start.visible !== false && (end.visible !== false || ratio < .98),
  };
}

const dot4 = (a: Quaternion, b: Quaternion) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const normalize4 = (q: Quaternion): Quaternion => {
  const magnitude = Math.hypot(...q) || 1;
  return q.map((value) => value / magnitude) as Quaternion;
};
const inverseQuaternion = ([w, x, y, z]: Quaternion): Quaternion => [w, -x, -y, -z];
const blendQuaternion = (start: Quaternion, end: Quaternion, amount: number): Quaternion => {
  const adjusted = dot4(start, end) < 0 ? end.map((value) => -value) as Quaternion : end;
  return normalize4(start.map((value, index) => value + (adjusted[index] - value) * amount) as Quaternion);
};

export function calibrateToReference(
  changed: BrowserShot,
  modelBaseline: BrowserShot,
  reference: BrowserShot,
  changedCue: SimulationRequest["cue"],
  baselineCue: NonNullable<SimulationRequest["baselineCue"]>,
): BrowserShot {
  const parameterDistance = Math.hypot(
    (changedCue.x - baselineCue.x) / .5,
    (changedCue.y - baselineCue.y) / .5,
    (changedCue.speedMps - baselineCue.speedMps) / 1.5,
  );
  const correctionWeight = clamp(1 - parameterDistance * .22, .2, 1);
  const durationScale = reference.duration / Math.max(.01, modelBaseline.duration);
  const duration = changed.duration * durationScale;
  return {
    ...changed,
    duration: Number(duration.toFixed(4)),
    engine: "ブラウザー物理モデル 0.1（基準課題で校正）",
    trajectories: changed.trajectories.map((trajectory) => {
      const modelTrajectory = modelBaseline.trajectories.find((candidate) => candidate.ballId === trajectory.ballId);
      const referenceTrajectory = reference.trajectories.find((candidate) => candidate.ballId === trajectory.ballId);
      if (!modelTrajectory || !referenceTrajectory) return trajectory;
      return {
        ...trajectory,
        points: trajectory.points.map((point) => {
          const normalizedTime = point.t / Math.max(.01, changed.duration);
          const modelPoint = interpolateTrajectory(modelTrajectory.points, normalizedTime);
          const referencePoint = interpolateTrajectory(referenceTrajectory.points, normalizedTime);
          if (point.visible === false) return { ...point, t: Number((point.t * durationScale).toFixed(4)) };
          // A reference correction must never create motion that the simulated
          // shot has not caused yet. In particular, a slower draw shot may hit
          // the object ball later than the authored baseline.
          const initialPoint = trajectory.points[0];
          const rawBallIsStill = Math.hypot(point.x - initialPoint.x, point.y - initialPoint.y) < 1e-5;
          if (rawBallIsStill) {
            return {
              ...point,
              t: Number((point.t * durationScale).toFixed(4)),
            };
          }
          const correctedQ = multiplyQuaternion(multiplyQuaternion(referencePoint.q, inverseQuaternion(modelPoint.q)), point.q);
          return {
            ...point,
            t: Number((point.t * durationScale).toFixed(4)),
            x: Number((point.x + (referencePoint.x - modelPoint.x) * correctionWeight).toFixed(4)),
            y: Number((point.y + (referencePoint.y - modelPoint.y) * correctionWeight).toFixed(4)),
            q: blendQuaternion(point.q, correctedQ, correctionWeight).map((value) => Number(value.toFixed(6))) as Quaternion,
          };
        }),
      };
    }),
  };
}
