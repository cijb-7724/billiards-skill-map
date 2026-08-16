import fs from "node:fs";
import roadmap from "../app/roadmapTasks.json";
import { simulateBrowserShot, type BrowserShot } from "../app/physics";

const output: Record<string, BrowserShot> = {};

for (const task of roadmap.drills) {
  if (task.interactive) {
    output[task.id] = simulateBrowserShot({
      requestId: 1,
      balls: task.balls.map((ball) => ({ id: ball.id, color: ball.color, x: ball.x, y: ball.y })),
      aimPoint: task.aimPoint,
      cue: {
        x: task.cue.x,
        y: task.cue.y,
        speedMps: task.cue.speedMps,
        elevationDeg: task.cue.elevationDeg,
      },
    });
  } else {
    output[task.id] = {
      duration: task.duration,
      engine: "再設計用の課題図",
      trajectories: task.trajectories,
    } as BrowserShot;
  }
}

fs.writeFileSync(new URL("../app/roadmapTrajectories.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${Object.keys(output).length} task trajectories`);
