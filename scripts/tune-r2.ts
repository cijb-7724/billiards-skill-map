import drills from "../app/roadmapTasks.json";
import { simulateBrowserShot, type BrowserShot, type SimulationRequest } from "../app/physics";

const targets = drills.drills.filter((drill) => drill.level === "R2");
const pockets: Record<string, [number, number]> = {
  左上: [0, 4], 上中央: [4, 4], 右上: [8, 4],
  左下: [0, 0], 下中央: [4, 0], 右下: [8, 0],
};

function pointDistanceToZone(point: { x: number; y: number }, zone: NonNullable<(typeof targets)[number]["successZone"]>) {
  const dx = point.x < zone.x1 ? zone.x1 - point.x : point.x > zone.x2 ? point.x - zone.x2 : 0;
  const dy = point.y < zone.y1 ? zone.y1 - point.y : point.y > zone.y2 ? point.y - zone.y2 : 0;
  return Math.hypot(dx, dy);
}

function result(drill: (typeof targets)[number], shot: BrowserShot) {
  const object = shot.trajectories.find((trajectory) => trajectory.ballId === "OB1");
  const cue = shot.trajectories.find((trajectory) => trajectory.ballId === "CB");
  const pocket = drill.targetPocket ? pockets[drill.targetPocket] : undefined;
  const objectEnd = object?.points.at(-1);
  const pocketed = !pocket || (!!objectEnd && objectEnd.visible === false && Math.hypot(objectEnd.x - pocket[0], objectEnd.y - pocket[1]) < .25);
  const cuePocketed = cue?.points.at(-1)?.visible === false;
  let zoneDistance = 0;
  if (drill.successZone && cue) {
    zoneDistance = drill.id === "R2-04b"
      ? Math.min(...cue.points.map((point) => pointDistanceToZone(point, drill.successZone!)))
      : pointDistanceToZone(cue.points.at(-1)!, drill.successZone);
  }
  const railContact = drill.id !== "R2-04b" && !!cue && (Math.max(...cue.points.map((point) => point.x)) > 7.75 || Math.max(...cue.points.map((point) => point.y)) > 3.82);
  return { pocketed, cuePocketed, zoneDistance, railContact, score: (pocketed ? 0 : 100) + (cuePocketed ? 20 : 0) + (railContact ? 10 : 0) + zoneDistance };
}

for (const drill of targets) {
  const yRange = drill.id.startsWith("R2-04") ? [.1, .8]
    : drill.id.startsWith("R2-05") ? [-.8, -.1]
      : drill.id.startsWith("R2-03") ? [-.8, .4]
        : [.15, .55];
  const candidates = [];
  for (let y = yRange[0]; y <= yRange[1] + 1e-9; y += .05) {
    for (let speed = .5; speed <= 3.3 + 1e-9; speed += .05) {
      const request: SimulationRequest = {
        requestId: 1,
        balls: drill.balls.map((ball) => ({ id: ball.id, color: ball.color, x: ball.x, y: ball.y })),
        aimPoint: drill.aimPoint,
        cue: { x: 0, y: Math.round(y * 100) / 100, speedMps: Math.round(speed * 100) / 100, elevationDeg: 5 },
      };
      const evaluated = result(drill, simulateBrowserShot(request));
      candidates.push({ y: request.cue.y, speed: request.cue.speedMps, ...evaluated });
    }
  }
  candidates.sort((left, right) => left.score - right.score || Math.abs(left.y - drill.cue.y) - Math.abs(right.y - drill.cue.y));
  console.log(drill.id, candidates.slice(0, 8));
}

const selected: Record<string, { y: number; speed: number }> = {
  "R2-01": { y: .35, speed: .8 }, "R2-02": { y: .35, speed: .8 },
  "R2-03a": { y: -.05, speed: .7 }, "R2-03b": { y: -.35, speed: 1.8 },
  "R2-04a": { y: .45, speed: .75 }, "R2-04b": { y: .45, speed: .9 },
  "R2-05a": { y: -.5, speed: 2.1 }, "R2-05b": { y: -.55, speed: 2.45 },
};
for (const drill of targets) {
  const setting = selected[drill.id];
  const shot = simulateBrowserShot({ requestId: 1, balls: drill.balls, aimPoint: drill.aimPoint, cue: { x: 0, y: setting.y, speedMps: setting.speed, elevationDeg: 5 } });
  const cue = shot.trajectories.find((trajectory) => trajectory.ballId === "CB")!;
  console.log("SELECTED", drill.id, JSON.stringify({ final: cue.points.at(-1), bounds: {
    minX: Math.min(...cue.points.map((point) => point.x)), maxX: Math.max(...cue.points.map((point) => point.x)),
    minY: Math.min(...cue.points.map((point) => point.y)), maxY: Math.max(...cue.points.map((point) => point.y)),
  }}));
}
