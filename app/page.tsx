"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import drillData from "./roadmapTasks.json";
import generatedData from "./roadmapTrajectories.json";
import type { BrowserShot, Quaternion, ShotPoint, ShotTrajectory, SimulationRequest } from "./physics";

const ThreeTable = lazy(() => import("./ThreeTable").then((module) => ({ default: module.ThreeTable })));

type Point = ShotPoint;
type Ball = { id: string; label: string; color: string; x: number; y: number };
type Trajectory = ShotTrajectory;
type Drill = (typeof drillData.drills)[number];
type GeneratedShot = BrowserShot;
type PageKey = "home" | "roadmap" | "exams";

const TABLE = { width: 8, height: 4, ballRadius: 0.09 };
const POCKETS = [
  { id: "左上", x: 0, y: 4 }, { id: "上中央", x: 4, y: 4 },
  { id: "右上", x: 8, y: 4 }, { id: "左下", x: 0, y: 0 },
  { id: "下中央", x: 4, y: 0 }, { id: "右下", x: 8, y: 0 },
];

const IDENTITY_QUATERNION: Quaternion = [1, 0, 0, 0];

function normalizeQuaternion(q: Quaternion): Quaternion {
  const length = Math.hypot(...q) || 1;
  return q.map((value) => value / length) as Quaternion;
}

function interpolateQuaternion(start: Quaternion, end: Quaternion, ratio: number): Quaternion {
  const dot = start.reduce((sum, value, index) => sum + value * end[index], 0);
  const adjustedEnd = dot < 0 ? end.map((value) => -value) as Quaternion : end;
  return normalizeQuaternion(start.map((value, index) => value + (adjustedEnd[index] - value) * ratio) as Quaternion);
}

