import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Quaternion, ShotPoint, ShotTrajectory } from "./physics";

type ThreeDrill = {
  id: string;
  targetPocket?: string;
  targetPockets: string[];
  balls: Array<{ id: string; label?: string; color: string; x: number; y: number }>;
  successZone: { x1: number; y1: number; x2: number; y2: number } | null;
  zones: Array<{ x1: number; y1: number; x2: number; y2: number }>;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  groups: Map<string, THREE.Group>;
  cue: THREE.Group;
};

const DIAMOND_M = 2.54 / 8;
const TABLE_LENGTH = 2.54;
const TABLE_WIDTH = 1.27;
const BALL_RADIUS = 0.028575;
const POCKET_DROP_SECONDS = .55;
const UP = new THREE.Vector3(0, 1, 0);
const POCKETS = [
  { id: "左上", x: 0, z: 0 }, { id: "上中央", x: TABLE_LENGTH / 2, z: 0 },
  { id: "右上", x: TABLE_LENGTH, z: 0 }, { id: "左下", x: 0, z: TABLE_WIDTH },
  { id: "下中央", x: TABLE_LENGTH / 2, z: TABLE_WIDTH }, { id: "右下", x: TABLE_LENGTH, z: TABLE_WIDTH },
];

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
    -1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const converted = basis.clone().multiply(poolRotation).multiply(basis.clone().invert());
  return new THREE.Quaternion().setFromRotationMatrix(converted);
}

function addTrajectory(scene: THREE.Scene, trajectory: ShotTrajectory, color: string, opacity: number) {
  const visiblePoints = trajectory.points.filter((point) => point.visible !== false);
  if (visiblePoints.length < 2) return;
  const sampled = visiblePoints.filter((point, index, points) => {
    if (index === 0 || index === points.length - 1) return true;
    if (index % 3 !== 0) return false;
    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-5;
  }).filter((point, index, points) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-5;
  });
  if (sampled.length < 2) return;
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let index = 1; index < sampled.length; index++) {
    const previous = sampled[index - 1];
    const current = sampled[index];
    path.add(new THREE.LineCurve3(
      new THREE.Vector3(previous.x * DIAMOND_M, .012, TABLE_WIDTH - previous.y * DIAMOND_M),
      new THREE.Vector3(current.x * DIAMOND_M, .012, TABLE_WIDTH - current.y * DIAMOND_M),
    ));
  }
  const geometry = new THREE.TubeGeometry(path, Math.max(8, sampled.length * 2), opacity < .4 ? .0018 : .0034, 5, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  scene.add(new THREE.Mesh(geometry, material));
}

function makeWoodMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, "#744225");
  gradient.addColorStop(.42, "#4c2918");
  gradient.addColorStop(.72, "#351b11");
  gradient.addColorStop(1, "#21110b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 128);
  for (let line = 0; line < 34; line++) {
    const y = 4 + line * 3.7;
    context.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const offset = Math.sin(x * .031 + line * 1.73) * (1.2 + (line % 4) * .35);
      if (x === 0) context.moveTo(x, y + offset);
      else context.lineTo(x, y + offset);
    }
    context.strokeStyle = line % 3 === 0 ? "rgba(18,7,3,.42)" : "rgba(224,157,92,.1)";
    context.lineWidth = line % 5 === 0 ? 1.7 : .75;
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 1);
  return new THREE.MeshPhysicalMaterial({ map: texture, color: 0xffffff, roughness: .3, clearcoat: .5, clearcoatRoughness: .2 });
}

function makeClothMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#168967";
  context.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 2) {
    context.strokeStyle = y % 4 === 0 ? "rgba(255,255,255,.028)" : "rgba(0,28,19,.03)";
    context.beginPath();
    context.moveTo(0, y + .5);
    context.lineTo(128, y + .5);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 5);
  return new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: .96 });
}

function makePocketClothMaterial() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, "#010302");
  gradient.addColorStop(.42, "#020b07");
  gradient.addColorStop(.72, "#07523d");
  gradient.addColorStop(1, "#168967");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: .98, side: THREE.DoubleSide });
}

