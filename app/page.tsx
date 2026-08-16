"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import drillData from "./drills.json";
import generatedData from "./generatedTrajectories.json";
import type { BrowserShot, Quaternion, ShotPoint, ShotTrajectory, SimulationRequest } from "./physics";

const ThreeTable = lazy(() => import("./ThreeTable").then((module) => ({ default: module.ThreeTable })));

type Point = ShotPoint;
type Ball = { id: string; label: string; color: string; x: number; y: number };
type Trajectory = ShotTrajectory;
type Drill = (typeof drillData.drills)[number];
type GeneratedShot = BrowserShot;

const TABLE = { width: 8, height: 4, ballRadius: 0.09 };
const POCKETS = [
  { id: "左上", x: 0, y: 0 }, { id: "上中央", x: 4, y: 0 },
  { id: "右上", x: 8, y: 0 }, { id: "左下", x: 0, y: 4 },
  { id: "下中央", x: 4, y: 4 }, { id: "右下", x: 8, y: 4 },
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

    const padX = Math.max(40, rect.width * 0.058);
    const feltX = padX;
    const feltW = rect.width - padX * 2;
    const feltH = feltW / 2;
    const feltY = (rect.height - feltH) / 2;
    const sx = (x: number) => feltX + (x / TABLE.width) * feltW;
    const sy = (y: number) => feltY + (y / TABLE.height) * feltH;
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
      const active = pocket.id === drill.targetPocket;
      context.beginPath();
      context.arc(sx(pocket.x), sy(pocket.y), active ? 15 : 12, 0, Math.PI * 2);
      context.fillStyle = "#111714"; context.fill();
      if (active) {
        context.strokeStyle = "#ffd36b"; context.lineWidth = 4; context.stroke();
      }
    });

    if (drill.successZone) {
      const zone = drill.successZone;
      context.fillStyle = "rgba(255, 211, 107, .17)";
      context.strokeStyle = "#ffd36b";
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      context.fillRect(sx(zone.x1), sy(zone.y1), sx(zone.x2) - sx(zone.x1), sy(zone.y2) - sy(zone.y1));
      context.strokeRect(sx(zone.x1), sy(zone.y1), sx(zone.x2) - sx(zone.x1), sy(zone.y2) - sy(zone.y1));
      context.setLineDash([]);
    }

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
      context.fillStyle = ball.id === "CB" ? "#f1f0e9" : "#e5bb37"; context.fill();
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
          const my = py + worldX * ballR * .72;
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
  }, [baselineTrajectories, drill, showBaseline, time]);

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

function sideLabel(value: number) {
  if (Math.abs(value) < .01) return "中央";
  return `${value > 0 ? "右" : "左"}${Math.abs(value).toFixed(2)}`;
}

