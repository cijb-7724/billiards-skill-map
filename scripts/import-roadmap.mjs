import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? path.resolve(process.cwd(), "../roadmap_v4.tex");
const output = process.argv[3] ?? path.resolve(process.cwd(), "app/roadmapTasks.json");
const source = fs.readFileSync(input, "utf8");

const chapters = [
  ["r0", "R0", "基準を作る", "直進・速度校正・短い直球"],
  ["r1", "R1", "縦回転", "入れ・ストップ・フォロー・ドロー"],
  ["r2", "R2", "分離", "90度・30度・ドロー分離"],
  ["r3", "R3", "芯撞きの位置取り", "横回転なしの1〜2クッション"],
  ["r4", "R4", "横回転の測定", "トビ・カーブ・スロー・反射"],
  ["r5", "R5", "横回転の実用", "順・逆・内・外と位置取り"],
  ["r6", "R6", "取り切り", "2球から5球へ"],
  ["r7", "R7", "守備とキック", "距離・隠し・1〜3クッション"],
  ["r8", "R8", "バンク", "鏡像・速度・回転・2クッション"],
  ["r9", "R9", "クッション際", "密着球と連続シュート"],
  ["r10", "R10", "コンビネーション", "間隔・スロー・3球連鎖"],
  ["r11", "R11", "キャノン", "分離線・クッション先・クラスター"],
  ["r12", "R12", "上級循環", "ブレイク・ジャンプ・マッセ・初見"],
].map(([id, number, title, summary]) => ({ id, number, title, summary, status: "再検証中", drills: [] }));

function readGroup(text, start) {
  if (text[start] !== "{") throw new Error(`Expected group at ${start}`);
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === "{" && text[index - 1] !== "\\") depth++;
    else if (text[index] === "}" && text[index - 1] !== "\\") {
      depth--;
      if (depth === 0) return { value: text.slice(start + 1, index), end: index + 1 };
    }
  }
  throw new Error(`Unclosed group at ${start}`);
}

function extractTaskCards(text) {
  const cards = [];
  const marker = "\\TaskCard";
  let cursor = 0;
  while ((cursor = text.indexOf(marker, cursor)) >= 0) {
    if (text[cursor + marker.length] !== "{") {
      cursor += marker.length;
      continue;
    }
    let position = cursor + marker.length;
    const fields = [];
    for (let field = 0; field < 9; field++) {
      while (/\s/.test(text[position])) position++;
      const group = readGroup(text, position);
      fields.push(group.value);
      position = group.end;
    }
    cards.push(fields);
    cursor = position;
  }
  return cards;
}