function makeDiscMaterial(label: string, foreground: string, background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, 128, 128);
  context.beginPath();
  context.arc(64, 64, 61, 0, Math.PI * 2);
  context.fillStyle = background;
  context.fill();
  if (label) {
    context.fillStyle = foreground;
    context.font = "700 72px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 64, 68);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: .24, polygonOffset: true, polygonOffsetFactor: -2 });
}

function addSurfaceDisc(group: THREE.Group, normal: THREE.Vector3, radius: number, material: THREE.Material) {
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), material);
  disc.position.copy(normal).multiplyScalar(BALL_RADIUS * 1.008);
  disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  disc.castShadow = true;
  group.add(disc);
}

function createBall(ball: ThreeDrill["balls"][number]) {
  const group = new THREE.Group();
  const cueBall = ball.id === "CB";
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
    new THREE.MeshPhysicalMaterial({
      color: cueBall ? 0xf7f5ed : ball.color,
      roughness: .2,
      metalness: 0,
      clearcoat: .7,
      clearcoatRoughness: .16,
    }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  if (cueBall) {
    const redSpot = makeDiscMaterial("", "#fff", "#c83d34");
    const spotRadius = BALL_RADIUS * .14;
    [
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ].forEach((normal) => addSurfaceDisc(group, normal, spotRadius, redSpot));
  } else {
    const numberDisc = makeDiscMaterial(ball.label || "1", "#1c211e", "#fffdf4");
    addSurfaceDisc(group, new THREE.Vector3(0, 1, 0), BALL_RADIUS * .43, numberDisc);
    addSurfaceDisc(group, new THREE.Vector3(0, -1, 0), BALL_RADIUS * .43, numberDisc);
  }
  return group;
}

function addTable(scene: THREE.Scene, drill: ThreeDrill) {
  const wood = makeWoodMaterial();
  const darkWood = new THREE.MeshPhysicalMaterial({ color: 0x24140c, roughness: .46, clearcoat: .25, clearcoatRoughness: .34 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x0b7256, roughness: .76 });
  const cloth = makeClothMaterial();
  const pocketClothSurface = makePocketClothMaterial();
  const trim = new THREE.MeshStandardMaterial({ color: 0xa9814c, roughness: .32, metalness: .48 });
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x100b08, roughness: .92, clearcoat: .06 });

  const apron = new THREE.Mesh(new RoundedBoxGeometry(TABLE_LENGTH + .4, .19, TABLE_WIDTH + .4, 4, .045), darkWood);
  apron.position.set(TABLE_LENGTH / 2, -.108, TABLE_WIDTH / 2);
  apron.castShadow = true;
  apron.receiveShadow = true;
  scene.add(apron);

  const crownParts = [
    { size: [TABLE_LENGTH + .34, .085, .105] as [number, number, number], position: [TABLE_LENGTH / 2, .018, -.135] as [number, number, number] },
    { size: [TABLE_LENGTH + .34, .085, .105] as [number, number, number], position: [TABLE_LENGTH / 2, .018, TABLE_WIDTH + .135] as [number, number, number] },
    { size: [.105, .085, TABLE_WIDTH + .34] as [number, number, number], position: [-.135, .018, TABLE_WIDTH / 2] as [number, number, number] },
    { size: [.105, .085, TABLE_WIDTH + .34] as [number, number, number], position: [TABLE_LENGTH + .135, .018, TABLE_WIDTH / 2] as [number, number, number] },
  ];
  crownParts.forEach((part) => {
    const crown = new THREE.Mesh(new RoundedBoxGeometry(...part.size, 4, .025), wood);
    crown.position.set(...part.position);
    crown.castShadow = true;
    crown.receiveShadow = true;
    scene.add(crown);
  });

  const revealWidth = .018;
  [
    { size: [TABLE_LENGTH + .29, .018, revealWidth] as [number, number, number], position: [TABLE_LENGTH / 2, -.008, -.136] as [number, number, number] },
    { size: [TABLE_LENGTH + .29, .018, revealWidth] as [number, number, number], position: [TABLE_LENGTH / 2, -.008, TABLE_WIDTH + .136] as [number, number, number] },
    { size: [revealWidth, .018, TABLE_WIDTH + .29] as [number, number, number], position: [-.136, -.008, TABLE_WIDTH / 2] as [number, number, number] },
    { size: [revealWidth, .018, TABLE_WIDTH + .29] as [number, number, number], position: [TABLE_LENGTH + .136, -.008, TABLE_WIDTH / 2] as [number, number, number] },
  ].forEach((part) => {
    const reveal = new THREE.Mesh(new THREE.BoxGeometry(...part.size), trim);
    reveal.position.set(...part.position);
    reveal.castShadow = true;
    scene.add(reveal);
  });

  const bed = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_LENGTH, TABLE_WIDTH), cloth);
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(TABLE_LENGTH / 2, .001, TABLE_WIDTH / 2);
  bed.receiveShadow = true;
  scene.add(bed);

  const railHeight = .074;
  const railWidth = .105;
  const cornerGap = .115;
  const sideGap = .105;
  const longRailSpans = [[cornerGap, TABLE_LENGTH / 2 - sideGap], [TABLE_LENGTH / 2 + sideGap, TABLE_LENGTH - cornerGap]];
  const shortRailSpans = [[cornerGap, TABLE_WIDTH - cornerGap]];
  const rails: Array<{ size: [number, number, number]; position: [number, number, number] }> = [];
  longRailSpans.forEach(([start, end]) => {
    [-railWidth / 2, TABLE_WIDTH + railWidth / 2].forEach((z) => rails.push({
      size: [end - start, railHeight, railWidth], position: [(start + end) / 2, railHeight / 2, z],
    }));
  });
  shortRailSpans.forEach(([start, end]) => {
    [-railWidth / 2, TABLE_LENGTH + railWidth / 2].forEach((x) => rails.push({
      size: [railWidth, railHeight, end - start], position: [x, railHeight / 2, (start + end) / 2],
    }));
  });
  rails.forEach((rail) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...rail.size, 4, .018), wood);
    mesh.position.set(...rail.position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const top = new THREE.Mesh(
      new RoundedBoxGeometry(rail.size[0] * .985, .014, rail.size[2] * .9, 3, .006),
      new THREE.MeshPhysicalMaterial({ color: 0x5d321e, roughness: .25, clearcoat: .62, clearcoatRoughness: .18 }),
    );
    top.position.set(rail.position[0], railHeight + .006, rail.position[2]);
    top.castShadow = true;
    scene.add(top);
  });

  const trimHeight = .008;
  longRailSpans.forEach(([start, end]) => {
    [-railWidth + .012, TABLE_WIDTH + railWidth - .012].forEach((z) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(end - start, trimHeight, .009), trim);
      band.position.set((start + end) / 2, railHeight + .002, z);
      scene.add(band);
    });
  });
  shortRailSpans.forEach(([start, end]) => {
    [-railWidth + .012, TABLE_LENGTH + railWidth - .012].forEach((x) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(.009, trimHeight, end - start), trim);
      band.position.set(x, railHeight + .002, (start + end) / 2);
      scene.add(band);
    });
  });

  const cushionHeight = .042;
  const cushionWidth = .035;
  const cushionParts: Array<{ size: [number, number, number]; position: [number, number, number] }> = [];
  longRailSpans.forEach(([start, end]) => {
    [cushionWidth / 2, TABLE_WIDTH - cushionWidth / 2].forEach((z) => cushionParts.push({
      size: [end - start, cushionHeight, cushionWidth], position: [(start + end) / 2, cushionHeight / 2, z],
    }));
  });
  shortRailSpans.forEach(([start, end]) => {
    [cushionWidth / 2, TABLE_LENGTH - cushionWidth / 2].forEach((x) => cushionParts.push({
      size: [cushionWidth, cushionHeight, end - start], position: [x, cushionHeight / 2, (start + end) / 2],
    }));
  });
  cushionParts.forEach((part) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.size), cushion);
    mesh.position.set(...part.position);
    mesh.castShadow = true;
    scene.add(mesh);
  });

  const gridMaterial = new THREE.LineBasicMaterial({ color: 0xe1f4ec, transparent: true, opacity: .27, depthWrite: false });
  const gridPoints: THREE.Vector3[] = [];
  for (let x = 1; x < 8; x += 1) {
    gridPoints.push(new THREE.Vector3(x * DIAMOND_M, .006, 0), new THREE.Vector3(x * DIAMOND_M, .006, TABLE_WIDTH));
  }
  for (let y = 1; y < 4; y += 1) {
    gridPoints.push(new THREE.Vector3(0, .006, y * DIAMOND_M), new THREE.Vector3(TABLE_LENGTH, .006, y * DIAMOND_M));
  }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), gridMaterial));

  const diamondMaterial = new THREE.MeshStandardMaterial({ color: 0xf3dfb0, roughness: .35 });
  const diamondGeometry = new THREE.OctahedronGeometry(.012, 0);
  for (let x = 1; x < 8; x++) {
    if (x === 4) continue;
    [-.078, TABLE_WIDTH + .078].forEach((z) => {
      const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
      diamond.scale.set(1.25, .22, .8);
      diamond.position.set(x * DIAMOND_M, railHeight + .002, z);
      scene.add(diamond);
    });
  }
  for (let y = 1; y < 4; y++) {
    [-.078, TABLE_LENGTH + .078].forEach((x) => {
      const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
      diamond.scale.set(.8, .22, 1.25);
      diamond.position.set(x, railHeight + .002, y * DIAMOND_M);
      scene.add(diamond);
    });
  }

  const pocketMaterial = new THREE.MeshStandardMaterial({ color: 0x010201, roughness: 1 });
  const pocketCloth = new THREE.MeshStandardMaterial({ color: 0x07533e, roughness: .96, side: THREE.DoubleSide });
  POCKETS.forEach((pocketPosition) => {
    const isSide = pocketPosition.x === TABLE_LENGTH / 2;
    const pocketRadius = isSide ? .067 : .075;
    const clothDrop = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(pocketRadius * 1.04, .012),
      new THREE.Vector2(pocketRadius * .88, -.008),
      new THREE.Vector2(pocketRadius * .64, -.052),
    ], 48), pocketCloth);
    clothDrop.position.set(pocketPosition.x, 0, pocketPosition.z);
    clothDrop.receiveShadow = true;
    scene.add(clothDrop);
    const pocket = new THREE.Mesh(new THREE.CylinderGeometry(pocketRadius * .66, pocketRadius * .5, .09, 48, 1, true), leather);
    pocket.position.set(pocketPosition.x, -.085, pocketPosition.z);
    scene.add(pocket);
    const pocketMouth = new THREE.Mesh(new THREE.CircleGeometry(pocketRadius * 1.05, 48), pocketClothSurface);
    pocketMouth.rotation.x = -Math.PI / 2;
    pocketMouth.position.set(pocketPosition.x, .008, pocketPosition.z);
    scene.add(pocketMouth);
    const pocketBottom = new THREE.Mesh(new THREE.CircleGeometry(pocketRadius * .53, 48), pocketMaterial);
    pocketBottom.rotation.x = -Math.PI / 2;
    pocketBottom.position.set(pocketPosition.x, -.1, pocketPosition.z);
    scene.add(pocketBottom);
    if (drill.targetPockets.includes(pocketPosition.id)) {
      const target = new THREE.Mesh(
        new THREE.RingGeometry(pocketRadius * 1.14, pocketRadius * 1.31, 48),
        new THREE.MeshBasicMaterial({ color: 0xffd468, transparent: true, opacity: .92 }),
      );
      target.rotation.x = Math.PI / 2;
      target.position.set(pocketPosition.x, .016, pocketPosition.z);
      scene.add(target);
    }
  });
}

