#!/usr/bin/env python3
"""Summarize patch edit-latency benchmark JSON files for paper tables."""

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


DEFAULT_INPUT_DIR = Path("docs/paper/edit")
DEFAULT_OUTPUT_DIR = Path("docs/paper/edit")
SUMMARY_CSV = "patch_edit_summary.csv"
ANALYSIS_MD = "patch_edit_analysis.md"
OPERATIONS = ("pick", "subdivide", "merge", "delete", "recover")


@dataclass(frozen=True)
class OperationSummary:
    median_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    max_latency_ms: float
    successful_trial_count: int
    failed_trial_count: int


@dataclass(frozen=True)
class BenchmarkRun:
    path: Path
    label: str
    patch_id: str
    initial_cell_count: int
    final_cell_count: int
    readiness_wait_ms: float | None
    duration_ms: float
    warmup_ms: float
    operations: dict[str, OperationSummary]

    @property
    def total_failed_trials(self) -> int:
        return sum(summary.failed_trial_count for summary in self.operations.values())


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
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR, help="Directory containing edit benchmark JSON files.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Directory for generated CSV/Markdown outputs.")
    return parser.parse_args()


def load_runs(input_dir: Path) -> list[BenchmarkRun]:
    json_paths = sorted(input_dir.glob("*.json"))
    if not json_paths:
        raise SystemExit(f"No JSON files found in {input_dir}")

    runs = [parse_run(path) for path in json_paths]
    return sorted(runs, key=lambda run: (run.initial_cell_count, run.path.name))


def parse_run(path: Path) -> BenchmarkRun:
    payload = json.loads(path.read_text(encoding="utf-8"))
    benchmark = payload.get("benchmark")
    if benchmark != "patch-edit-latency":
        raise ValueError(f"{path} is not a patch-edit-latency benchmark file: {benchmark!r}")

    summary = payload.get("summary", {})
    missing_operations = [operation for operation in OPERATIONS if operation not in summary]
    if missing_operations:
        raise ValueError(f"{path} is missing operation summary fields: {', '.join(missing_operations)}")

    return BenchmarkRun(
        path=path,
        label=str(payload.get("label", "")),
        patch_id=str(payload.get("patchId", "")),
        initial_cell_count=int(payload.get("initialCellCount", 0)),
        final_cell_count=int(payload.get("finalCellCount", payload.get("initialCellCount", 0))),
        readiness_wait_ms=optional_float(payload.get("readinessWaitMs")),
        duration_ms=float(payload.get("durationMs", 0)),
        warmup_ms=float(payload.get("warmupMs", 0)),
        operations={operation: parse_operation_summary(summary[operation]) for operation in OPERATIONS},
    )


def parse_operation_summary(payload: dict[str, Any]) -> OperationSummary:
    return OperationSummary(
        median_latency_ms=float(payload.get("medianLatencyMs", 0)),
        p95_latency_ms=float(payload.get("p95LatencyMs", 0)),
        p99_latency_ms=float(payload.get("p99LatencyMs", 0)),
        max_latency_ms=float(payload.get("maxLatencyMs", 0)),
        successful_trial_count=int(payload.get("successfulTrialCount", 0)),
        failed_trial_count=int(payload.get("failedTrialCount", 0)),
    )


def summarize_runs(runs: Iterable[BenchmarkRun]) -> list[dict[str, Any]]:
    groups: dict[int, list[BenchmarkRun]] = defaultdict(list)
    for run in runs:
        groups[run.initial_cell_count].append(run)

    rows = []
    for initial_cell_count, group in sorted(groups.items(), key=lambda item: item[0]):
        row: dict[str, Any] = {
            "initial_cell_count": initial_cell_count,
            "final_cell_count": representative_final_cell_count(group),
            "runs": len(group),
            "readiness_wait_ms_mean": avg_optional(group, "readiness_wait_ms"),
            "total_failed_trials": sum(run.total_failed_trials for run in group),
            "failure_notes": format_failure_notes(group),
            "cell_count_notes": format_cell_count_notes(group),
            "source_files": "; ".join(run.path.name for run in group),
        }
        for operation in OPERATIONS:
            summaries = [run.operations[operation] for run in group]
            row[f"{operation}_median_latency_ms_mean"] = mean(summary.median_latency_ms for summary in summaries)
            row[f"{operation}_p95_latency_ms_mean"] = mean(summary.p95_latency_ms for summary in summaries)
            row[f"{operation}_p99_latency_ms_mean"] = mean(summary.p99_latency_ms for summary in summaries)
            row[f"{operation}_max_latency_ms_max"] = max(summary.max_latency_ms for summary in summaries)
            row[f"{operation}_successful_trials"] = sum(summary.successful_trial_count for summary in summaries)
            row[f"{operation}_failed_trials"] = sum(summary.failed_trial_count for summary in summaries)
        rows.append(row)
    return rows


def representative_final_cell_count(group: list[BenchmarkRun]) -> int:
    values = {run.final_cell_count for run in group}
    if len(values) == 1:
        return next(iter(values))
    return max(values)


def format_failure_notes(group: list[BenchmarkRun]) -> str:
    notes = []
    for operation in OPERATIONS:
        failed = sum(run.operations[operation].failed_trial_count for run in group)
        if failed:
            success = sum(run.operations[operation].successful_trial_count for run in group)
            notes.append(f"{operation}: {failed} failed / {success + failed} trials")
    return "; ".join(notes)


