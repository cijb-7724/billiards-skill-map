"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import drillData from "./drills.json";
import generatedData from "./generatedTrajectories.json";

type Point = { t: number; x: number; y: number; visible?: boolean };
type Ball = { id: string; label: string; color: string; x: number; y: number };
type Trajectory = { ballId: string; color: string; points: Point[] };
type Drill = (typeof drillData.drills)[number];
type GeneratedShot = { duration: number; trajectories: Trajectory[]; engine: string };

const TABLE = { width: 8, height: 4, ballRadius: 0.09 };
const POCKETS = [
  { id: "左上", x: 0, y: 0 }, { id: "上中央", x: 4, y: 0 },
  { id: "右上", x: 8, y: 0 }, { id: "左下", x: 0, y: 4 },
  { id: "下中央", x: 4, y: 4 }, { id: "右下", x: 8, y: 4 },
];

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
    visible: end.visible !== false,
  };
}

function TableCanvas({ drill, time }: { drill: Drill; time: number }) {
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

    const pad = Math.max(24, rect.width * 0.052);
    const feltX = pad;
    const feltY = pad;
    const feltW = rect.width - pad * 2;
    const feltH = rect.height - pad * 2;
    const sx = (x: number) => feltX + (x / TABLE.width) * feltW;
    const sy = (y: number) => feltY + (y / TABLE.height) * feltH;
    const ballR = Math.max(7, (TABLE.ballRadius / TABLE.height) * feltH);

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

    (drill.balls as Ball[]).forEach((ball) => {
      const trajectory = (drill.trajectories as Trajectory[]).find((item) => item.ballId === ball.id);
      const position: { x: number; y: number; visible?: boolean } = trajectory ? interpolate(trajectory.points, time) : ball;
      if (position.visible === false) return;
      const px = sx(position.x); const py = sy(position.y);
      const shade = context.createRadialGradient(px - ballR * .35, py - ballR * .45, 1, px, py, ballR);
      shade.addColorStop(0, "#fff"); shade.addColorStop(.18, ball.color); shade.addColorStop(1, "#18241f");
      context.beginPath(); context.arc(px, py, ballR, 0, Math.PI * 2);
      context.fillStyle = shade; context.fill();
      context.strokeStyle = "rgba(0,0,0,.4)"; context.lineWidth = 1; context.stroke();
      context.fillStyle = ball.id === "CB" ? "#17231e" : "#fff";
      context.font = `700 ${Math.max(9, ballR * .72)}px system-ui`;
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(ball.label, px, py + .4);
    });
  }, [drill, time]);

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

export default function Home() {
  const [selectedId, setSelectedId] = useState(drillData.drills[0].id);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [filter, setFilter] = useState("すべて");
  const frame = useRef<number | null>(null);
  const previous = useRef<number | null>(null);
  const drill = useMemo(() => {
    const authored = drillData.drills.find((item) => item.id === selectedId) ?? drillData.drills[0];
    const generated = (generatedData as Record<string, GeneratedShot>)[authored.id];
    return generated ? { ...authored, duration: generated.duration, trajectories: generated.trajectories } : authored;
  }, [selectedId]);

  useEffect(() => { setTime(0); setPlaying(false); }, [selectedId]);
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
            <div><div className="eyebrow">{drill.level} · {drill.validation.geometry}</div><h1>{drill.title}</h1><p>{drill.purpose}</p></div>
            <div className="pass-badge"><small>進級基準</small><strong>{drill.pass.required}/{drill.pass.attempts}</strong><span>× {drill.pass.sessions}回</span></div>
          </div>

          <div className="viewer-card">
            <div className="viewer-labels"><span className="cb-key">手玉</span><span className="ob-key">的玉</span><span className="zone-key">合格領域</span><span className="pocket-key">指定ポケット</span></div>
            <TableCanvas drill={drill} time={time} />
            <div className="timeline">
              <button className="play" onClick={() => { if (time >= drill.duration) setTime(0); setPlaying(!playing); }} aria-label={playing ? "一時停止" : "再生"}>{playing ? "Ⅱ" : "▶"}</button>
              <button onClick={() => { setTime(0); setPlaying(false); }} aria-label="最初に戻る">↺</button>
              <input type="range" min="0" max={drill.duration} step="0.01" value={time} onChange={(event) => { setTime(Number(event.target.value)); setPlaying(false); }} aria-label="再生位置" />
              <span>{time.toFixed(1)} / {drill.duration.toFixed(1)}秒</span>
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="再生速度"><option value="0.5">0.5倍</option><option value="1">1倍</option><option value="1.5">1.5倍</option></select>
            </div>
          </div>

          <div className="instruction-grid">
            <article><span className="card-index">01</span><h2>配置</h2><p>{drill.setup}</p><div className="coordinates">{drill.balls.map((ball) => <span key={ball.id}><b>{ball.id}</b>（{ball.x.toFixed(2)}, {ball.y.toFixed(2)}）</span>)}</div></article>
            <article><span className="card-index">02</span><h2>撞き方</h2><div className="cue-layout"><CuePoint x={drill.cue.x} y={drill.cue.y} /><div><b>{drill.cue.label}</b><p>強さ：{drill.cue.speed}（計算値 {drill.cue.speedMps.toFixed(2)} m/秒）</p><p>キュー角：{drill.cue.elevation}</p></div></div></article>
            <article><span className="card-index">03</span><h2>合格</h2><p>{drill.success}</p>{drill.successZone && <div className="zone-numbers">横 {drill.successZone.x1}–{drill.successZone.x2}<br />縦 {drill.successZone.y1}–{drill.successZone.y2}</div>}</article>
          </div>

          <div className="evidence-row">
            <div><span>幾何</span><b>{drill.validation.geometry}</b><small>{drill.validation.geometryNote}</small></div>
            <div><span>物理</span><b>{drill.validation.physics}</b><small>{drill.validation.physicsNote}</small></div>
            <div><span>出典区分</span><b>{drill.validation.provenance}</b><small>{drill.validation.source}</small></div>
          </div>

          <article className="why-card"><div><span>この課題で覚えること</span><h2>{drill.knowledge.title}</h2></div><p>{drill.knowledge.body}</p></article>
        </section>
      </div>
    </main>
  );
}
