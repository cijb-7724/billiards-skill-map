import drills from "../app/roadmapTasks.json";
import { simulateBrowserShot } from "../app/physics";

const ids = new Set(process.argv.slice(2));
const pockets: Record<string, [number, number]> = { 左上: [0, 4], 上中央: [4, 4], 右上: [8, 4], 左下: [0, 0], 下中央: [4, 0], 右下: [8, 0] };
const distanceToZone = (point: { x: number; y: number }, zone: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(point.x < zone.x1 ? zone.x1 - point.x : point.x > zone.x2 ? point.x - zone.x2 : 0, point.y < zone.y1 ? zone.y1 - point.y : point.y > zone.y2 ? point.y - zone.y2 : 0);

for (const drill of drills.drills.filter((candidate) => ids.has(candidate.id))) {
  const candidates = [];
  for (let y = -.8; y <= .8; y += .05) for (let speed = .3; speed <= 3.5; speed += .05) {
    const shot = simulateBrowserShot({ requestId: 1, balls: drill.balls, aimPoint: drill.aimPoint, cue: { x: drill.cue.x, y, speedMps: speed, elevationDeg: drill.cue.elevationDeg } });
    const target = shot.trajectories.find((trajectory) => trajectory.ballId === drill.successBallId);
    const object = shot.trajectories.find((trajectory) => trajectory.ballId === "OB1")?.points.at(-1);
    const pocket = drill.targetPocket ? pockets[drill.targetPocket] : null;
    const pocketPenalty = pocket && (!object || object.visible !== false || Math.hypot(object.x - pocket[0], object.y - pocket[1]) > .25) ? 100 : 0;
    const zoneDistance = drill.successZone && target ? distanceToZone(target.points.at(-1)!, drill.successZone) : 0;
    const scratch = shot.trajectories.find((trajectory) => trajectory.ballId === "CB")?.points.at(-1)?.visible === false;
    candidates.push({ y: Math.round(y * 100) / 100, speed: Math.round(speed * 100) / 100, score: pocketPenalty + zoneDistance + (scratch ? 20 : 0), final: target?.points.at(-1) });
  }
  candidates.sort((left, right) => left.score - right.score || Math.abs(left.y - drill.cue.y) - Math.abs(right.y - drill.cue.y) || Math.abs(left.speed - drill.cue.speedMps) - Math.abs(right.speed - drill.cue.speedMps));
  console.log(drill.id, candidates.slice(0, 12));
}
