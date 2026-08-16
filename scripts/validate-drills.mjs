import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "app", "drills.json");
const reportPath = join(root, "public", "generated", "validation.json");
const data = JSON.parse(await readFile(sourcePath, "utf8"));
const TABLE = { width: 8, height: 4, radius: 0.09, pocketMouth: 0.24 };
const pockets = {
  "左上": [0, 0], "上中央": [4, 0], "右上": [8, 0],
  "左下": [0, 4], "下中央": [4, 4], "右下": [8, 4],
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (point, zone) => point.x >= zone.x1 && point.x <= zone.x2 && point.y >= zone.y1 && point.y <= zone.y2;
const onQuarterGrid = (value) => Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;

function interpolate(points, time) {
  if (time <= points[0].t) return points[0];
  if (time >= points.at(-1).t) return points.at(-1);
  const endIndex = points.findIndex((point) => point.t >= time);
  const start = points[endIndex - 1];
  const end = points[endIndex];
  const ratio = (time - start.t) / (end.t - start.t);
  return { x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio };
}

function validateRailContact(drill, point, errors) {
  const nearHorizontal = point.y <= TABLE.radius + 0.015 || point.y >= TABLE.height - TABLE.radius - 0.015;
  const nearVertical = point.x <= TABLE.radius + 0.015 || point.x >= TABLE.width - TABLE.radius - 0.015;
  if (!nearHorizontal && !nearVertical) return;
  const pocketAxes = nearHorizontal ? [0, 4, 8] : [0, 4];
  const axis = nearHorizontal ? point.x : point.y;
  const atOpening = pocketAxes.some((value) => Math.abs(value - axis) < TABLE.pocketMouth);
  if (atOpening) errors.push(`${drill.id}: クッション接触点 (${point.x}, ${point.y}) がポケット開口部に入っています`);
}

const ids = new Set();
const errors = [];
const results = [];

for (const drill of data.drills) {
  const drillErrors = [];
  if (ids.has(drill.id)) drillErrors.push(`${drill.id}: 課題番号が重複しています`);
  ids.add(drill.id);

  for (const ball of drill.balls) {
    if (ball.x < TABLE.radius || ball.x > TABLE.width - TABLE.radius || ball.y < TABLE.radius || ball.y > TABLE.height - TABLE.radius) {
      drillErrors.push(`${drill.id}: ${ball.id} の初期座標がプレー領域外です`);
    }
    if (!onQuarterGrid(ball.x) || !onQuarterGrid(ball.y)) {
      drillErrors.push(`${drill.id}: ${ball.id} の初期座標は0.25目盛に揃っていません`);
    }
  }
  for (let i = 0; i < drill.balls.length; i++) {
    for (let j = i + 1; j < drill.balls.length; j++) {
      if (distance(drill.balls[i], drill.balls[j]) < TABLE.radius * 2) drillErrors.push(`${drill.id}: 初期配置で球が重なっています`);
    }
  }

  for (const trajectory of drill.trajectories) {
    for (const point of trajectory.points.slice(1, -1)) {
      if (point.visible !== false) validateRailContact(drill, point, drillErrors);
    }
    for (let i = 1; i < trajectory.points.length; i++) {
      if (trajectory.points[i].t <= trajectory.points[i - 1].t) drillErrors.push(`${drill.id}: ${trajectory.ballId} の時刻が昇順ではありません`);
    }
  }

  if (drill.successZone) {
    const zone = drill.successZone;
    if (zone.x1 >= zone.x2 || zone.y1 >= zone.y2 || zone.x1 < 0 || zone.x2 > 8 || zone.y1 < 0 || zone.y2 > 4) {
      drillErrors.push(`${drill.id}: 合格領域の長方形が不正です`);
    }
    if (![zone.x1, zone.y1, zone.x2, zone.y2].every(onQuarterGrid)) {
      drillErrors.push(`${drill.id}: 合格領域の境界は0.25目盛に揃っていません`);
    }
    const targetTrajectory = drill.trajectories.find((trajectory) => trajectory.ballId === drill.successBallId);
    if (!targetTrajectory) drillErrors.push(`${drill.id}: 合格判定対象の軌道がありません`);
    else {
      const reaches = drill.successMode === "stop"
        ? inside(targetTrajectory.points.at(-1), zone)
        : Array.from({ length: 301 }, (_, index) => interpolate(targetTrajectory.points, drill.duration * index / 300)).some((point) => inside(point, zone));
      if (!reaches) drillErrors.push(`${drill.id}: 指定球の軌道が合格領域に到達しません`);
    }
  }

  if (drill.targetPocket !== "なし") {
    const pocket = pockets[drill.targetPocket];
    if (!pocket) drillErrors.push(`${drill.id}: 指定ポケット名が不正です`);
    const objectTrajectory = drill.trajectories.find((trajectory) => trajectory.ballId.startsWith("OB"));
    if (!objectTrajectory) drillErrors.push(`${drill.id}: 入球対象の的玉軌道がありません`);
    else if (pocket) {
      const end = objectTrajectory.points.at(-1);
      if (Math.hypot(end.x - pocket[0], end.y - pocket[1]) > 0.12) drillErrors.push(`${drill.id}: 的玉軌道が指定ポケットで終了しません`);
    }
  }

  if (drill.balls.some((ball) => ball.id.startsWith("OB"))) {
    const cueTrajectory = drill.trajectories.find((trajectory) => trajectory.ballId === "CB");
    const objectTrajectory = drill.trajectories.find((trajectory) => trajectory.ballId.startsWith("OB"));
    if (cueTrajectory && objectTrajectory) {
      let minimum = Infinity;
      for (let i = 0; i <= 400; i++) {
        const t = drill.duration * i / 400;
        minimum = Math.min(minimum, distance(interpolate(cueTrajectory.points, t), interpolate(objectTrajectory.points, t)));
      }
      if (minimum > TABLE.radius * 2 + 0.025) drillErrors.push(`${drill.id}: 手玉と的玉の衝突が軌道上に存在しません`);
    }
  }

  errors.push(...drillErrors);
  results.push({ id: drill.id, status: drillErrors.length ? "不合格" : "合格", checks: 9, errors: drillErrors });
}

for (const chapter of data.chapters) {
  for (const id of chapter.drills) if (!ids.has(id)) errors.push(`${chapter.id}: 存在しない課題 ${id} を参照しています`);
}

const report = { generatedAt: new Date().toISOString(), table: TABLE, total: data.drills.length, passed: results.filter((item) => item.status === "合格").length, results, errors };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`幾何検証: ${report.passed}/${report.total} 課題が合格しました`);
}