function rotateVector([w, x, y, z]: Quaternion, [vx, vy, vz]: [number, number, number]): [number, number, number] {
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function interpolate(points: Point[], time: number): Point {
  if (time <= points[0].t) return points[0];
  if (time >= points[points.length - 1].t) return points[points.length - 1];
  const endIndex = points.findIndex((point) => point.t >= time);
  const start = points[endIndex - 1];
  const end = points[endIndex];
  const ratio = (time - start.t) / (end.t - start.t);
  return {
    t: time,
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    q: interpolateQuaternion(start.q ?? IDENTITY_QUATERNION, end.q ?? IDENTITY_QUATERNION, ratio),
    visible: start.visible !== false && (end.visible !== false || ratio < .98),
  };
}

function TableCanvas({
  drill,
  time,
  baselineTrajectories,
  showBaseline,
}: {
  drill: Drill;
  time: number;
  baselineTrajectories: Trajectory[];
  showBaseline: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setCanvasSize((current) => current === `${width}x${height}` ? current : `${width}x${height}`);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padX = Math.max(36, Math.min(58, rect.width * 0.058));
    const feltW = Math.max(80, Math.min(rect.width - padX * 2, (rect.height - 48) * 2));
    const feltX = (rect.width - feltW) / 2;
    const feltH = feltW / 2;
    const feltY = (rect.height - feltH) / 2;
    const sx = (x: number) => feltX + (x / TABLE.width) * feltW;
    const sy = (y: number) => feltY + ((TABLE.height - y) / TABLE.height) * feltH;
    const ballR = Math.max(11, (0.125 / TABLE.height) * feltH);

    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#8a5937";
    context.roundRect(0, 0, rect.width, rect.height, 22);
    context.fill();
    context.fillStyle = "#102f28";
    context.roundRect(feltX - 8, feltY - 8, feltW + 16, feltH + 16, 14);
    context.fill();
    const cloth = context.createLinearGradient(feltX, feltY, feltX, feltY + feltH);
    cloth.addColorStop(0, "#147a61");
    cloth.addColorStop(1, "#0d5f4d");
    context.fillStyle = cloth;
    context.fillRect(feltX, feltY, feltW, feltH);

    for (let x = .25; x < TABLE.width; x += .25) {
      const quarter = Math.round(x * 4);
      context.beginPath(); context.moveTo(sx(x), feltY); context.lineTo(sx(x), feltY + feltH);
      context.strokeStyle = quarter % 4 === 0 ? "rgba(232,245,239,.24)" : quarter % 2 === 0 ? "rgba(232,245,239,.16)" : "rgba(232,245,239,.08)";
      context.lineWidth = quarter % 4 === 0 ? 1.15 : .7; context.stroke();
    }
    for (let y = .25; y < TABLE.height; y += .25) {
      const quarter = Math.round(y * 4);
      context.beginPath(); context.moveTo(feltX, sy(y)); context.lineTo(feltX + feltW, sy(y));
      context.strokeStyle = quarter % 4 === 0 ? "rgba(232,245,239,.24)" : quarter % 2 === 0 ? "rgba(232,245,239,.16)" : "rgba(232,245,239,.08)";
      context.lineWidth = quarter % 4 === 0 ? 1.15 : .7; context.stroke();
    }

    context.fillStyle = "#f2ddae";
    context.font = `${Math.max(8, rect.width * .008)}px ui-monospace, monospace`;
    context.textAlign = "center"; context.textBaseline = "middle";
    for (let x = 0; x <= TABLE.width; x += .5) {
      const px = sx(x);
      const major = Number.isInteger(x);
      context.fillRect(px - .5, feltY + feltH + 7, 1, major ? 6 : 3);
      if (major) context.fillText(String(x), px, feltY + feltH + 23);
    }
    context.textAlign = "right";
    for (let y = 0; y <= TABLE.height; y += .5) {
      const py = sy(y);
      const major = Number.isInteger(y);
      context.fillRect(feltX - (major ? 13 : 10), py - .5, major ? 6 : 3, 1);
      if (major) context.fillText(String(y), feltX - 18, py);
    }

    context.fillStyle = "#f3d6a2";
    for (let x = 1; x < 8; x++) {
      if (x === 4) continue;
      const px = sx(x);
      context.beginPath(); context.arc(px, feltY - 15, 2.4, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(px, feltY + feltH + 15, 2.4, 0, Math.PI * 2); context.fill();
    }
    for (let y = 1; y < 4; y++) {
      const py = sy(y);
      context.beginPath(); context.arc(feltX - 15, py, 2.4, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(feltX + feltW + 15, py, 2.4, 0, Math.PI * 2); context.fill();
    }

    POCKETS.forEach((pocket) => {
      const active = drill.targetPockets.includes(pocket.id);
      context.beginPath();
      context.arc(sx(pocket.x), sy(pocket.y), active ? 15 : 12, 0, Math.PI * 2);
      context.fillStyle = "#111714"; context.fill();
      if (active) {
        context.strokeStyle = "#ffd36b"; context.lineWidth = 4; context.stroke();
      }
    });

    drill.zones.forEach((zone) => {
      context.fillStyle = "rgba(255, 211, 107, .17)";
      context.strokeStyle = "#ffd36b";
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      const top = sy(zone.y2);
      const height = sy(zone.y1) - top;
      context.fillRect(sx(zone.x1), top, sx(zone.x2) - sx(zone.x1), height);
      context.strokeRect(sx(zone.x1), top, sx(zone.x2) - sx(zone.x1), height);
      context.setLineDash([]);
      if (zone.label) {
        context.fillStyle = "#ffe29b";
        context.font = `700 ${Math.max(8, rect.width * .009)}px system-ui`;
        context.textAlign = "left";
        context.fillText(zone.label, sx(zone.x1) + 5, top + 11);
      }
    });

    drill.railAims.forEach((aim) => {
      const px = sx(aim.x); const py = sy(aim.y);
      context.strokeStyle = "#ff786c"; context.lineWidth = 2;
      context.beginPath(); context.moveTo(px - 7, py - 7); context.lineTo(px + 7, py + 7);
      context.moveTo(px + 7, py - 7); context.lineTo(px - 7, py + 7); context.stroke();
    });

    if (showBaseline) baselineTrajectories.forEach((trajectory) => {
      context.beginPath();
      trajectory.points.filter((point) => point.visible !== false).forEach((point, index) => {
        const method = index === 0 ? "moveTo" : "lineTo";
        context[method](sx(point.x), sy(point.y));
      });
      context.strokeStyle = "#d8dedb";
      context.globalAlpha = .27;
      context.lineWidth = 3;
      context.setLineDash([3, 7]);
      context.stroke();
      context.globalAlpha = 1;
      context.setLineDash([]);
    });

    (drill.trajectories as Trajectory[]).forEach((trajectory) => {
      context.beginPath();
      trajectory.points.forEach((point, index) => {
        const method = index === 0 ? "moveTo" : "lineTo";
        context[method](sx(point.x), sy(point.y));
      });
      context.strokeStyle = trajectory.color;
      context.globalAlpha = 0.48;
      context.lineWidth = 2;
      context.setLineDash([5, 7]);
      context.stroke();
      context.globalAlpha = 1;
      context.setLineDash([]);
    });

    const surfaceMarkers: [number, number, number][] = [
      [0, 0, 1], [.86, 0, .5], [-.86, 0, .5], [0, .86, .5], [0, -.86, .5],
      [.86, 0, -.5], [-.86, 0, -.5], [0, .86, -.5], [0, -.86, -.5], [0, 0, -1],
    ];

    (drill.balls as Ball[]).forEach((ball) => {
      const trajectory = (drill.trajectories as Trajectory[]).find((item) => item.ballId === ball.id);
      const position: Point = trajectory ? interpolate(trajectory.points, time) : { ...ball, t: 0, q: IDENTITY_QUATERNION };
      if (position.visible === false) return;
      const px = sx(position.x); const py = sy(position.y);
      context.save();
      context.shadowColor = "rgba(3,20,15,.22)"; context.shadowBlur = 3; context.shadowOffsetY = 2;
      context.beginPath(); context.arc(px, py, ballR, 0, Math.PI * 2);
      context.fillStyle = ball.id === "CB" ? "#f1f0e9" : ball.color; context.fill();
      context.restore();
      context.beginPath(); context.arc(px, py, ballR, 0, Math.PI * 2);
      context.strokeStyle = ball.id === "CB" ? "#b7bcb7" : "#b1851e"; context.lineWidth = 1.2; context.stroke();
      context.beginPath(); context.arc(px - ballR * .28, py - ballR * .3, ballR * .24, 0, Math.PI * 2);
      context.fillStyle = "rgba(255,255,255,.35)"; context.fill();

      const orientation = position.q ?? IDENTITY_QUATERNION;
      surfaceMarkers.map((marker) => rotateVector(orientation, marker))
        .filter((marker) => marker[2] > -.08)
        .sort((a, b) => a[2] - b[2])
        .forEach(([worldX, worldY, worldZ]) => {
          const mx = px + worldY * ballR * .72;
          // 台の短辺座標は画面の下から上へ増えるため、CanvasのY軸とは逆。
          const my = py - worldX * ballR * .72;
          const markerRadius = Math.max(1.35, ballR * (.095 + Math.max(0, worldZ) * .035));
          context.beginPath(); context.arc(mx, my, markerRadius, 0, Math.PI * 2);
          context.fillStyle = ball.id === "CB" ? "#c83f35" : "rgba(255,255,248,.92)"; context.fill();
        });

      if (ball.id !== "CB") {
        context.fillStyle = "#523e0e";
        context.font = `700 ${Math.max(8, ballR * .62)}px system-ui`;
        context.textAlign = "center"; context.textBaseline = "middle";
        context.fillText(ball.label, px, py + .4);
      }
    });
  }, [baselineTrajectories, canvasSize, drill, showBaseline, time]);

  return <canvas ref={canvasRef} className="table-canvas" aria-label={`${drill.id}の配置と軌道`} />;
}

function CuePoint({ x, y }: { x: number; y: number }) {
  return (
    <div className="cue-point" aria-label={`撞点 横${x} 縦${y}`}>
      <span className="axis horizontal" /><span className="axis vertical" />
      <span className="tip" style={{ left: `${50 + x * 38}%`, top: `${50 - y * 38}%` }} />
    </div>
  );
}

function ballCoordinate(ball: Ball) {
  const short = Math.abs(ball.y - 3.84) < .03 ? "上クッションタッチ"
    : Math.abs(ball.y - .16) < .03 ? "下クッションタッチ"
      : `短辺 ${ball.y.toFixed(2)}`;
  return `長辺 ${ball.x.toFixed(2)} ／ ${short}`;
}

function CueController({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const update = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    let nextX = (clientX - (rect.left + rect.width / 2)) / (rect.width * .45);
    let nextY = -((clientY - (rect.top + rect.height / 2)) / (rect.height * .45));
    const radius = Math.hypot(nextX, nextY);
    if (radius > .82) { nextX *= .82 / radius; nextY *= .82 / radius; }
    onChange(Math.round(nextX * 20) / 20, Math.round(nextY * 20) / 20);
  };
  return (
    <div
      ref={ref}
      className="cue-controller"
      role="application"
      tabIndex={0}
      aria-label={`撞点。左右${x.toFixed(2)}、上下${y.toFixed(2)}`}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); update(event.clientX, event.clientY); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event.clientX, event.clientY); }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? .1 : .05;
        if (event.key === "ArrowLeft") onChange(Math.max(-.8, x - step), y);
        else if (event.key === "ArrowRight") onChange(Math.min(.8, x + step), y);
        else if (event.key === "ArrowUp") onChange(x, Math.min(.8, y + step));
        else if (event.key === "ArrowDown") onChange(x, Math.max(-.8, y - step));
        else return;
        event.preventDefault();
      }}
    >
      <span className="axis horizontal" /><span className="axis vertical" />
      <span className="controller-tip" style={{ left: `${50 + x * 45}%`, top: `${50 - y * 45}%` }} />
      <small className="cue-up">上</small><small className="cue-down">下</small><small className="cue-left">左</small><small className="cue-right">右</small>
    </div>
  );
}