function verticalLabel(value: number) {
  if (Math.abs(value) < .01) return "中央";
  return `${value > 0 ? "上" : "下"}${Math.abs(value).toFixed(2)}`;
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

export default function Home() {
  const [selectedId, setSelectedId] = useState(drillData.drills[0].id);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState("すべて");
  const [view, setView] = useState<"diagram" | "player">("diagram");
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
        baselineCue: { x: authored.cue.x, y: authored.cue.y, speedMps: authored.cue.speedMps, elevationDeg: authored.cue.elevationDeg },
        referenceShot: baselineShot,
      };
      workerRef.current?.postMessage(request);
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [aimPoint, authored.balls, authored.cue.elevationDeg, authored.cue.speedMps, authored.cue.x, authored.cue.y, baselineShot, experiment, isDefault, selectedId]);

  useEffect(() => {
    setExperiment({ x: authored.cue.x, y: authored.cue.y, speedMps: authored.cue.speedMps });
    setExperimentalShot(null);
    setTime(0);
    setPlaying(false);
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
        <div className="brand"><span className="brand-mark">B</span><div><strong>ビリヤード技能地図</strong><small>検証可能な練習ロードマップ</small></div></div>
        <div className="header-status"><span className="live-dot" /> 課題データ版 0.1</div>
      </header>

      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-heading"><span>テーマ</span><b>{drillData.chapters.length}</b></div>
          <div className="filters">
            {["すべて", "公開中", "設計中"].map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value}</button>)}
          </div>
          <nav aria-label="課題テーマ">
            {visibleChapters.map((chapter) => (
              <section className="chapter" key={chapter.id}>
                <div className="chapter-title"><span>{chapter.number}</span><div><b>{chapter.title}</b><small>{chapter.summary}</small></div><em>{chapter.status}</em></div>
                <div className="drill-list">
                  {chapter.drills.map((id) => {
                    const item = drillData.drills.find((candidate) => candidate.id === id);
                    if (!item) return null;
                    return <button key={id} className={selectedId === id ? "selected" : ""} onClick={() => setSelectedId(id)}><span>{id}</span>{item.title}</button>;
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

          <div className="viewer-card">
            <div className="view-toolbar">
              <div className="view-tabs" role="group" aria-label="視点を選択">
                <button className={view === "diagram" ? "active" : ""} onClick={() => setView("diagram")}>真上の課題図</button>
                <button className={view === "player" ? "active" : ""} onClick={() => setView("player")}>プレイヤー視点</button>
              </div>
              {!isDefault && <label className="baseline-toggle"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)} /> 基準軌道を重ねる</label>}
            </div>
            <div className="viewer-labels"><span className="cb-key">手玉（赤点が回転）</span><span className="ob-key">的玉（白点が回転）</span><span className="zone-key">合格領域</span><span className="pocket-key">指定ポケット</span><span className="grid-key">0.25目盛</span></div>
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
                />
              </Suspense>
            )}
            <div className="timeline">
              <button className="play" onClick={() => { if (time >= drill.duration) setTime(0); setPlaying(!playing); }} aria-label={playing ? "一時停止" : "再生"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setTime(0); setPlaying(false); }} aria-label="最初に戻る">↺</button>
              <input type="range" min="0" max={drill.duration} step="0.01" value={time} onChange={(event) => { setTime(Number(event.target.value)); setPlaying(false); }} aria-label="再生位置" />
              <span>{time.toFixed(1)} / {drill.duration.toFixed(1)}秒</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="再生速度"><option value="0.5">0.5倍</option><option value="1">1倍</option><option value="1.5">1.5倍</option></select>
            </div>
          </div>

          <section className="experiment-panel" aria-labelledby="experiment-title">
            <div className="experiment-heading">
              <div><span>その場で再計算</span><h2 id="experiment-title">撞点と強さを変えて比較</h2><p>円内の赤点を動かすか、数値スライダーで微調整できます。変更結果はこのページを開いている間だけ保持します。</p></div>
              <div className={`experiment-status ${calculating ? "calculating" : ""}`}><i />{calculating ? "計算中" : isDefault ? "課題の基準設定" : evaluateExperiment(authored, activeShot)}</div>
            </div>
            <div className="experiment-controls">
              <div className="cue-control-wrap">
                <CueController x={experiment.x} y={experiment.y} onChange={(x, y) => setExperiment((current) => ({ ...current, x, y }))} />
                <div className="cue-values"><span>左右 <b>{sideLabel(experiment.x)}</b></span><span>上下 <b>{verticalLabel(experiment.y)}</b></span></div>
              </div>
              <div className="parameter-sliders">
                <label><span>強さ <b>{experiment.speedMps.toFixed(2)}</b></span><input type="range" min="0.5" max="3.5" step="0.05" value={experiment.speedMps} onChange={(event) => setExperiment((current) => ({ ...current, speedMps: Number(event.target.value) }))} /></label>
                <label><span>左右の撞点 <b>{sideLabel(experiment.x)}</b></span><input type="range" min="-0.8" max="0.8" step="0.05" value={experiment.x} onChange={(event) => setExperiment((current) => ({ ...current, x: Number(event.target.value) }))} /></label>
                <label><span>上下の撞点 <b>{verticalLabel(experiment.y)}</b></span><input type="range" min="-0.8" max="0.8" step="0.05" value={experiment.y} onChange={(event) => setExperiment((current) => ({ ...current, y: Number(event.target.value) }))} /></label>
              </div>
              <div className="experiment-actions">
                <button onClick={() => setExperiment({ x: authored.cue.x, y: authored.cue.y, speedMps: authored.cue.speedMps })}>課題設定に戻す</button>
                <small>保存なし・最大20結果だけ一時保持</small>
              </div>
            </div>
          </section>

          <div className="instruction-grid">
            <article><span className="card-index">01</span><h2>配置</h2><p>{drill.setup}</p><div className="coordinate-guide">長辺は左から0〜8、短辺は上から0〜4。細線1区画が0.25です。</div><div className="coordinates">{drill.balls.map((ball) => <span key={ball.id}><b>{ball.id}</b>　長辺 {ball.x.toFixed(2)} ／ 短辺 {ball.y.toFixed(2)}</span>)}</div></article>
            <article><span className="card-index">02</span><h2>撞き方</h2><div className="cue-layout"><CuePoint x={drill.cue.x} y={drill.cue.y} /><div><b>{drill.cue.label}</b><p>強さ：{drill.cue.speed}</p><p>キュー角：{drill.cue.elevation}</p></div></div></article>
            <article><span className="card-index">03</span><h2>合格</h2><p>{drill.success}</p>{drill.successZone && <div className="zone-numbers">長辺 {drill.successZone.x1}–{drill.successZone.x2}<br />短辺 {drill.successZone.y1}–{drill.successZone.y2}</div>}</article>
          </div>

          <article className="why-card"><div><span>この課題で覚えること</span><h2>{drill.knowledge.title}</h2></div><p>{drill.knowledge.body}</p></article>
        </section>
      </div>
    </main>
  );
}
