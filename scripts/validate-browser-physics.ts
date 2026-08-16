import drills from "../app/drills.json";
import references from "../app/generatedTrajectories.json";
import { calibrateToReference, simulateBrowserShot, type BrowserShot, type SimulationRequest } from "../app/physics";

const BALL_RADIUS_DIAMOND = .09;

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

const referenceMap = references as unknown as Record<string, BrowserShot>;
const errors: string[] = [];
let slowest = 0;

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
  const modelBaseline = simulateBrowserShot(request);
  slowest = Math.max(slowest, modelBaseline.calculationMs ?? 0);
  const reference = referenceMap[drill.id];
  const calibrated = calibrateToReference(modelBaseline, modelBaseline, reference, baselineCue, baselineCue);
  for (const trajectory of calibrated.trajectories) {
    const expected = reference.trajectories.find((candidate) => candidate.ballId === trajectory.ballId)!;
    const actualFinal = trajectory.points.at(-1)!;
    const expectedFinal = expected.points.at(-1)!;
    if (Math.hypot(actualFinal.x - expectedFinal.x, actualFinal.y - expectedFinal.y) > 1e-3) {
      errors.push(`${drill.id}: 基準校正後の最終位置が一致しません`);
    }
  }
  const changedCue = {
    ...baselineCue,
    x: Math.max(-.8, Math.min(.8, baselineCue.x + .05)),
    speedMps: Math.min(3.5, baselineCue.speedMps + .05),
  };
  const changed = simulateBrowserShot({ ...request, cue: changedCue });
  slowest = Math.max(slowest, changed.calculationMs ?? 0);
  const adjusted = calibrateToReference(changed, modelBaseline, reference, changedCue, baselineCue);
  for (const trajectory of adjusted.trajectories) {
    for (const point of trajectory.points) {
      if (![point.t, point.x, point.y, ...point.q].every(Number.isFinite)) errors.push(`${drill.id}: 実験結果に不正な数値があります`);
      if (point.x < -.5 || point.x > 8.5 || point.y < -.5 || point.y > 4.5) errors.push(`${drill.id}: 実験軌道が台から大きく逸脱しています`);
      const quaternionNorm = Math.hypot(...point.q);
      if (Math.abs(quaternionNorm - 1) > 2e-4) errors.push(`${drill.id}: 回転姿勢が正規化されていません`);
    }
  }
}

if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`ブラウザー物理検証: ${drills.drills.length}/${drills.drills.length} 課題が合格（最長 ${slowest.toFixed(2)} ms）`);
}