function getAimPoint(drill: Drill): { x: number; y: number } {
  if (drill.aimPoint) return drill.aimPoint;
  const cb = drill.balls.find((ball) => ball.id === "CB") ?? drill.balls[0];
  const objectBall = drill.balls.find((ball) => ball.id.startsWith("OB"));
  if (objectBall) {
    const trajectory = drill.trajectories.find((item) => item.ballId === objectBall.id)!;
    const start = trajectory.points[0];
    const moved = trajectory.points.find((point) => Math.hypot(point.x - start.x, point.y - start.y) > .05) ?? trajectory.points.at(-1)!;
    const distance = Math.hypot(moved.x - start.x, moved.y - start.y) || 1;
    return {
      x: objectBall.x - (moved.x - start.x) / distance * TABLE.ballRadius * 2,
      y: objectBall.y - (moved.y - start.y) / distance * TABLE.ballRadius * 2,
    };
  }
  const trajectory = drill.trajectories.find((item) => item.ballId === cb.id)!;
  const moved = trajectory.points.find((point) => Math.hypot(point.x - cb.x, point.y - cb.y) > .05) ?? trajectory.points.at(-1)!;
  return { x: moved.x, y: moved.y };
}

function evaluateExperiment(drill: Drill, shot: BrowserShot) {
  const objectTrajectory = shot.trajectories.find((trajectory) => trajectory.ballId.startsWith("OB"));
  const targetPocket = POCKETS.find((pocket) => pocket.id === drill.targetPocket);
  const pocketSucceeded = !targetPocket || (!!objectTrajectory && (() => {
    const final = objectTrajectory.points.at(-1)!;
    return final.visible === false && Math.hypot(final.x - targetPocket.x, final.y - targetPocket.y) < .2;
  })());
  if (!pocketSucceeded) return "指定ポケットを外れる予測";
  if (!drill.successZone || !drill.successBallId) return "入球条件を満たす予測";
  const trajectory = shot.trajectories.find((candidate) => candidate.ballId === drill.successBallId);
  if (!trajectory) return "合格領域を外れる予測";
  const inside = (point: Point) => point.x >= drill.successZone!.x1 && point.x <= drill.successZone!.x2 && point.y >= drill.successZone!.y1 && point.y <= drill.successZone!.y2;
  const reached = drill.successMode === "stop" ? inside(trajectory.points.at(-1)!) : trajectory.points.some(inside);
  return reached ? "合格条件を満たす予測" : "合格領域を外れる予測";
}

