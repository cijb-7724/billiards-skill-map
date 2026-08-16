import drills from "../app/drills.json";
import { simulateBrowserShot, type BrowserShot, type SimulationRequest } from "../app/physics";

const BALL_RADIUS_DIAMOND = .09;
const POCKETS = [[0, 0], [4, 0], [8, 0], [0, 4], [4, 4], [8, 4]];

function aimPoint(drill: (typeof drills.drills)[number]) {
  const cueBall = drill.balls.find((ball) => ball.id === "CB")!;
  const objectBall = drill.balls.find((ball) => ball.id.startsWith("OB"));
  if (objectBall) {
    const trajectory = drill.trajectories.find((item) => item.ballId === objectBall.id)!;
    const start = trajectory.points[0];
    const moved = trajectory.points.find((point) => Math.hypot(point.x - start.x, point.y - start.y) > .05) ?? trajectory.points.at(-1)!;
    const distance = Math.hypot(moved.x - start.x, moved.y - start.y) || 1;
    return {
      x: objectBall.x - (moved.x - start.x) / distance * BALL_RADIUS_DIAMOND * 2,
      y: objectBall.y - (moved.y - start.y) / distance * BALL_RADIUS_DIAMOND * 2,
    };
  }
  const trajectory = drill.trajectories.find((item) => item.ballId === cueBall.id)!;
  const moved = trajectory.points.find((point) => Math.hypot(point.x - cueBall.x, point.y - cueBall.y) > .05) ?? trajectory.points.at(-1)!;
  return { x: moved.x, y: moved.y };
}

const errors: string[] = [];
let slowest = 0;

function validateShot(drillId: string, label: string, shot: BrowserShot) {
  slowest = Math.max(slowest, shot.calculationMs ?? 0);
  for (const trajectory of shot.trajectories) {
    for (const point of trajectory.points) {
      if (![point.t, point.x, point.y, ...point.q].every(Number.isFinite)) errors.push(`${drillId} ${label}: 軌道に不正な数値があります`);
      if (point.x < -.5 || point.x > 8.5 || point.y < -.5 || point.y > 4.5) errors.push(`${drillId} ${label}: 軌道が台から大きく逸脱しています`);
      const quaternionNorm = Math.hypot(...point.q);
      if (Math.abs(quaternionNorm - 1) > 2e-4) errors.push(`${drillId} ${label}: 回転姿勢が正規化されていません`);
    }

    let previousDirection: [number, number] | null = null;
    for (let index = 1; index < trajectory.points.length; index++) {
      const previous = trajectory.points[index - 1];
      const current = trajectory.points[index];
      if (previous.visible === false || current.visible === false) continue;
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 2e-4) continue;
      const direction: [number, number] = [dx / distance, dy / distance];
      const awayFromRail = current.x > .22 && current.x < 7.78 && current.y > .22 && current.y < 3.78;
      if (trajectory.ballId !== "CB" && awayFromRail && previousDirection && direction[0] * previousDirection[0] + direction[1] * previousDirection[1] < -.25) {
        errors.push(`${drillId} ${label}: 無接触区間で進行方向が反転しています`);
      }
      previousDirection = direction;
    }

    const firstHidden = trajectory.points.findIndex((point) => point.visible === false);
    if (firstHidden > 0) {
      const previous = trajectory.points[firstHidden - 1];
      const nearestPocket = Math.min(...POCKETS.map(([x, y]) => Math.hypot(previous.x - x, previous.y - y)));
      if (nearestPocket > .38) errors.push(`${drillId} ${label}: ポケットから離れた位置で球が消えています`);
    }
  }
}

for (const drill of drills.drills) {
  const baselineCue = {
    x: drill.cue.x,
    y: drill.cue.y,
    speedMps: drill.cue.speedMps,
    elevationDeg: drill.cue.elevationDeg,
  };
  const request: SimulationRequest = {
    requestId: 1,
    balls: drill.balls.map((ball) => ({ id: ball.id, color: ball.color, x: ball.x, y: ball.y })),
    aimPoint: aimPoint(drill),
    cue: baselineCue,
  };
  validateShot(drill.id, "基準", simulateBrowserShot(request));
  validateShot(drill.id, "微調整", simulateBrowserShot({
    ...request,
    cue: { ...baselineCue, x: Math.max(-.8, Math.min(.8, baselineCue.x + .05)), speedMps: Math.min(3.5, baselineCue.speedMps + .05) },
  }));
  validateShot(drill.id, "弱い引き", simulateBrowserShot({ ...request, cue: { ...baselineCue, y: -.8, speedMps: .5 } }));
}

if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`ブラウザー物理検証: ${drills.drills.length}/${drills.drills.length} 課題 × 3条件が合格（最長 ${slowest.toFixed(2)} ms）`);
}
