import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Quaternion, ShotPoint, ShotTrajectory } from "./physics";

type ThreeDrill = {
  id: string;
  balls: Array<{ id: string; color: string; x: number; y: number }>;
  successZone: { x1: number; y1: number; x2: number; y2: number } | null;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  groups: Map<string, THREE.Group>;
};

const DIAMOND_M = 2.54 / 8;
const TABLE_LENGTH = 2.54;
const TABLE_WIDTH = 1.27;
const BALL_RADIUS = 0.028575;

function normalizeQuaternion(q: Quaternion): Quaternion {
  const magnitude = Math.hypot(...q) || 1;
  return q.map((value) => value / magnitude) as Quaternion;
}

function interpolate(points: ShotPoint[], time: number): ShotPoint {
  if (time <= points[0].t) return points[0];
  if (time >= points.at(-1)!.t) return points.at(-1)!;
  const index = points.findIndex((point) => point.t >= time);
  const start = points[index - 1];
  const end = points[index];
  const ratio = (time - start.t) / Math.max(1e-9, end.t - start.t);
  const startQ = start.q;
  let endQ = end.q;
  if (startQ.reduce((sum, value, qIndex) => sum + value * endQ[qIndex], 0) < 0) {
    endQ = endQ.map((value) => -value) as Quaternion;
  }
  return {
    t: time,
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    q: normalizeQuaternion(startQ.map((value, qIndex) => value + (endQ[qIndex] - value) * ratio) as Quaternion),
    visible: start.visible !== false && (end.visible !== false || ratio < .98),
  };
}

function poolQuaternionToThree([w, x, y, z]: Quaternion) {
  const poolRotation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(x, y, z, w));
  const basis = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const converted = basis.clone().multiply(poolRotation).multiply(basis.clone().invert());
  return new THREE.Quaternion().setFromRotationMatrix(converted);
}

function addTrajectory(scene: THREE.Scene, trajectory: ShotTrajectory, color: string, opacity: number) {
  const visiblePoints = trajectory.points.filter((point) => point.visible !== false);
  if (visiblePoints.length < 2) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(visiblePoints.map((point) => (
    new THREE.Vector3(point.x * DIAMOND_M, .006, point.y * DIAMOND_M)
  )));
  const material = new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: .045, gapSize: .028 });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  scene.add(line);
}

function addBallMarkers(group: THREE.Group, cueBall: boolean) {
  const markerGeometry = new THREE.SphereGeometry(.0032, 10, 8);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: cueBall ? 0xc83f35 : 0xfffdf2 });
  const amount = BALL_RADIUS * .94;
  const positions = [
    [amount, 0, 0], [-amount, 0, 0], [0, amount, 0], [0, -amount, 0], [0, 0, amount], [0, 0, -amount],
  ];
  positions.forEach(([x, y, z]) => {
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.set(x, y, z);
    group.add(marker);
  });
}