function createCue() {
  const cue = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(.006, .011, .72, 18),
    new THREE.MeshStandardMaterial({ color: 0xd8b174, roughness: .36 }),
  );
  shaft.position.y = -.36;
  shaft.castShadow = true;
  cue.add(shaft);
  const butt = new THREE.Mesh(
    new THREE.CylinderGeometry(.011, .015, .34, 18),
    new THREE.MeshStandardMaterial({ color: 0x2e241d, roughness: .32, metalness: .05 }),
  );
  butt.position.y = -.89;
  butt.castShadow = true;
  cue.add(butt);
  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(.0063, .0063, .014, 18),
    new THREE.MeshStandardMaterial({ color: 0x3d7890, roughness: .72 }),
  );
  tip.position.y = .007;
  cue.add(tip);
  return cue;
}

function addSuccessZone(scene: THREE.Scene, zone: NonNullable<ThreeDrill["successZone"]>) {
  const width = (zone.x2 - zone.x1) * DIAMOND_M;
  const depth = (zone.y2 - zone.y1) * DIAMOND_M;
  const centerX = (zone.x1 + zone.x2) * DIAMOND_M / 2;
  const centerZ = TABLE_WIDTH - (zone.y1 + zone.y2) * DIAMOND_M / 2;
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: .2, side: THREE.DoubleSide }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(centerX, .007, centerZ);
  scene.add(fill);
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-width / 2, 0, -depth / 2), new THREE.Vector3(width / 2, 0, -depth / 2),
      new THREE.Vector3(width / 2, 0, depth / 2), new THREE.Vector3(-width / 2, 0, depth / 2),
    ]),
    new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: .9 }),
  );
  outline.position.set(centerX, .011, centerZ);
  scene.add(outline);
}