function plainTex(value) {
  let result = value
    .replace(/\\textbf\{([^{}]*)\}/g, "$1")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\times/g, "×")
    .replace(/\\%/g, "%")
    .replace(/\\quad|\\qquad/g, " ")
    .replace(/\\,/g, "")
    .replace(/~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\([A-Za-z]+)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  result = result.replace(/-\./g, "-0.").replace(/(^|[\[(,\s])\./g, "$10.");
  return result;
}

const number = (value) => Number(String(value).replace(/^\./, "0.").replace(/^-\./, "-0."));
const coordinates = (value) => [...value.matchAll(/\((-?\.?\d+(?:\.\d+)?),\s*(-?\.?\d+(?:\.\d+)?)\)/g)]
  .map((match) => ({ x: number(match[1]), y: number(match[2]) }));

function macroGroups(diagram, name, count) {
  const items = [];
  const marker = `\\${name}`;
  let cursor = 0;
  while ((cursor = diagram.indexOf(marker, cursor)) >= 0) {
    let position = cursor + marker.length;
    const groups = [];
    for (let field = 0; field < count; field++) {
      while (/\s/.test(diagram[position])) position++;
      const group = readGroup(diagram, position);
      groups.push(group.value);
      position = group.end;
    }
    items.push(groups);
    cursor = position;
  }
  return items;
}

function pocketName({ x, y }) {
  if (x === 0 && y === 4) return "左上";
  if (x === 4 && y === 4) return "上中央";
  if (x === 8 && y === 4) return "右上";
  if (x === 0 && y === 0) return "左下";
  if (x === 4 && y === 0) return "下中央";
  if (x === 8 && y === 0) return "右下";
  return null;
}

function speedMps(label) {
  if (label.includes("S4") || label.includes("強")) return 2.8;
  if (label.includes("S3")) return 2.15;
  if (label.includes("S2")) return 1.45;
  if (label.includes("S1") || label.includes("弱")) return .8;
  return 1.45;
}

function passRule(text) {
  const standard = text.match(/(\d+)(?:球|組|課題)中(\d+)/);
  if (standard) return { attempts: Number(standard[1]), required: Number(standard[2]), sessions: 2 };
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) return { attempts: Number(fraction[2]), required: Number(fraction[1]), sessions: 2 };
  return { attempts: 10, required: 5, sessions: 2 };
}

function trajectory(ballId, color, points) {
  const usable = points.length ? points : [{ x: 0, y: 0 }];
  return {
    ballId,
    color,
    points: usable.map((point, index) => ({ t: index, x: point.x, y: point.y, q: [1, 0, 0, 0] })),
  };
}

function taskFromCard(fields) {
  const [heading, diagram, setupTex, cueXTex, cueYTex, speedTex, successTex, passTex, meaningTex] = fields;
  const headingText = plainTex(heading);
  const id = headingText.match(/^R\d+-\d+[ab]?/)?.[0];
  if (!id) throw new Error(`Task id not found: ${headingText}`);
  const title = headingText.slice(id.length).trim();
  const chapterNumber = id.match(/^R\d+/)[0];
  const chapter = chapters.find((candidate) => candidate.number === chapterNumber);
  chapter.drills.push(id);

  const cueMacro = macroGroups(diagram, "CueBall", 2)[0];
  const cueBall = cueMacro ? { id: "CB", label: "", color: "#f7f7f2", x: number(cueMacro[0]), y: number(cueMacro[1]) } : null;
  const objectMacros = macroGroups(diagram, "ObjectBall", 3);
  const blockMacros = macroGroups(diagram, "BlockBall", 3);
  const balls = cueBall ? [cueBall] : [];
  objectMacros.forEach((ball, index) => balls.push({ id: `OB${index + 1}`, label: plainTex(ball[2]), color: "#e8b92e", x: number(ball[0]), y: number(ball[1]) }));
  blockMacros.forEach((ball, index) => balls.push({ id: `BLOCK${index + 1}`, label: plainTex(ball[2]), color: "#c64b43", x: number(ball[0]), y: number(ball[1]) }));

  const cuePaths = macroGroups(diagram, "CuePath", 1).map(([pathValue]) => coordinates(pathValue));
  const objectPaths = macroGroups(diagram, "ObjPath", 1).map(([pathValue]) => coordinates(pathValue));
  const zones = macroGroups(diagram, "TargetZone", 5).map(([x1, y1, x2, y2, label]) => ({
    x1: number(x1), y1: number(y1), x2: number(x2), y2: number(y2), label: plainTex(label),
  }));
  const pockets = macroGroups(diagram, "PocketMark", 3).map(([x, y, label]) => ({
    x: number(x), y: number(y), label: plainTex(label), name: pocketName({ x: number(x), y: number(y) }),
  }));
  const railAims = macroGroups(diagram, "RailAim", 3).map(([x, y, label]) => ({ x: number(x), y: number(y), label: plainTex(label) }));

  const authoredTrajectories = [];
  if (cueBall) authoredTrajectories.push(trajectory("CB", "#74e7ff", cuePaths[0]?.length ? cuePaths[0] : [cueBall]));
  objectMacros.forEach((_, index) => {
    const ball = balls.find((candidate) => candidate.id === `OB${index + 1}`);
    authoredTrajectories.push(trajectory(`OB${index + 1}`, "#ffe36e", objectPaths[index]?.length ? objectPaths[index] : [ball]));
  });

  let aimPoint = cuePaths[0]?.[1] ?? (cueBall ? { x: cueBall.x + 1, y: cueBall.y } : { x: 4, y: 2 });
  if (objectMacros.length && objectPaths[0]?.length > 1) {
    const objectBall = balls.find((candidate) => candidate.id === "OB1");
    const directionX = objectPaths[0][1].x - objectPaths[0][0].x;
    const directionY = objectPaths[0][1].y - objectPaths[0][0].y;
    const magnitude = Math.hypot(directionX, directionY) || 1;
    aimPoint = { x: objectBall.x - directionX / magnitude * .18, y: objectBall.y - directionY / magnitude * .18 };
  }

  const cueX = number(cueXTex);
  const cueY = number(cueYTex);
  const speed = plainTex(speedTex);
  const success = plainTex(successTex);
  const meaning = plainTex(meaningTex);
  const primaryZone = zones[0] ?? null;
  const successBallId = primaryZone && /的球/.test(primaryZone.label) ? "OB1" : primaryZone ? "CB" : null;
  const unsupported = id.startsWith("R6-") || id === "R12-01" || id === "R12-02" || id === "R12-03" || id === "R12-04" || id === "R12-05";

  return {
    id,
    chapterTitle: chapter.title,
    level: chapter.number,
    title,
    purpose: meaning,
    setup: plainTex(setupTex),
    success,
    pass: passRule(plainTex(passTex)),
    cue: {
      x: cueX,
      y: cueY,
      label: `撞点（${cueX >= 0 ? "+" : ""}${cueX.toFixed(2)}, ${cueY >= 0 ? "+" : ""}${cueY.toFixed(2)}）`,
      speed,
      speedMps: speedMps(speed),
      elevation: id === "R12-02" ? "ジャンプ角" : id === "R12-03" ? "マッセ角" : "ほぼ水平",
      elevationDeg: id === "R12-02" ? 42 : id === "R12-03" ? 65 : 5,
    },
    balls,
    aimPoint,
    targetPocket: pockets[0]?.name ?? null,
    targetPockets: pockets.filter((pocket) => pocket.name).map((pocket) => pocket.name),
    pockets,
    railAims,
    successZone: primaryZone,
    zones,
    successBallId,
    successMode: "stop",
    duration: Math.max(1, ...authoredTrajectories.map((item) => item.points.at(-1)?.t ?? 0)),
    trajectories: authoredTrajectories,
    knowledge: { title: `${title}で覚えること`, body: meaning },
    validation: {
      geometry: "再検証中",
      geometryNote: "PDFから移植。座標、クッション接触順、入球線を再計算する。",
      physics: unsupported ? "現在の物理モデル対象外" : "再検証中",
      physicsNote: unsupported ? "複数ショットまたは鉛直運動を含むため、誤った再生は行わない。" : "達成可能な撞点・強さを探索してから公開する。",
      provenance: "ロードマップPDF",
      source: id,
    },
    interactive: false,
    authoredDiagram: true,
  };
}

const tasks = extractTaskCards(source).map(taskFromCard);

function revise(id, changes) {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  Object.assign(task, changes);
  task.validation.geometry = "再設計済み・物理確認待ち";
}

revise("R7-01", {
  success: "両球停止後、的球を右上側、手球を的球進路に直角な左上側の合格域へ入れる。",
  successZone: { x1: 2.8, y1: 3.2, x2: 3.8, y2: 3.9, label: "手球" },
  zones: [
    { x1: 2.8, y1: 3.2, x2: 3.8, y2: 3.9, label: "手球" },
    { x1: 6.5, y1: 2.5, x2: 7.5, y2: 3.5, label: "的球" },
  ],
  trajectories: [
    trajectory("CB", "#74e7ff", [{ x: 2, y: 1 }, { x: 4, y: 2 }, { x: 3.3, y: 3.8 }]),
    trajectory("OB1", "#ffe36e", [{ x: 4, y: 2 }, { x: 7, y: 3 }]),
  ],
});

revise("R7-03", {
  setup: "手球（2,1）、的球（6,3）。上長クッションのダイヤ5付近を使う1クッションキック。",
  success: "鏡像法で上長クッション（5,4）を基準にし、手球を的球へ当てる。サイドポケット開口部は反射点に使わない。",
  railAims: [{ x: 5, y: 4, label: "反射点" }],
  trajectories: [
    trajectory("CB", "#74e7ff", [{ x: 2, y: 1 }, { x: 5, y: 4 }, { x: 6, y: 3 }]),
    trajectory("OB1", "#ffe36e", [{ x: 6, y: 3 }]),
  ],
});

revise("R8-06", {
  setup: "手球（2.5,1.8）、的球1（4,2.5）。的球を右短、下長クッション経由で左上へ入れる。",
  balls: [
    { id: "CB", label: "", color: "#f7f7f2", x: 2.5, y: 1.8 },
    { id: "OB1", label: "1", color: "#e8b92e", x: 4, y: 2.5 },
  ],
  targetPocket: "左上",
  targetPockets: ["左上"],
  pockets: [{ x: 0, y: 4, label: "狙", name: "左上" }],
  railAims: [{ x: 8, y: .33, label: "第1点" }, { x: 7.38, y: 0, label: "第2点" }],
  success: "右短クッション（8,0.33）、下長クッション（7.38,0）を基準に、左上へ入球する。",
  trajectories: [
    trajectory("CB", "#74e7ff", [{ x: 2.5, y: 1.8 }, { x: 3.84, y: 2.41 }]),
    trajectory("OB1", "#ffe36e", [{ x: 4, y: 2.5 }, { x: 8, y: .33 }, { x: 7.38, y: 0 }, { x: 0, y: 4 }]),
  ],
});

revise("R9-04", {
  setup: "手球（4.5,2.5）、1番（3,3.84）、2番（6,3.84）。1番を左上、2番を右上へ番号順。",
  balls: [
    { id: "CB", label: "", color: "#f7f7f2", x: 4.5, y: 2.5 },
    { id: "OB1", label: "1", color: "#e8b92e", x: 3, y: 3.84 },
    { id: "OB2", label: "2", color: "#e8b92e", x: 6, y: 3.84 },
  ],
  success: "1番を左上へ入れ、手球を中央上側へ運んでから2番を右上へ入れる。",
  successZone: { x1: 4.25, y1: 3.05, x2: 5.25, y2: 3.72, label: "次球" },
  zones: [{ x1: 4.25, y1: 3.05, x2: 5.25, y2: 3.72, label: "次球" }],
  trajectories: [
    trajectory("CB", "#74e7ff", [{ x: 4.5, y: 2.5 }, { x: 3, y: 3.84 }, { x: 4.75, y: 3.45 }]),
    trajectory("OB1", "#ffe36e", [{ x: 3, y: 3.84 }, { x: 0, y: 4 }]),
    trajectory("OB2", "#ffe36e", [{ x: 6, y: 3.84 }, { x: 8, y: 4 }]),
  ],
});

revise("R9-05", {
  setup: "手球（4.5,2.4）、1番（2.5,3.84）、2番（4.8,3.84）、3番（7,3.84）。指定ポケットへ番号順。",
  balls: [
    { id: "CB", label: "", color: "#f7f7f2", x: 4.5, y: 2.4 },
    { id: "OB1", label: "1", color: "#e8b92e", x: 2.5, y: 3.84 },
    { id: "OB2", label: "2", color: "#e8b92e", x: 4.8, y: 3.84 },
    { id: "OB3", label: "3", color: "#e8b92e", x: 7, y: 3.84 },
  ],
  success: "1番を左上へ入れて中央上側へ出し、2番を上中央、3番を右上へ取る。各ショット前に次の長方形を宣言する。",
  successZone: { x1: 3.65, y1: 3.0, x2: 4.45, y2: 3.68, label: "1後" },
  zones: [
    { x1: 3.65, y1: 3.0, x2: 4.45, y2: 3.68, label: "1後" },
    { x1: 5.8, y1: 3.0, x2: 6.65, y2: 3.68, label: "2後" },
  ],
  trajectories: [
    trajectory("CB", "#74e7ff", [{ x: 4.5, y: 2.4 }, { x: 2.5, y: 3.84 }, { x: 4.05, y: 3.35 }, { x: 4.8, y: 3.84 }, { x: 6.2, y: 3.35 }, { x: 7, y: 3.84 }]),
    trajectory("OB1", "#ffe36e", [{ x: 2.5, y: 3.84 }, { x: 0, y: 4 }]),
    trajectory("OB2", "#ffe36e", [{ x: 4.8, y: 3.84 }, { x: 4, y: 4 }]),
    trajectory("OB3", "#ffe36e", [{ x: 7, y: 3.84 }, { x: 8, y: 4 }]),
  ],
});

revise("R0-01", {
  aimPoint: { x: 8, y: 2 },
  trajectories: [trajectory("CB", "#74e7ff", [{ x: 1, y: 2 }, { x: 8, y: 2 }, { x: 1, y: 2 }])],
});

// A player must be able to reproduce a layout from the table diamonds. Snap
// ordinary ball placements and every rectangular boundary to the 0.25 grid.
// Cushion-frozen balls keep their physical rail-contact coordinate; the UI
// describes those as "cushion touch" instead of exposing a spurious decimal.
const snapQuarter = (value) => Math.round(value * 4) / 4;
for (const task of tasks) {
  for (const ball of task.balls) {
    const old = { x: ball.x, y: ball.y };
    ball.x = snapQuarter(ball.x);
    if (!(Math.abs(ball.y - .16) < .03 || Math.abs(ball.y - 3.84) < .03)) ball.y = snapQuarter(ball.y);
    if (old.x !== ball.x || old.y !== ball.y) {
      task.setup = task.setup.replaceAll(`(${old.x},${old.y})`, `(${ball.x},${ball.y})`);
      task.setup = task.setup.replaceAll(`（${old.x},${old.y}）`, `（${ball.x},${ball.y}）`);
    }
    const ballTrajectory = task.trajectories.find((candidate) => candidate.ballId === ball.id);
    if (ballTrajectory?.points?.length) {
      ballTrajectory.points[0].x = ball.x;
      ballTrajectory.points[0].y = ball.y;
    }
    if (ball.id === "CB" && task.aimPoint && !task.balls.some((candidate) => candidate.id === "OB1")) {
      task.aimPoint.x += ball.x - old.x;
      task.aimPoint.y += ball.y - old.y;
    }
  }
  for (const zone of task.zones) {
    zone.x1 = snapQuarter(zone.x1); zone.y1 = snapQuarter(zone.y1);
    zone.x2 = snapQuarter(zone.x2); zone.y2 = snapQuarter(zone.y2);
    if (zone.x2 <= zone.x1) zone.x2 = Math.min(8, zone.x1 + .25);
    if (zone.y2 <= zone.y1) zone.y2 = Math.min(4, zone.y1 + .25);
  }
  let zoneIndex = 0;
  task.success = task.success.replace(/\[-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\]×\[-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?\]/g, (original) => {
    const zone = task.zones[zoneIndex++];
    return zone ? `[${zone.x1},${zone.x2}]×[${zone.y1},${zone.y2}]` : original;
  });
  task.successZone = task.zones[0] ?? null;
  const objectBall = task.balls.find((candidate) => candidate.id === "OB1");
  const objectPath = task.trajectories.find((candidate) => candidate.ballId === "OB1")?.points;
  if (objectBall && objectPath?.length > 1) {
    const dx = objectPath[1].x - objectPath[0].x;
    const dy = objectPath[1].y - objectPath[0].y;
    const magnitude = Math.hypot(dx, dy) || 1;
    task.aimPoint = { x: objectBall.x - dx / magnitude * .18, y: objectBall.y - dy / magnitude * .18 };
  }
}

const verifiedSettings = {
  "R0-01": { x: 0, y: .25, speedMps: 1.75, speed: "S3" },
  "R0-02": { x: 0, y: .25, speedMps: 1.2, speed: "S2（基準表示）" },
  "R0-03": { x: 0, y: 0, speedMps: .5, speed: "S1" },
  "R1-01": { x: 0, y: .25, speedMps: .7, speed: "S1" },
  "R1-02": { x: 0, y: -.15, speedMps: 1.45, speed: "S2" },
  "R1-03": { x: 0, y: .25, speedMps: .8, speed: "S1" },
  "R1-04": { x: 0, y: .45, speedMps: 1.1, speed: "S1" },
  "R1-05": { x: 0, y: -.4, speedMps: 1.85, speed: "S3" },
  "R1-06": { x: 0, y: -.5, speedMps: 2.45, speed: "S3" },
  "R2-01": { x: 0, y: .35, speedMps: .8, speed: "S1" },
  "R2-02": { x: 0, y: .35, speedMps: .8, speed: "S1" },
  "R2-03a": { x: 0, y: -.05, speedMps: .7, speed: "S1" },
  "R2-03b": { x: 0, y: -.35, speedMps: 1.8, speed: "S3" },
  "R2-04a": { x: 0, y: .45, speedMps: .75, speed: "S1" },
  "R2-04b": { x: 0, y: .45, speedMps: .9, speed: "S1～S2" },
  "R2-05a": { x: 0, y: -.5, speedMps: 2.1, speed: "S3" },
  "R2-05b": { x: 0, y: -.55, speedMps: 2.45, speed: "S3" },
};

for (const [id, setting] of Object.entries(verifiedSettings)) {
  const task = tasks.find((candidate) => candidate.id === id);
  task.cue = { ...task.cue, ...setting };
  task.cue.label = `撞点（${task.cue.x >= 0 ? "+" : ""}${task.cue.x.toFixed(2)}, ${task.cue.y >= 0 ? "+" : ""}${task.cue.y.toFixed(2)}）`;
  task.interactive = true;
  task.validation = {
    ...task.validation,
    geometry: "幾何確認済み",
    geometryNote: "球中心、入球線、クッション接触と合格領域を確認。",
    physics: "ブラウザー物理確認済み",
    physicsNote: "既定撞点・強さで入球または合格領域への到達を確認。",
  };
}

// R0-02 has three stopping bands. The displayed reference speed is S2, so the
// primary success zone must be the middle band rather than the first S1 band.
const r002 = tasks.find((task) => task.id === "R0-02");
if (r002?.zones?.[1]) r002.successZone = r002.zones[1];
const r204b = tasks.find((task) => task.id === "R2-04b");
if (r204b) r204b.successMode = "pass";

for (const task of tasks) {
  task.setup = task.setup
    .replace(/[（(]([\d.]+),3\.84[）)]/g, "（長辺$1・上クッションタッチ）")
    .replace(/[（(]([\d.]+),0\.16[）)]/g, "（長辺$1・下クッションタッチ）");
}

chapters.find((chapter) => chapter.id === "r0").status = "公開中";
chapters.find((chapter) => chapter.id === "r1").status = "公開中";
chapters.find((chapter) => chapter.id === "r2").status = "公開中";

fs.writeFileSync(output, `${JSON.stringify({ version: "0.2", generatedFrom: path.basename(input), chapters, drills: tasks }, null, 2)}\n`);
console.log(`Imported ${tasks.length} tasks to ${output}`);
