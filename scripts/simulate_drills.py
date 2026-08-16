"""Generate browser-playable trajectories with pooltool 0.6.

The authored drill data remains the source for setup and scoring.  This script
converts diamond coordinates to a 9-foot table, simulates the shot, checks the
required outcome, and writes compact trajectories consumed by the site.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pooltool as pt

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app" / "drills.json"
OUTPUT = ROOT / "app" / "generatedTrajectories.json"
REPORT = ROOT / "public" / "generated" / "physics-validation.json"

LENGTH = 2.54
WIDTH = 1.27
BALL_RADIUS_DIAMOND = 0.09
POCKETS = {
    "左上": (0.0, 0.0), "上中央": (4.0, 0.0), "右上": (8.0, 0.0),
    "左下": (0.0, 4.0), "下中央": (4.0, 4.0), "右下": (8.0, 4.0),
}
COLORS = {"CB": "#dbe9e3", "OB1": "#efcc69"}
SLOW_CLOTH_PARAMS = {"u_s": 0.24, "u_r": 0.018, "u_sp_proportionality": 0.55}


def quaternion_multiply(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    lw, lx, ly, lz = left
    rw, rx, ry, rz = right
    return (
        lw * rw - lx * rx - ly * ry - lz * rz,
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
    )


def orientation_history(rvw, times) -> list[tuple[float, float, float, float]]:
    """Integrate pooltool's world-space angular velocity for browser rendering."""
    orientations = [(1.0, 0.0, 0.0, 0.0)]
    current = orientations[0]
    for index in range(1, len(times)):
        dt = float(times[index] - times[index - 1])
        wx, wy, wz = (float(value) for value in rvw[index - 1, 2, :])
        magnitude = math.sqrt(wx * wx + wy * wy + wz * wz)
        if magnitude > 1e-10 and dt > 0:
            half_angle = magnitude * dt / 2
            scale = math.sin(half_angle) / magnitude
            delta = (math.cos(half_angle), wx * scale, wy * scale, wz * scale)
            current = quaternion_multiply(delta, current)
            norm = math.sqrt(sum(value * value for value in current))
            current = tuple(value / norm for value in current)
        orientations.append(current)
    return orientations


def to_pool(x: float, y: float) -> tuple[float, float]:
    """Site (long-axis x, short-axis y) -> pooltool (short x, long y)."""
    return y / 4 * WIDTH, x / 8 * LENGTH


def from_pool(x: float, y: float) -> tuple[float, float]:
    return y / LENGTH * 8, x / WIDTH * 4


def unit(dx: float, dy: float) -> tuple[float, float]:
    length = math.hypot(dx, dy)
    if length == 0:
        raise ValueError("Zero-length aiming vector")
    return dx / length, dy / length


def first_movement_direction(drill: dict, ball_id: str) -> tuple[float, float]:
    trajectory = next(item for item in drill["trajectories"] if item["ballId"] == ball_id)
    start = trajectory["points"][0]
    for point in trajectory["points"][1:]:
        dx, dy = point["x"] - start["x"], point["y"] - start["y"]
        if math.hypot(dx, dy) > 0.05:
            return unit(dx, dy)
    raise ValueError(f"{drill['id']}: {ball_id} has no movement direction")


def aim_point(drill: dict) -> tuple[float, float]:
    cb = next(ball for ball in drill["balls"] if ball["id"] == "CB")
    object_balls = [ball for ball in drill["balls"] if ball["id"].startswith("OB")]
    if object_balls:
        ob = object_balls[0]
        ux, uy = first_movement_direction(drill, ob["id"])
        return ob["x"] - ux * 2 * BALL_RADIUS_DIAMOND, ob["y"] - uy * 2 * BALL_RADIUS_DIAMOND
    authored = next(item for item in drill["trajectories"] if item["ballId"] == "CB")
    return authored["points"][1]["x"], authored["points"][1]["y"]


def nearest_pocket(x: float, y: float) -> tuple[float, float]:
    return min(POCKETS.values(), key=lambda pocket: math.hypot(x - pocket[0], y - pocket[1]))


def point_inside(point: dict, zone: dict) -> bool:
    return zone["x1"] <= point["x"] <= zone["x2"] and zone["y1"] <= point["y"] <= zone["y2"]