export function ThreeTable({
  drill,
  trajectories,
  baselineTrajectories,
  showBaseline,
  aimPoint,
  time,
  viewMode,
}: {
  drill: ThreeDrill;
  trajectories: ShotTrajectory[];
  baselineTrajectories: ShotTrajectory[];
  showBaseline: boolean;
  aimPoint: { x: number; y: number };
  time: number;
  viewMode: "overhead" | "player";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SceneState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.46;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x30483f);
    const camera = viewMode === "player"
      ? new THREE.PerspectiveCamera(52, 2, .01, 12)
      : new THREE.OrthographicCamera(-1.5, 1.5, .8, -.8, .01, 12);

    scene.add(new THREE.HemisphereLight(0xfff7e9, 0x37564b, 2.45));
    const keyLight = new THREE.DirectionalLight(0xfff3db, 4.2);
    keyLight.position.set(.35, 2.7, 1.65);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -2;
    keyLight.shadow.camera.right = 2;
    keyLight.shadow.camera.top = 2;
    keyLight.shadow.camera.bottom = -2;
    scene.add(keyLight);
    const fillLight = new THREE.PointLight(0x9fd5ff, 1.15, 5);
    fillLight.position.set(2.7, 1.2, -.5);
    scene.add(fillLight);

    const room = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 6),
      new THREE.MeshStandardMaterial({ color: 0x22332e, roughness: 1 }),
    );
    room.rotation.x = -Math.PI / 2;
    room.position.set(TABLE_LENGTH / 2, -.108, TABLE_WIDTH / 2);
    room.receiveShadow = true;
    scene.add(room);

    addTable(scene, drill);
    drill.zones.forEach((zone) => addSuccessZone(scene, zone));
    if (showBaseline) baselineTrajectories.forEach((trajectory) => addTrajectory(scene, trajectory, "#d7ddd9", .28));
    trajectories.forEach((trajectory) => addTrajectory(scene, trajectory, trajectory.ballId === "CB" ? "#ffffff" : "#ffe066", .92));

    const groups = new Map<string, THREE.Group>();
    drill.balls.forEach((ball) => {
      const group = createBall(ball);
      group.position.set(ball.x * DIAMOND_M, BALL_RADIUS, TABLE_WIDTH - ball.y * DIAMOND_M);
      scene.add(group);
      groups.set(ball.id, group);
    });

    const cb = drill.balls.find((ball) => ball.id === "CB") ?? drill.balls[0];
    const cbPosition = new THREE.Vector3(cb.x * DIAMOND_M, BALL_RADIUS, TABLE_WIDTH - cb.y * DIAMOND_M);
    const aimDirection = new THREE.Vector3(
      (aimPoint.x - cb.x) * DIAMOND_M,
      0,
      -(aimPoint.y - cb.y) * DIAMOND_M,
    ).normalize();

    const aimingLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        cbPosition.clone().addScaledVector(aimDirection, BALL_RADIUS * 1.15).setY(.013),
        new THREE.Vector3(aimPoint.x * DIAMOND_M, .013, TABLE_WIDTH - aimPoint.y * DIAMOND_M),
      ]),
      new THREE.LineBasicMaterial({ color: 0xfff4d3, transparent: true, opacity: .6 }),
    );
    scene.add(aimingLine);

    const ghostBall = new THREE.Mesh(
      new THREE.TorusGeometry(BALL_RADIUS, .0022, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xfff4d3, transparent: true, opacity: .72 }),
    );
    ghostBall.rotation.x = Math.PI / 2;
    ghostBall.position.set(aimPoint.x * DIAMOND_M, .015, TABLE_WIDTH - aimPoint.y * DIAMOND_M);
    scene.add(ghostBall);

    const cue = createCue();
    cue.position.copy(cbPosition).addScaledVector(aimDirection, -(BALL_RADIUS + .012));
    cue.quaternion.setFromUnitVectors(UP, aimDirection);
    scene.add(cue);

    if (viewMode === "player") {
      camera.position.copy(cbPosition).addScaledVector(aimDirection, -.9).add(new THREE.Vector3(0, .44, 0));
      camera.lookAt(cbPosition.clone().addScaledVector(aimDirection, .94).add(new THREE.Vector3(0, -.015, 0)));
    } else {
      camera.up.set(0, 0, -1);
      camera.position.set(TABLE_LENGTH / 2, 3.05, TABLE_WIDTH / 2);
      camera.lookAt(TABLE_LENGTH / 2, 0, TABLE_WIDTH / 2);
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      const aspect = rect.width / Math.max(1, rect.height);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = aspect;
      } else {
        const framedWidth = TABLE_LENGTH + .48;
        const framedHeight = TABLE_WIDTH + .48;
        let halfWidth = framedWidth / 2;
        let halfHeight = framedHeight / 2;
        if (aspect > framedWidth / framedHeight) halfWidth = halfHeight * aspect;
        else halfHeight = halfWidth / Math.max(.1, aspect);
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
      }
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    stateRef.current = { renderer, scene, camera, groups, cue };
    resize();
    return () => {
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      stateRef.current = null;
    };
  }, [aimPoint.x, aimPoint.y, baselineTrajectories, drill, showBaseline, trajectories, viewMode]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    drill.balls.forEach((ball) => {
      const group = state.groups.get(ball.id);
      const trajectory = trajectories.find((candidate) => candidate.ballId === ball.id);
      if (!group || !trajectory) return;
      const point = interpolate(trajectory.points, time);
      const pocketPoint = trajectory.points.find((candidate) => candidate.visible === false);
      group.visible = point.visible !== false;
      group.position.set(point.x * DIAMOND_M, BALL_RADIUS, TABLE_WIDTH - point.y * DIAMOND_M);
      if (pocketPoint && time >= pocketPoint.t && time < pocketPoint.t + POCKET_DROP_SECONDS) {
        const dropProgress = THREE.MathUtils.clamp((time - pocketPoint.t) / POCKET_DROP_SECONDS, 0, 1);
        const acceleratedDrop = dropProgress * dropProgress;
        group.visible = true;
        group.position.set(
          pocketPoint.x * DIAMOND_M,
          BALL_RADIUS - acceleratedDrop * BALL_RADIUS * 4.8,
          TABLE_WIDTH - pocketPoint.y * DIAMOND_M,
        );
      }
      group.quaternion.copy(poolQuaternionToThree(point.q));
    });
    state.cue.visible = time < .12;
    state.renderer.render(state.scene, state.camera);
  }, [drill.balls, time, trajectories, viewMode]);

  const label = viewMode === "player" ? "手玉後方のプレイヤー視点" : "台の真上から見る3D俯瞰";
  return (
    <div className={`three-stage ${viewMode}`}>
      <canvas ref={canvasRef} className="three-canvas" aria-label={`${drill.id}の${label}シミュレーション`} />
      <div className="player-view-caption"><span />{label}・球面模様が実回転</div>
      <div className="three-badge">リアルタイム3D</div>
    </div>
  );
}
