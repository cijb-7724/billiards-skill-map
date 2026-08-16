import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "app", "roadmapTasks.json");
const reportPath = join(root, "public", "generated", "validation.json");
const data = JSON.parse(await readFile(sourcePath, "utf8"));
const TABLE = { width: 8, height: 4, radius: .09 };
const pockets = new Map([
  ["左上", [0, 4]], ["上中央", [4, 4]], ["右上", [8, 4]],
  ["左下", [0, 0]], ["下中央", [4, 0]], ["右下", [8, 0]],
]);
const quarter = (value) => Math.abs(value * 4 - Math.round(value * 4)) < 1e-8;
const railTouchY = (value) => Math.abs(value - .16) < .03 || Math.abs(value - 3.84) < .03;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const errors = [];
const results = [];
const ids = new Set();

if (data.drills.length !== 74) errors.push(`課題数が74ではありません: ${data.drills.length}`);
if (data.chapters.length !== 13) errors.push(`章数が13ではありません: ${data.chapters.length}`);

for (const drill of data.drills) {
  const local = [];
  if (ids.has(drill.id)) local.push(`${drill.id}: 課題番号が重複しています`);
  ids.add(drill.id);
  if (!drill.balls.some((ball) => ball.id === "CB")) local.push(`${drill.id}: 手玉がありません`);
  if (!Number.isFinite(drill.aimPoint?.x) || !Number.isFinite(drill.aimPoint?.y)) local.push(`${drill.id}: 狙い点が不正です`);

  for (const ball of drill.balls) {
    if (ball.x < 0 || ball.x > TABLE.width || ball.y < 0 || ball.y > TABLE.height) local.push(`${drill.id}: ${ball.id} が台外です`);
    if (!quarter(ball.x) || (!quarter(ball.y) && !railTouchY(ball.y))) local.push(`${drill.id}: ${ball.id} は0.25目盛またはクッションタッチではありません`);
    const path = drill.trajectories.find((candidate) => candidate.ballId === ball.id);
    if (!path) {
      if (!ball.id.startsWith("BLOCK")) local.push(`${drill.id}: ${ball.id} の図示軌道がありません`);
    } else if (distance(ball, path.points[0]) > 1e-8) local.push(`${drill.id}: ${ball.id} の配置と軌道始点が一致しません`);
  }
  for (let first = 0; first < drill.balls.length; first++) {
    for (let second = first + 1; second < drill.balls.length; second++) {
      if (distance(drill.balls[first], drill.balls[second]) < TABLE.radius * 2 - 1e-6) local.push(`${drill.id}: 初期配置で球が重なっています`);
    }
  }

  for (const zone of drill.zones) {
    if (zone.x1 < 0 || zone.x2 > 8 || zone.y1 < 0 || zone.y2 > 4 || zone.x1 >= zone.x2 || zone.y1 >= zone.y2) local.push(`${drill.id}: 合格領域が台外または空です`);
    if (![zone.x1, zone.y1, zone.x2, zone.y2].every(quarter)) local.push(`${drill.id}: 合格領域が0.25目盛に揃っていません`);
  }
  for (const pocketName of drill.targetPockets) if (!pockets.has(pocketName)) local.push(`${drill.id}: ポケット名 ${pocketName} が不正です`);

  for (const path of drill.trajectories) {
    path.points.forEach((point, index) => {
      if (![point.t, point.x, point.y].every(Number.isFinite)) local.push(`${drill.id}: ${path.ballId} の軌道に不正値があります`);
      if (index && point.t <= path.points[index - 1].t) local.push(`${drill.id}: ${path.ballId} の時刻が昇順ではありません`);
    });
  }

  drill.targetPockets.forEach((pocketName, index) => {
    const endpoint = drill.trajectories.find((path) => path.ballId === `OB${index + 1}`)?.points.at(-1);
    const pocket = pockets.get(pocketName);
    if (endpoint && pocket && Math.hypot(endpoint.x - pocket[0], endpoint.y - pocket[1]) > .22) local.push(`${drill.id}: OB${index + 1} の図示軌道が${pocketName}へ届きません`);
  });

  errors.push(...local);
  results.push({ id: drill.id, status: local.length ? "不合格" : "合格", errors: local });
}

for (const chapter of data.chapters) {
  for (const id of chapter.drills) if (!ids.has(id)) errors.push(`${chapter.id}: 存在しない課題 ${id} を参照しています`);
}
for (const id of ids) {
  const references = data.chapters.filter((chapter) => chapter.drills.includes(id));
  if (references.length !== 1) errors.push(`${id}: 章からの参照数が1ではありません`);
}

const report = { generatedAt: new Date().toISOString(), total: data.drills.length, passed: results.filter((item) => item.status === "合格").length, results, errors };
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`課題カタログ検証: ${report.passed}/${report.total} 課題が合格しました`);