def simulate(drill: dict) -> tuple[dict, dict]:
    table = pt.Table.from_table_specs(pt.objects.PocketTableSpecs(l=LENGTH, w=WIDTH))
    balls = tuple(
        pt.Ball.create(ball["id"], xy=to_pool(ball["x"], ball["y"]), **SLOW_CLOTH_PARAMS)
        for ball in drill["balls"]
    )
    cue = pt.Cue(cue_ball_id="CB")
    system = pt.System(table=table, cue=cue, balls=balls)

    cb = next(ball for ball in drill["balls"] if ball["id"] == "CB")
    target = aim_point(drill)
    cb_pool = to_pool(cb["x"], cb["y"])
    target_pool = to_pool(*target)
    phi = math.degrees(math.atan2(target_pool[1] - cb_pool[1], target_pool[0] - cb_pool[0])) % 360
    cue_spec = drill["cue"]
    cue.set_state(
        V0=cue_spec["speedMps"], phi=phi, theta=cue_spec["elevationDeg"],
        a=-cue_spec["x"], b=cue_spec["y"],
    )
    pt.simulate(system, continuous=True, dt=0.015, inplace=True)

    physical_duration = float(system.t)
    display_scale = 1.0
    trajectories = []
    raw_points: dict[str, list[dict]] = {}
    for ball_id, ball in system.balls.items():
        rvw, states, times = ball.history_cts.vectorize()
        orientations = orientation_history(rvw, times)
        stride = max(1, len(times) // 150)
        indices = list(range(0, len(times), stride))
        if indices[-1] != len(times) - 1:
            indices.append(len(times) - 1)
        points = []
        for index in indices:
            x, y = from_pool(float(rvw[index, 0, 0]), float(rvw[index, 0, 1]))
            pocketed = int(states[index]) == 4
            if pocketed:
                x, y = nearest_pocket(x, y)
            points.append({
                "t": round(float(times[index]) * display_scale, 4),
                "x": round(x, 4), "y": round(y, 4),
                "q": [round(value, 6) for value in orientations[index]],
                **({"visible": False} if pocketed else {}),
            })
        raw_points[ball_id] = points
        trajectories.append({"ballId": ball_id, "color": COLORS.get(ball_id, "#da7a66"), "points": points})

    failures = []
    object_ids = [ball["id"] for ball in drill["balls"] if ball["id"].startswith("OB")]
    if drill["targetPocket"] != "なし":
        if not object_ids or int(system.balls[object_ids[0]].state.s) != 4:
            failures.append("的玉が指定ポケットへ入りません")
        elif object_ids:
            final = raw_points[object_ids[0]][-1]
            expected = POCKETS[drill["targetPocket"]]
            if math.hypot(final["x"] - expected[0], final["y"] - expected[1]) > 0.15:
                failures.append("的玉が別のポケットへ入りました")

    if drill["successZone"] and drill["successBallId"]:
        scoring_points = raw_points[drill["successBallId"]]
        reached = point_inside(scoring_points[-1], drill["successZone"]) if drill["successMode"] == "stop" else any(point_inside(point, drill["successZone"]) for point in scoring_points)
        if not reached:
            failures.append("指定球が合格領域へ到達しません")

    report = {
        "id": drill["id"], "status": "合格" if not failures else "要調整",
        "failures": failures, "physicalDuration": round(physical_duration, 4),
        "displayScale": round(display_scale, 3), "phiDeg": round(phi, 3),
        "cue": {"speedMps": cue_spec["speedMps"], "a": -cue_spec["x"], "b": cue_spec["y"], "thetaDeg": cue_spec["elevationDeg"]},
        "events": [{"type": event.event_type.value, "time": round(float(event.time), 4)} for event in system.events],
    }
    generated = {
        "duration": round(physical_duration * display_scale, 4),
        "physicalDuration": round(physical_duration, 4), "timeScale": round(display_scale, 3),
        "engine": f"pooltool {pt.__version__}", "trajectories": trajectories,
    }
    return generated, report


def main() -> None:
    data = json.loads(SOURCE.read_text())
    output, reports = {}, []
    for drill in data["drills"]:
        generated, report = simulate(drill)
        output[drill["id"]] = generated
        reports.append(report)
        marker = "✓" if report["status"] == "合格" else "!"
        print(f"{marker} {drill['id']}: {report['status']} ({', '.join(report['failures']) or '成立'})")

    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps({
        "engine": f"pooltool {pt.__version__}",
        "table": {
            "lengthM": LENGTH, "widthM": WIDTH,
            "cloth": {"slidingFriction": 0.24, "rollingFriction": 0.018, "spinFrictionFactor": 0.55},
        },
        "passed": sum(report["status"] == "合格" for report in reports),
        "total": len(reports), "results": reports,
    }, ensure_ascii=False, indent=2) + "\n")

    failed = [report for report in reports if report["status"] != "合格"]
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