export function ThreeTable({
  drill,
  trajectories,
  baselineTrajectories,
  showBaseline,
  aimPoint,
  time,
}: {
  drill: ThreeDrill;
  trajectories: ShotTrajectory[];
  baselineTrajectories: ShotTrajectory[];
  showBaseline: boolean;
  aimPoint: { x: number; y: number };
  time: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SceneState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10261f);
    scene.fog = new THREE.Fog(0x10261f, 2.1, 4.2);
    const camera = new THREE.PerspectiveCamera(47, 2, .01, 8);

    scene.add(new THREE.HemisphereLight(0xfff7e5, 0x183d32, 2.25));
    const directional = new THREE.DirectionalLight(0xfff5dc, 2.2);
    directional.position.set(.3, 1.7, 1.2);
    scene.add(directional);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_LENGTH, TABLE_WIDTH),
      new THREE.MeshStandardMaterial({ color: 0x126a54, roughness: .93, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(TABLE_LENGTH / 2, 0, TABLE_WIDTH / 2);
    scene.add(floor);

    const gridMaterial = new THREE.LineBasicMaterial({ color: 0xb8d8cc, transparent: true, opacity: .2 });
    const gridPoints: THREE.Vector3[] = [];
    for (let x = .25; x < 8; x += .25) {
      gridPoints.push(new THREE.Vector3(x * DIAMOND_M, .002, 0), new THREE.Vector3(x * DIAMOND_M, .002, TABLE_WIDTH));
    }
    for (let y = .25; y < 4; y += .25) {
      gridPoints.push(new THREE.Vector3(0, .002, y * DIAMOND_M), new THREE.Vector3(TABLE_LENGTH, .002, y * DIAMOND_M));
    }
    scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), gridMaterial));

    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x71452d, roughness: .7 });
    const railHeight = .055;
    const railWidth = .085;
    const rails = [
      { size: [TABLE_LENGTH + railWidth * 2, railHeight, railWidth], position: [TABLE_LENGTH / 2, railHeight / 2, -railWidth / 2] },
      { size: [TABLE_LENGTH + railWidth * 2, railHeight, railWidth], position: [TABLE_LENGTH / 2, railHeight / 2, TABLE_WIDTH + railWidth / 2] },
      { size: [railWidth, railHeight, TABLE_WIDTH], position: [-railWidth / 2, railHeight / 2, TABLE_WIDTH / 2] },
      { size: [railWidth, railHeight, TABLE_WIDTH], position: [TABLE_LENGTH + railWidth / 2, railHeight / 2, TABLE_WIDTH / 2] },
    ];
    rails.forEach((rail) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...rail.size as [number, number, number]), railMaterial);
      mesh.position.set(...rail.position as [number, number, number]);
      scene.add(mesh);
    });

    const pocketGeometry = new THREE.CylinderGeometry(.065, .065, .008, 24);
    const pocketMaterial = new THREE.MeshStandardMaterial({ color: 0x070b09, roughness: 1 });
    [[0, 0], [TABLE_LENGTH / 2, 0], [TABLE_LENGTH, 0], [0, TABLE_WIDTH], [TABLE_LENGTH / 2, TABLE_WIDTH], [TABLE_LENGTH, TABLE_WIDTH]].forEach(([x, z]) => {
      const pocket = new THREE.Mesh(pocketGeometry, pocketMaterial);
      pocket.position.set(x, .007, z);
      scene.add(pocket);
    });

    if (drill.successZone) {
      const zone = drill.successZone;
      const width = (zone.x2 - zone.x1) * DIAMOND_M;
      const depth = (zone.y2 - zone.y1) * DIAMOND_M;
      const zoneMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: .25, side: THREE.DoubleSide }),
      );
      zoneMesh.rotation.x = -Math.PI / 2;
      zoneMesh.position.set((zone.x1 + zone.x2) * DIAMOND_M / 2, .004, (zone.y1 + zone.y2) * DIAMOND_M / 2);
      scene.add(zoneMesh);
    }

    if (showBaseline) baselineTrajectories.forEach((trajectory) => addTrajectory(scene, trajectory, "#d7ddd9", .25));
    trajectories.forEach((trajectory) => addTrajectory(scene, trajectory, trajectory.ballId === "CB" ? "#fff4de" : "#ffd34f", .78));

    const groups = new Map<string, THREE.Group>();
    drill.balls.forEach((ball) => {
      const group = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: ball.id === "CB" ? 0xf4f2e9 : 0xe5b92f,
        roughness: .32,
        metalness: 0,
      });
      group.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 28, 20), material));
      addBallMarkers(group, ball.id === "CB");
      scene.add(group);
      groups.set(ball.id, group);
    });

    const cb = drill.balls.find((ball) => ball.id === "CB") ?? drill.balls[0];
    const cbPosition = new THREE.Vector3(cb.x * DIAMOND_M, BALL_RADIUS, cb.y * DIAMOND_M);
    const aimDirection = new THREE.Vector3(
      (aimPoint.x - cb.x) * DIAMOND_M,
      0,
      (aimPoint.y - cb.y) * DIAMOND_M,
    ).normalize();
    camera.position.copy(cbPosition).addScaledVector(aimDirection, -.62).add(new THREE.Vector3(0, .29, 0));
    camera.lookAt(cbPosition.clone().addScaledVector(aimDirection, .72).add(new THREE.Vector3(0, -.008, 0)));

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    stateRef.current = { renderer, scene, camera, groups };
    resize();
    return () => {
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      stateRef.current = null;
    };
  }, [aimPoint.x, aimPoint.y, baselineTrajectories, drill, showBaseline, trajectories]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    drill.balls.forEach((ball) => {
      const group = state.groups.get(ball.id);
      const trajectory = trajectories.find((candidate) => candidate.ballId === ball.id);
      if (!group || !trajectory) return;
      const point = interpolate(trajectory.points, time);
      group.visible = point.visible !== false;
      group.position.set(point.x * DIAMOND_M, BALL_RADIUS, point.y * DIAMOND_M);
      group.quaternion.copy(poolQuaternionToThree(point.q));
    });
    state.renderer.render(state.scene, state.camera);
  }, [drill.balls, time, trajectories]);

  return (
    <div className="three-stage">
      <canvas ref={canvasRef} className="three-canvas" aria-label={`${drill.id}のプレイヤー視点3Dシミュレーション`} />
      <div className="player-view-caption"><span />手玉後方から見たプレイヤー視点</div>
    </div>
  );
}

