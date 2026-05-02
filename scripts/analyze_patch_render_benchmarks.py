#!/usr/bin/env python3
"""Summarize patch-render benchmark JSON files for paper tables."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, stdev
from typing import Any, Iterable


DEFAULT_INPUT_DIR = Path("docs/paper/benchmark")
DEFAULT_OUTPUT_DIR = Path("docs/paper/benchmark")
SUMMARY_CSV = "patch_render_summary.csv"
ANALYSIS_MD = "patch_render_analysis.md"


@dataclass(frozen=True)
class BenchmarkRun:
    path: Path
    workload: str
    label: str
    patch_id: str
    cell_count: int
    readiness_wait_ms: float | None
    duration_ms: float
    warmup_ms: float
    viewport_width: int | None
    viewport_height: int | None
    device_pixel_ratio: float | None
    mean_fps: float
    median_frame_ms: float
    p95_frame_ms: float
    p99_frame_ms: float
    max_frame_ms: float
    frames_over_16: int
    frames_over_33: int
    frame_count: int
    mean_render_duration_ms: float
    p95_render_duration_ms: float
    p99_render_duration_ms: float

    @property
    def slow_frame_over_16_7_pct(self) -> float:
        return pct(self.frames_over_16, self.frame_count)

    @property
    def slow_frame_over_33_3_pct(self) -> float:
        return pct(self.frames_over_33, self.frame_count)


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    runs = load_runs(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_rows = summarize_runs(runs)
    write_summary_csv(output_dir / SUMMARY_CSV, summary_rows)
    write_analysis_md(output_dir / ANALYSIS_MD, runs, summary_rows)

    print(f"Loaded {len(runs)} benchmark JSON file(s).")
    print(f"Wrote {output_dir / SUMMARY_CSV}")
    print(f"Wrote {output_dir / ANALYSIS_MD}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR, help="Directory containing benchmark JSON files.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Directory for generated CSV/Markdown outputs.")
    return parser.parse_args()


def load_runs(input_dir: Path) -> list[BenchmarkRun]:
    json_paths = sorted(input_dir.glob("*.json"))
    if not json_paths:
        raise SystemExit(f"No JSON files found in {input_dir}")

    runs = [parse_run(path) for path in json_paths]
    return sorted(runs, key=lambda run: (run.workload, run.cell_count, run.path.name))


def parse_run(path: Path) -> BenchmarkRun:
    payload = json.loads(path.read_text(encoding="utf-8"))
    summary = payload.get("summary", {})
    viewport = payload.get("viewport", {})

    return BenchmarkRun(
        path=path,
        workload=str(payload.get("workload", "unknown")),
        label=str(payload.get("label", "")),
        patch_id=str(payload.get("patchId", "")),
        cell_count=int(payload.get("cellCount", 0)),
        readiness_wait_ms=optional_float(payload.get("readinessWaitMs")),
        duration_ms=float(payload.get("durationMs", 0)),
        warmup_ms=float(payload.get("warmupMs", 0)),
        viewport_width=optional_int(viewport.get("width")),
        viewport_height=optional_int(viewport.get("height")),
        device_pixel_ratio=optional_float(viewport.get("devicePixelRatio")),
        mean_fps=float(summary.get("meanFps", 0)),
        median_frame_ms=float(summary.get("medianFrameMs", 0)),
        p95_frame_ms=float(summary.get("p95FrameMs", 0)),
        p99_frame_ms=float(summary.get("p99FrameMs", 0)),
        max_frame_ms=float(summary.get("maxFrameMs", 0)),
        frames_over_16=int(summary.get("framesOver16Ms", 0)),
        frames_over_33=int(summary.get("framesOver33Ms", 0)),
        frame_count=int(summary.get("frameCount", 0)),
        mean_render_duration_ms=float(summary.get("meanRenderDurationMs", 0)),
        p95_render_duration_ms=float(summary.get("p95RenderDurationMs", 0)),
        p99_render_duration_ms=float(summary.get("p99RenderDurationMs", 0)),
    )


def summarize_runs(runs: Iterable[BenchmarkRun]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, int], list[BenchmarkRun]] = defaultdict(list)
    for run in runs:
        groups[(run.workload, run.cell_count)].append(run)

    rows = []
    for (workload, cell_count), group in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1])):
        rows.append({
            "workload": workload,
            "cell_count": cell_count,
            "runs": len(group),
            "mean_fps_mean": avg(group, "mean_fps"),
            "mean_fps_std": std(group, "mean_fps"),
            "median_frame_ms_mean": avg(group, "median_frame_ms"),
            "p95_frame_ms_mean": avg(group, "p95_frame_ms"),
            "p99_frame_ms_mean": avg(group, "p99_frame_ms"),
            "max_frame_ms_max": max(getattr(run, "max_frame_ms") for run in group),
            "slow_frame_over_16_7_pct_mean": mean(run.slow_frame_over_16_7_pct for run in group),
            "slow_frame_over_33_3_pct_mean": mean(run.slow_frame_over_33_3_pct for run in group),
            "mean_render_duration_ms_mean": avg(group, "mean_render_duration_ms"),
            "p95_render_duration_ms_mean": avg(group, "p95_render_duration_ms"),
            "p99_render_duration_ms_mean": avg(group, "p99_render_duration_ms"),
            "readiness_wait_ms_mean": avg_optional(group, "readiness_wait_ms"),
            "viewport": format_viewports(group),
            "source_files": "; ".join(run.path.name for run in group),
        })
    return rows


def write_summary_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = [
        "workload",
        "cell_count",
        "runs",
        "mean_fps_mean",
        "mean_fps_std",
        "median_frame_ms_mean",
        "p95_frame_ms_mean",
        "p99_frame_ms_mean",
        "max_frame_ms_max",
        "slow_frame_over_16_7_pct_mean",
        "slow_frame_over_33_3_pct_mean",
        "mean_render_duration_ms_mean",
        "p95_render_duration_ms_mean",
        "p99_render_duration_ms_mean",
        "readiness_wait_ms_mean",
        "viewport",
        "source_files",
    ]
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: format_csv_value(row[key]) for key in fieldnames})


def write_analysis_md(path: Path, runs: list[BenchmarkRun], rows: list[dict[str, Any]]) -> None:
    workloads = sorted({run.workload for run in runs})
    lines = [
        "# Patch Render Benchmark Summary",
        "",
        f"Input files: {len(runs)} JSON benchmark run(s).",
        f"Workloads present: {', '.join(workloads)}.",
        "",
    ]

    missing = {"static", "navigation"} - set(workloads)
    if missing:
        lines.extend([
            f"Note: missing workload(s): {', '.join(sorted(missing))}. The current table should be interpreted as a partial benchmark set.",
            "",
        ])

    lines.extend([
        "## Aggregated Table",
        "",
        "| Workload | Cells | Runs | Mean FPS | Median ms | p95 ms | p99 ms | >16.7 ms | >33.3 ms | CPU submit p95 ms | Readiness wait ms |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ])
    for row in rows:
        lines.append(
            "| {workload} | {cells} | {runs} | {fps} | {median} | {p95} | {p99} | {slow16} | {slow33} | {submit95} | {ready} |".format(
                workload=row["workload"],
                cells=f"{int(row['cell_count']):,}",
                runs=row["runs"],
                fps=format_number(row["mean_fps_mean"]),
                median=format_number(row["median_frame_ms_mean"]),
                p95=format_number(row["p95_frame_ms_mean"]),
                p99=format_number(row["p99_frame_ms_mean"]),
                slow16=f"{format_number(row['slow_frame_over_16_7_pct_mean'])}%",
                slow33=f"{format_number(row['slow_frame_over_33_3_pct_mean'])}%",
                submit95=format_number(row["p95_render_duration_ms_mean"]),
                ready=format_optional(row["readiness_wait_ms_mean"]),
            )
        )

    lines.extend(["", "## Interpretation", ""])
    lines.extend(build_interpretation(rows))
    lines.extend(["", "## Paper-Ready Notes", ""])
    lines.extend([
        "- Use `mean FPS`, `p95 frame time`, and the proportion of frames above 16.7 ms as the main rendering-responsiveness metrics.",
        "- Treat `meanRenderDurationMs` and related fields as CPU-side render submission time, not GPU execution time.",
        "- `readinessWaitMs` is excluded from FPS measurement and should be reported separately when discussing large-patch loading cost.",
        "- The 16.7 ms reference corresponds to the 60 FPS interaction threshold; frame times near 8.3 ms indicate refresh-rate-limited rendering on a 120 Hz display.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_interpretation(rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return ["- No benchmark rows were available."]

    sorted_rows = sorted(rows, key=lambda row: (row["workload"], row["cell_count"]))
    responsive = [
        row for row in sorted_rows
        if row["p95_frame_ms_mean"] <= 16.7 and row["slow_frame_over_16_7_pct_mean"] <= 1.0
    ]
    saturated = [
        row for row in sorted_rows
        if row["mean_fps_mean"] >= 110 and row["p95_frame_ms_mean"] <= 16.7
    ]
    bottlenecked = [
        row for row in sorted_rows
        if row["p95_frame_ms_mean"] > 16.7 or row["slow_frame_over_16_7_pct_mean"] > 5.0
    ]

    lines = []
    if saturated:
        largest = max(saturated, key=lambda row: row["cell_count"])
        lines.append(
            f"- Up to {int(largest['cell_count']):,} cells, the measured {largest['workload']} workload remains refresh-rate-limited, "
            f"with mean FPS around {format_number(largest['mean_fps_mean'])} and p95 frame time of {format_number(largest['p95_frame_ms_mean'])} ms."
        )
    if responsive:
        largest = max(responsive, key=lambda row: row["cell_count"])
        lines.append(
            f"- The largest configuration that stays within the 60 FPS interaction threshold contains {int(largest['cell_count']):,} cells "
            f"({largest['workload']} workload, p95 = {format_number(largest['p95_frame_ms_mean'])} ms, "
            f">16.7 ms frames = {format_number(largest['slow_frame_over_16_7_pct_mean'])}%)."
        )
    if bottlenecked:
        first = min(bottlenecked, key=lambda row: row["cell_count"])
        lines.append(
            f"- A clear rendering bottleneck appears at {int(first['cell_count']):,} cells: mean FPS drops to "
            f"{format_number(first['mean_fps_mean'])}, p95 frame time rises to {format_number(first['p95_frame_ms_mean'])} ms, "
            f"and {format_number(first['slow_frame_over_16_7_pct_mean'])}% of frames exceed the 16.7 ms threshold."
        )
    if len(sorted_rows) == 1:
        only = sorted_rows[0]
        lines.append(
            f"- This single run contains {int(only['cell_count']):,} cells and should be treated as preliminary until repeated runs are available."
        )
    if any(int(row["runs"]) == 1 for row in sorted_rows):
        lines.append("- Several data points have only one run (`n=1`); repeat each scale at least five times before reporting uncertainty in the paper.")
    return lines


def avg(group: list[BenchmarkRun], attr: str) -> float:
    return mean(float(getattr(run, attr)) for run in group)


def std(group: list[BenchmarkRun], attr: str) -> float:
    if len(group) < 2:
        return 0.0
    return stdev(float(getattr(run, attr)) for run in group)


def avg_optional(group: list[BenchmarkRun], attr: str) -> float | None:
    values = [getattr(run, attr) for run in group if getattr(run, attr) is not None]
    if not values:
        return None
    return mean(float(value) for value in values)


def format_viewports(group: list[BenchmarkRun]) -> str:
    values = sorted({
        f"{run.viewport_width}x{run.viewport_height}@{format_number(run.device_pixel_ratio)}"
        for run in group
        if run.viewport_width is not None and run.viewport_height is not None and run.device_pixel_ratio is not None
    })
    return "; ".join(values)


def pct(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return count / total * 100


def optional_float(value: Any) -> float | None:
    if value is None:
        return None
    parsed = float(value)
    if math.isnan(parsed):
        return None
    return parsed


def optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def format_csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return format_number(value)
    return str(value)


def format_optional(value: Any) -> str:
    if value is None:
        return "-"
    return format_number(float(value))


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    return f"{float(value):.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