function HomeLanding({ onNavigate }: { onNavigate: (page: PageKey, drillId?: string) => void }) {
  const published = drillData.drills.filter((drill) => drill.interactive).length;
  const roadmapRows = Array.from(
    { length: Math.ceil(drillData.chapters.length / 3) },
    (_, row) => drillData.chapters.slice(row * 3, row * 3 + 3),
  );
  return (
    <section className="home-page">
      <div className="home-hero">
        <div><span>練習を、順番と合格基準でつなぐ</span><h1>ビリヤード技能地図</h1><p>C級の基礎からA・S級帯まで、配置・撞点・強さ・合格領域を同じ形式で確認できます。検証済み課題では3D再生と撞点変更も試せます。</p><div className="hero-actions"><button onClick={() => onNavigate("roadmap", "R0-01")}>最初の課題から始める</button><button className="secondary" onClick={() => onNavigate("exams")}>過去問ページを見る</button></div></div>
        <div className="home-summary"><strong>{published}</strong><span>物理検証済み課題</span><small>全74課題を順次検証中</small></div>
      </div>

      <section className="how-section"><div className="section-heading"><span>使い方</span><h2>1課題ずつ、再現して、合格を記録する</h2></div><div className="how-grid">
        <article><b>01</b><h3>配置する</h3><p>台の0.25目盛と長方形領域を使い、手玉と的玉を同じ位置へ置きます。</p></article>
        <article><b>02</b><h3>基準を再生する</h3><p>配置図と3D表示で、撞点・強さ・分離方向・停止位置を確認します。</p></article>
        <article><b>03</b><h3>合格まで反復する</h3><p>「何回中何回」を2回の来場で満たしたら、次の課題へ進みます。</p></article>
      </div></section>

      <section className="roadmap-section"><div className="section-heading"><span>テーマ一覧</span><h2>基礎から上級循環までのロードマップ</h2><p>緑は3D検証済み、薄色は配置図を公開して物理条件を再検証中です。</p></div><div className="roadmap-flow">
        {roadmapRows.map((chapters, row) => <div key={chapters[0].id} className={`roadmap-row ${row % 2 ? "reverse" : ""}`}>
          {chapters.map((chapter) => {
            const index = drillData.chapters.findIndex((item) => item.id === chapter.id);
            return <button key={chapter.id} className={chapter.status === "公開中" ? "ready" : "pending"} onClick={() => onNavigate("roadmap", chapter.drills[0])}><small>{String(index + 1).padStart(2, "0")}</small><b>{chapter.number}　{chapter.title}</b><span>{chapter.summary}</span><em>{chapter.status}</em></button>;
          })}
        </div>)}
      </div></section>
    </section>
  );
}

