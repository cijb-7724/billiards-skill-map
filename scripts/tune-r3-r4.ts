import roadmap from "../app/roadmapTasks.json";
import { simulateBrowserShot, type BrowserShot, type SimulationRequest } from "../app/physics";

type Drill = (typeof roadmap.drills)[number];

const task = (id: string) => roadmap.drills.find((candidate) => candidate.id === id)!;

function simulate(drill: Drill, cue: { x: number; y: number; speed: number }, aimPoint = drill.aimPoint, balls = drill.balls) {
  return simulateBrowserShot({
    requestId: 1,
    balls,
    aimPoint,
    cue: { x: cue.x, y: cue.y, speedMps: cue.speed, elevationDeg: 5 },
  });
}

function railEvents(shot: BrowserShot, ballId = "CB") {
  const trajectory = shot.trajectories.find((candidate) => candidate.ballId === ballId)!;
  const events: Array<{ rail: string; t: number; x: number; y: number }> = [];
  let previous = "";
  for (const point of trajectory.points) {
    if (point.visible === false) continue;
    const rail = point.x <= .11 ? "左短" : point.x >= 7.89 ? "右短" : point.y <= .11 ? "下長" : point.y >= 3.89 ? "上長" : "";
    if (rail && rail !== previous) events.push({ rail, t: point.t, x: point.x, y: point.y });
    previous = rail;
  }
  return events;
}

function end(shot: BrowserShot, ballId = "CB") {
  return shot.trajectories.find((candidate) => candidate.ballId === ballId)!.points.at(-1)!;
}

function pocketed(shot: BrowserShot, ballId = "OB1") {
  return shot.trajectories.find((candidate) => candidate.ballId === ballId)?.points.at(-1)?.visible === false;
}

function zoneDistance(point: { x: number; y: number }, zone: NonNullable<Drill["successZone"]>) {
  const dx = point.x < zone.x1 ? zone.x1 - point.x : point.x > zone.x2 ? point.x - zone.x2 : 0;
  const dy = point.y < zone.y1 ? zone.y1 - point.y : point.y > zone.y2 ? point.y - zone.y2 : 0;
  return Math.hypot(dx, dy);
}

for (const drill of roadmap.drills.filter((candidate) => candidate.level === "R3" || candidate.level === "R4")) {
  const shot = simulate(drill, { x: drill.cue.x, y: drill.cue.y, speed: drill.cue.speedMps });
  console.log("SELECTED", drill.id, JSON.stringify({ pocketed: pocketed(shot), events: railEvents(shot), end: end(shot) }));
}

for (const id of ["R3-01", "R3-02", "R3-03"] as const) {
  const drill = task(id);
  const candidates = [];
  for (let y = -.6; y <= .65 + 1e-9; y += .05) for (let speed = .65; speed <= 3 + 1e-9; speed += .05) {
    const cue = { x: 0, y: Number(y.toFixed(2)), speed: Number(speed.toFixed(2)) };
    const shot = simulate(drill, cue);
    const events = railEvents(shot);
    if (!pocketed(shot) || end(shot).visible === false) continue;
    candidates.push({ cue, events, end: end(shot), distance: zoneDistance(end(shot), drill.successZone!) });
  }
  const oneRail = candidates.filter((candidate) => candidate.events.length === 1).sort((a, b) => a.distance - b.distance);
  const topRight = candidates.filter((candidate) => candidate.events[0]?.rail === "上長" && candidate.events[1]?.rail === "右短").sort((a, b) => a.distance - b.distance);
  console.log("R3 SCAN", id, "ONE", oneRail.slice(0, 5), "TOP_RIGHT", topRight.slice(0, 5));
}

{
  const drill = task("R3-05");
  const results = [];
  for (let aimOffset = -.3; aimOffset <= .3 + 1e-9; aimOffset += .01) for (let y = -.3; y <= .5 + 1e-9; y += .05) for (let speed = .8; speed <= 3 + 1e-9; speed += .1) {
    const base = drill.aimPoint;
    const object = drill.balls.find((ball) => ball.id === "OB1")!;
    const pocket = { x: 0, y: 4 };
    const path = { x: pocket.x - object.x, y: pocket.y - object.y };
    const perpendicular = { x: -path.y / Math.hypot(path.x, path.y), y: path.x / Math.hypot(path.x, path.y) };
    const aimPoint = { x: base.x + perpendicular.x * aimOffset, y: base.y + perpendicular.y * aimOffset };
    const cue = { x: 0, y: Number(y.toFixed(2)), speed: Number(speed.toFixed(2)) };
    const shot = simulate(drill, cue, aimPoint);
    if (!pocketed(shot) || end(shot).visible === false) continue;
    const distance = zoneDistance(end(shot), drill.successZone!);
    if (distance < .001) results.push({ aimPoint, cue, end: end(shot), object: end(shot, "OB1") });
  }
  console.log("R3-05 POCKET+ZONE", results.slice(0, 20));
}

for (const id of ["R4-01", "R4-02"] as const) {
  const drill = task(id);
  const cueX = id === "R4-01" ? .25 : -.25;
  for (const speed of [1.2, 1.6, 2, 2.4]) {
    const shot = simulate(drill, { x: cueX, y: 0, speed }, { x: 8, y: 2 });
    console.log("CROSS", id, speed, JSON.stringify({ events: railEvents(shot).slice(0, 2), end: end(shot) }));
  }
}

{
  const drill = task("R4-04");
  const results = [];
  for (let aimOffset = -.35; aimOffset <= .35 + 1e-9; aimOffset += .01) {
    for (let speed = .65; speed <= 2.1 + 1e-9; speed += .05) {
      const aimPoint = { x: drill.aimPoint.x, y: drill.aimPoint.y + aimOffset };
      const shot = simulate(drill, { x: .25, y: 0, speed }, aimPoint);
      if (pocketed(shot)) results.push({ aimY: Number(aimPoint.y.toFixed(3)), speed: Number(speed.toFixed(2)), end: end(shot) });
    }
  }
  console.log("R4-04 POCKETED", results.slice(0, 20));
}

for (const cueX of [.5, -.5]) {
  const drill = task("R4-07");
  for (const speed of [1.2, 1.45, 1.7, 2, 2.3]) {
    const shot = simulate(drill, { x: cueX, y: .2, speed }, { x: 5, y: 4 });
    console.log("MAP", cueX, speed, JSON.stringify({ events: railEvents(shot).slice(0, 4), end: end(shot) }));
  }
}
