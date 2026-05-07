#!/usr/bin/env python3
"""Tests for the patch edit benchmark summary script."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import analyze_patch_edit_benchmarks as analyzer


class PatchEditBenchmarkSummaryTest(unittest.TestCase):
    def test_summarizes_operation_latency_table_and_notes_failures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            input_dir = Path(tmp) / "input"
            output_dir = Path(tmp) / "output"
            input_dir.mkdir()
            self.write_run(input_dir / "small.json", 100, 100, {
                "pick": (10, 12, 30, 0),
                "subdivide": (20, 24, 30, 0),
                "merge": (30, 36, 30, 0),
                "delete": (40, 48, 30, 0),
                "recover": (50, 60, 30, 0),
            })
            self.write_run(input_dir / "large.json", 200, 198, {
                "pick": (11, 13, 30, 0),
                "subdivide": (21, 25, 29, 1),
                "merge": (31, 37, 30, 0),
                "delete": (41, 49, 30, 0),
                "recover": (51, 61, 30, 0),
            })

            runs = analyzer.load_runs(input_dir)
            rows = analyzer.summarize_runs(runs)

            self.assertEqual([row["initial_cell_count"] for row in rows], [100, 200])
            self.assertEqual(rows[0]["pick_median_latency_ms_mean"], 10)
            self.assertEqual(rows[0]["recover_p95_latency_ms_mean"], 60)
            self.assertEqual(rows[1]["total_failed_trials"], 1)
            self.assertIn("subdivide", rows[1]["failure_notes"])
            self.assertNotIn("initial/final cell-count mismatch", "\n".join(analyzer.build_interpretation(rows)))

            output_dir.mkdir()
            analyzer.write_summary_csv(output_dir / analyzer.SUMMARY_CSV, rows)
            analyzer.write_analysis_md(output_dir / analyzer.ANALYSIS_MD, runs, rows)
            analysis = (output_dir / analyzer.ANALYSIS_MD).read_text(encoding="utf-8")
            self.assertIn("| Cells | Runs | Pick p50 ms | Pick p95 ms | Subdivide p50 ms |", analysis)
            self.assertIn("| 100 | 1 | 10.00 | 12.00 | 20.00 | 24.00 |", analysis)
            self.assertNotIn("Failure notes", analysis)
            self.assertNotIn("initial/final cell-count mismatch", analysis)

    @staticmethod
    def write_run(path: Path, initial_cells: int, final_cells: int, operations: dict[str, tuple[int, int, int, int]]) -> None:
        path.write_text(json.dumps({
            "benchmark": "patch-edit-latency",
            "label": "unit-test",
            "patchId": "patch-a",
            "startedAt": "2026-05-02T00:00:00.000Z",
            "durationMs": 1000,
            "warmupMs": 0,
            "initialCellCount": initial_cells,
            "finalCellCount": final_cells,
            "readinessWaitMs": 123.4,
            "summary": {
                operation: {
                    "medianLatencyMs": median,
                    "p95LatencyMs": p95,
                    "p99LatencyMs": p95 + 1,
                    "maxLatencyMs": p95 + 2,
                    "meanLatencyMs": median + 1,
                    "minLatencyMs": median - 1,
                    "successfulTrialCount": success,
                    "failedTrialCount": failed,
                }
                for operation, (median, p95, success, failed) in operations.items()
            },
        }), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