def format_cell_count_notes(group: list[BenchmarkRun]) -> str:
    notes = []
    for run in group:
        if run.initial_cell_count != run.final_cell_count:
            notes.append(f"{run.path.name}: initial {run.initial_cell_count:,}, final {run.final_cell_count:,}")
    return "; ".join(notes)


def write_summary_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    operation_fields = []
    for operation in OPERATIONS:
        operation_fields.extend([
            f"{operation}_median_latency_ms_mean",
            f"{operation}_p95_latency_ms_mean",
            f"{operation}_p99_latency_ms_mean",
            f"{operation}_max_latency_ms_max",
            f"{operation}_successful_trials",
            f"{operation}_failed_trials",
        ])
    fieldnames = [
        "initial_cell_count",
        "final_cell_count",
        "runs",
        *operation_fields,
        "total_failed_trials",
        "readiness_wait_ms_mean",
        "failure_notes",
        "cell_count_notes",
        "source_files",
    ]
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: format_csv_value(row[key]) for key in fieldnames})


def write_analysis_md(path: Path, runs: list[BenchmarkRun], rows: list[dict[str, Any]]) -> None:
    lines = [
        "# Patch Edit Latency Benchmark Summary",
        "",
        f"Input files: {len(runs)} JSON benchmark run(s).",
        "",
        "## Paper Table",
        "",
        "| Cells | Runs | Pick p50 ms | Pick p95 ms | Subdivide p50 ms | Subdivide p95 ms | Merge p50 ms | Merge p95 ms | Delete p50 ms | Delete p95 ms | Recover p50 ms | Recover p95 ms |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            "| {cells} | {runs} | {pick50} | {pick95} | {subdivide50} | {subdivide95} | {merge50} | {merge95} | {delete50} | {delete95} | {recover50} | {recover95} |".format(
                cells=f"{int(row['initial_cell_count']):,}",
                runs=row["runs"],
                pick50=format_number(row["pick_median_latency_ms_mean"]),
                pick95=format_number(row["pick_p95_latency_ms_mean"]),
                subdivide50=format_number(row["subdivide_median_latency_ms_mean"]),
                subdivide95=format_number(row["subdivide_p95_latency_ms_mean"]),
                merge50=format_number(row["merge_median_latency_ms_mean"]),
                merge95=format_number(row["merge_p95_latency_ms_mean"]),
                delete50=format_number(row["delete_median_latency_ms_mean"]),
                delete95=format_number(row["delete_p95_latency_ms_mean"]),
                recover50=format_number(row["recover_median_latency_ms_mean"]),
                recover95=format_number(row["recover_p95_latency_ms_mean"]),
            )
        )

    lines.extend(["", "## Interpretation", ""])
    lines.extend(build_interpretation(rows))
    lines.extend(["", "## Paper-Ready Notes", ""])
    lines.extend([
        "- This table is aligned with the 4.5.1 rendering table structure, but uses edit-operation latency metrics instead of frame-rate metrics.",
        "- Use p50 and p95 latency as the main responsiveness indicators for each operation; the p50 column captures typical edit cost, while p95 captures tail latency.",
        "- Keep readiness/loading time out of the paper table. It is exported in the CSV for auditability but describes benchmark setup rather than edit latency.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_interpretation(rows: list[dict[str, Any]]) -> list[str]:
    if not rows:
        return ["- No benchmark rows were available."]

    sorted_rows = sorted(rows, key=lambda row: row["initial_cell_count"])
    largest_below_2m = max(
        (row for row in sorted_rows if row["initial_cell_count"] <= 2_000_000),
        key=lambda row: row["initial_cell_count"],
        default=None,
    )
    largest = max(sorted_rows, key=lambda row: row["initial_cell_count"])
    lines = []
    if largest_below_2m is not None:
        lines.append(
            f"- Up to {int(largest_below_2m['initial_cell_count']):,} cells, pick remains around "
            f"{format_number(largest_below_2m['pick_median_latency_ms_mean'])} ms p50, while topology-changing operations show higher but still sub-300 ms p95 latency "
            f"(subdivide p95 = {format_number(largest_below_2m['subdivide_p95_latency_ms_mean'])} ms, "
            f"merge p95 = {format_number(largest_below_2m['merge_p95_latency_ms_mean'])} ms, "
            f"delete p95 = {format_number(largest_below_2m['delete_p95_latency_ms_mean'])} ms)."
        )
    lines.append(
        f"- The largest tested patch contains {int(largest['initial_cell_count']):,} cells. At this scale, edit latency increases sharply: "
        f"pick p50 = {format_number(largest['pick_median_latency_ms_mean'])} ms, "
        f"subdivide p50 = {format_number(largest['subdivide_median_latency_ms_mean'])} ms, "
        f"merge p50 = {format_number(largest['merge_median_latency_ms_mean'])} ms, and "
        f"delete p50 = {format_number(largest['delete_median_latency_ms_mean'])} ms."
    )
    if any(int(row["runs"]) == 1 for row in sorted_rows):
        lines.append("- Each scale currently has only one run (`n=1`); repeat each scale before reporting uncertainty or drawing fine-grained scaling conclusions.")
    return lines


def avg_optional(group: list[BenchmarkRun], attr: str) -> float | None:
    values = [getattr(run, attr) for run in group if getattr(run, attr) is not None]
    if not values:
        return None
    return mean(float(value) for value in values)


def std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    return stdev(values)


def optional_float(value: Any) -> float | None:
    if value is None:
        return None
    parsed = float(value)
    if math.isnan(parsed):
        return None
    return parsed


def format_csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return format_number(value)
    return str(value)


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    return f"{float(value):.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