function ExamsPage({ onRoadmap }: { onRoadmap: () => void }) {
  return (
    <section className="exams-page">
      <div className="page-intro"><span>過去問ビューア</span><h1>過去問も同じ課題形式で確認</h1><p>配置図、指定ポケット、撞点、合格条件、3D再生を練習課題と同じ操作で見られるページです。問題データの登録後、年度・級・種目で絞り込めるようにします。</p></div>
      <div className="exam-layout">
        <aside className="exam-filters"><h2>絞り込み</h2><label>区分<select disabled><option>ビリヤード検定</option></select></label><label>級<select disabled><option>すべての級</option></select></label><label>年度<select disabled><option>すべての年度</option></select></label></aside>
        <div className="exam-empty"><div className="exam-table-mini"><i /><i /><i /><i /><i /><i /><span /></div><span>課題データ準備中</span><h2>過去問ビューアの表示枠を用意しました</h2><p>公開資料の出典、年度、級、課題番号を保持し、通常カリキュラムとは別に検索できる構成です。過去問をロードマップの進級条件には混ぜません。</p><button onClick={onRoadmap}>練習ロードマップへ戻る</button></div>
      </div>
    </section>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<PageKey>("home");
  const [selectedId, setSelectedId] = useState(drillData.drills[0].id);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState("すべて");
  const [view, setView] = useState<"overhead" | "player" | "diagram">(drillData.drills[0].interactive ? "overhead" : "diagram");
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [showBaseline, setShowBaseline] = useState(true);
  const [experiment, setExperiment] = useState(() => ({
    x: drillData.drills[0].cue.x,
    y: drillData.drills[0].cue.y,
    speedMps: drillData.drills[0].cue.speedMps,
  }));
  const [experimentalShot, setExperimentalShot] = useState<BrowserShot | null>(null);
  const [calculating, setCalculating] = useState(false);
  const frame = useRef<number | null>(null);
  const previous = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingKeyRef = useRef("");
  const cacheRef = useRef(new Map<string, BrowserShot>());
  const authored = useMemo(() => drillData.drills.find((item) => item.id === selectedId) ?? drillData.drills[0], [selectedId]);
  const baselineShot = useMemo(() => (generatedData as unknown as Record<string, GeneratedShot>)[authored.id], [authored.id]);
  const aimPoint = useMemo(() => getAimPoint(authored), [authored]);
  const isDefault = Math.abs(experiment.x - authored.cue.x) < .001
    && Math.abs(experiment.y - authored.cue.y) < .001
    && Math.abs(experiment.speedMps - authored.cue.speedMps) < .001;
  const activeShot = isDefault || !experimentalShot ? baselineShot : experimentalShot;
  const drill = useMemo(() => ({ ...authored, duration: activeShot.duration, trajectories: activeShot.trajectories }) as unknown as Drill, [activeShot, authored]);

  const selectDrill = (drillId: string) => {
    setPlaying(false);
    setTime(0);
    previous.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    setSelectedId(drillId);
  };

  const navigate = (page: PageKey, drillId?: string) => {
    if (drillId) selectDrill(drillId);
    setScreen(page);
    window.location.hash = page === "home" ? "" : page;
  };

  useEffect(() => {
    const readHash = () => {
      const value = window.location.hash.replace("#", "");
      setScreen(value === "roadmap" || value === "exams" ? value : "home");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL("./physics.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ requestId: number; shot: BrowserShot }>) => {
      if (event.data.requestId !== requestIdRef.current) return;
      cacheRef.current.set(pendingKeyRef.current, event.data.shot);
      while (cacheRef.current.size > 20) cacheRef.current.delete(cacheRef.current.keys().next().value!);
      setExperimentalShot(event.data.shot);
      setCalculating(false);
      setTime(0);
      setPlaying(false);
    };
    workerRef.current = worker;
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!viewerExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setViewerExpanded(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [viewerExpanded]);

  useEffect(() => {
    if (!authored.interactive) { requestIdRef.current += 1; setExperimentalShot(null); setCalculating(false); return; }
    if (isDefault) { requestIdRef.current += 1; setExperimentalShot(null); setCalculating(false); return; }
    const key = `${selectedId}:${experiment.x.toFixed(2)}:${experiment.y.toFixed(2)}:${experiment.speedMps.toFixed(2)}`;
    const cached = cacheRef.current.get(key);
    if (cached) { setExperimentalShot(cached); setCalculating(false); return; }
    setCalculating(true);
    const timeout = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      pendingKeyRef.current = key;
      const request: SimulationRequest = {
        requestId,
        balls: authored.balls.map((ball) => ({ id: ball.id, color: ball.color, x: ball.x, y: ball.y })),
        aimPoint,
        cue: { ...experiment, elevationDeg: authored.cue.elevationDeg },
      };
      workerRef.current?.postMessage(request);
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [aimPoint, authored.balls, authored.cue.elevationDeg, authored.cue.speedMps, authored.cue.x, authored.cue.y, authored.interactive, baselineShot, experiment, isDefault, selectedId]);

  useEffect(() => {
    setExperiment({ x: authored.cue.x, y: authored.cue.y, speedMps: authored.cue.speedMps });
    setExperimentalShot(null);
    setTime(0);
    setPlaying(false);
    setView(authored.interactive ? "overhead" : "diagram");
  }, [authored.cue.speedMps, authored.cue.x, authored.cue.y, selectedId]);
  useEffect(() => {
    if (!playing) { previous.current = null; if (frame.current) cancelAnimationFrame(frame.current); return; }
    const tick = (stamp: number) => {
      if (previous.current !== null) {
        setTime((current) => {
          const next = current + ((stamp - previous.current!) / 1000) * speed;
          if (next >= drill.duration) { setPlaying(false); return drill.duration; }
          return next;
        });
      }
      previous.current = stamp;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [playing, speed, drill.duration]);

  const visibleChapters = drillData.chapters.filter((chapter) => filter === "すべて" || chapter.status === filter);

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("home")}><span className="brand-mark">B</span><span><strong>ビリヤード技能地図</strong><small>検証可能な練習ロードマップ</small></span></button>
        <nav className="global-nav" aria-label="メインメニュー"><button className={screen === "home" ? "active" : ""} onClick={() => navigate("home")}>ホーム</button><button className={screen === "roadmap" ? "active" : ""} onClick={() => navigate("roadmap")}>練習ロードマップ</button><button className={screen === "exams" ? "active" : ""} onClick={() => navigate("exams")}>過去問</button></nav>
        <div className="header-status"><span className="live-dot" /> {drillData.drills.filter((item) => item.interactive).length}課題を3D公開中</div>
      </header>

      {screen === "home" ? <HomeLanding onNavigate={navigate} /> : screen === "exams" ? <ExamsPage onRoadmap={() => navigate("roadmap")} /> : <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>テーマ</span><b>{drillData.chapters.length}</b></div>
          <div className="filters">
            {["すべて", "公開中", "再検証中"].map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}</button>)}
          </div>
          <nav aria-label="課題テーマ">
            {visibleChapters.map((chapter) => (
              <section className="chapter" key={chapter.id}>
                <div className="chapter-title"><span>{chapter.number}</span><div><b>{chapter.title}</b><small>{chapter.summary}</small></div><em>{chapter.status}</em></div>
                <div className="drill-list">
                  {chapter.drills.map((id) => {
                    const item = drillData.drills.find((candidate) => candidate.id === id);
                    if (!item) return null;
                    return <button key={id} className={selectedId === id ? "selected" : ""} onClick={() => selectDrill(id)}><span>{id}</span>{item.title}</button>;
                  })}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <section className="workspace">
          <div className="breadcrumb">{drill.chapterTitle}<span>/</span>{drill.id}</div>
          <div className="title-row">
            <div><div className="eyebrow">{drill.level} · 課題 {drill.id}</div><h1>{drill.title}</h1><p>{drill.purpose}</p></div>
            <div className="pass-badge"><small>進級基準</small><strong>{drill.pass.required}/{drill.pass.attempts}</strong><span>× {drill.pass.sessions}回</span></div>
          </div>

          <div className={`viewer-card ${viewerExpanded ? "expanded" : ""}`}>
            <div className="view-toolbar">
              <div className="view-tabs" role="group" aria-label="視点を選択">
                {authored.interactive && <button className={view === "overhead" ? "active" : ""} onClick={() => setView("overhead")}>3D俯瞰</button>}
                {authored.interactive && <button className={view === "player" ? "active" : ""} onClick={() => setView("player")}>3Dプレイヤー</button>}
                <button className={view === "diagram" ? "active" : ""} onClick={() => setView("diagram")}>配置図</button>
              </div>
              <div className="viewer-actions">
                {!isDefault && <label className="baseline-toggle"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)} /> 基準軌道を重ねる</label>}
                <button className="expand-viewer" onClick={() => setViewerExpanded((current) => !current)}>{viewerExpanded ? "閉じる" : "拡大表示"}</button>
              </div>
            </div>
            <div className="viewer-labels"><span className="cb-key">手玉</span><span className="ob-key">的玉</span><span className="zone-key">合格領域</span><span className="pocket-key">指定ポケット</span><span className="grid-key">配置図は0.25目盛</span></div>
            {authored.interactive && <div className="expanded-cue-point"><CuePoint x={experiment.x} y={experiment.y} /><span>現在の撞点</span></div>}
            {view === "diagram" ? (
              <TableCanvas drill={drill} time={time} baselineTrajectories={baselineShot.trajectories} showBaseline={!isDefault && showBaseline} />
            ) : (
              <Suspense fallback={<div className="three-loading">3D表示を準備しています…</div>}>
                <ThreeTable
                  drill={drill}
                  trajectories={activeShot.trajectories}
                  baselineTrajectories={baselineShot.trajectories}
                  showBaseline={!isDefault && showBaseline}
                  aimPoint={aimPoint}
                  time={time}
                  viewMode={view}
                />
              </Suspense>
            )}
            {authored.interactive && <div className="timeline">
              <button className="play" onClick={() => { if (time >= drill.duration) setTime(0); setPlaying(!playing); }} aria-label={playing ? "一時停止" : "再生"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setTime(0); setPlaying(false); }} aria-label="最初に戻る">↺</button>
              <input type="range" min="0" max={drill.duration} step="0.01" value={time} onChange={(event) => { setTime(Number(event.target.value)); setPlaying(false); }} aria-label="再生位置" />
              <span>{time.toFixed(1)} / {drill.duration.toFixed(1)}秒</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="再生速度"><option value="0.5">0.5倍</option><option value="1">1倍</option><option value="1.5">1.5倍</option></select>
            </div>}
          </div>

          {authored.interactive ? <section className="experiment-panel" aria-labelledby="experiment-title">
            <div className="experiment-heading">
              <div><span>その場で再計算</span><h2 id="experiment-title">撞点と強さを変えて比較</h2></div>
              <div className={`experiment-status ${calculating ? "calculating" : ""}`}><i />{calculating ? "計算中" : isDefault ? "課題の基準設定" : evaluateExperiment(authored, activeShot)}</div>
            </div>
            <div className="experiment-controls">
              <div className="cue-control-wrap">
                <CueController x={experiment.x} y={experiment.y} onChange={(x, y) => setExperiment((current) => ({ ...current, x, y }))} />
              </div>
              <div className="strength-control">
                <label htmlFor="shot-strength">ショットの強さ</label>
                <div><span>弱い</span><input id="shot-strength" type="range" min="0.5" max="3.5" step="0.05" value={experiment.speedMps} onChange={(event) => setExperiment((current) => ({ ...current, speedMps: Number(event.target.value) }))} /><span>強い</span></div>
              </div>
              <div className="experiment-actions">
                <button onClick={() => setExperiment({ x: authored.cue.x, y: authored.cue.y, speedMps: authored.cue.speedMps })}>課題設定に戻す</button>
              </div>
            </div>
          </section> : <section className="verification-notice"><b>配置図と合格基準を先行公開</b><span>この課題は達成可能な撞点・強さを再検証中です。確認が終わるまで3D再生とパラメーター変更は表示しません。</span></section>}

          <div className="instruction-grid">
            <article><span className="card-index">01</span><h2>配置</h2><p>{drill.setup}</p><div className="coordinate-guide">長辺は左から0〜8、短辺は下から0〜4。細線1区画が0.25です。</div><div className="coordinates">{drill.balls.map((ball) => <span key={ball.id}><b>{ball.id}</b>　{ballCoordinate(ball)}</span>)}</div></article>
            <article><span className="card-index">02</span><h2>撞き方</h2><div className="cue-layout"><CuePoint x={drill.cue.x} y={drill.cue.y} /><div><b>{drill.cue.label}</b><p>強さ：{drill.cue.speed}</p><p>キュー角：{drill.cue.elevation}</p></div></div></article>
            <article><span className="card-index">03</span><h2>合格</h2><p>{drill.success}</p>{drill.successZone && <div className="zone-numbers">長辺 {drill.successZone.x1}–{drill.successZone.x2}<br />短辺 {drill.successZone.y1}–{drill.successZone.y2}</div>}</article>
          </div>

          <article className="why-card"><div><span>この課題で覚えること</span><h2>{drill.knowledge.title}</h2></div><p>{drill.knowledge.body}</p></article>
        </section>
      </div>}
    </main>
  );
}
