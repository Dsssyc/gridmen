"""
Memory benchmark for assembly() function.

Usage:
    cd server/
    uv run python benchmark_assembly_memory.py
"""

import os
import sys
import time
import shutil
import tracemalloc
import tempfile
from pathlib import Path

# Ensure cwd is server/
os.chdir(Path(__file__).parent)
sys.path.insert(0, str(Path.cwd() / 'src' / 'gridmen_backend'))

from pynoodle import NOODLE_INIT, NOODLE_TERMINATE
from templates.grid.assembly import assembly


# --- Configuration ---
SCHEMA_NODE_KEY = '.HK.evaluation.modified.m-schema'
PATCH_NODE_KEYS = ['.HK.evaluation.modified.p-mrcg-grading']
GRADING_THRESHOLD = 1


def get_rss_mb() -> float:
    """Get current RSS in MB via /proc or ps."""
    try:
        import resource
        usage = resource.getrusage(resource.RUSAGE_SELF)
        return usage.ru_maxrss / (1024 * 1024)  # macOS: bytes -> MB
    except Exception:
        return -1.0


def run_benchmark():
    print("=" * 60)
    print("Assembly Memory Benchmark")
    print("=" * 60)
    print(f"Schema: {SCHEMA_NODE_KEY}")
    print(f"Patches: {PATCH_NODE_KEYS}")
    print(f"Grading threshold: {GRADING_THRESHOLD}")
    print()

    # Initialize noodle
    print("[1/4] Initializing noodle...")
    NOODLE_INIT()

    # Create temp output dir
    output_dir = Path(tempfile.mkdtemp(prefix="assembly_bench_"))
    print(f"[2/4] Output dir: {output_dir}")

    # Start memory tracking
    tracemalloc.start()
    snapshot_before = tracemalloc.take_snapshot()
    rss_before = get_rss_mb()

    print(f"[3/4] Running assembly...")
    print(f"  RSS before: {rss_before:.1f} MB")
    t0 = time.time()

    try:
        meta_info = assembly(
            output_dir,
            SCHEMA_NODE_KEY,
            PATCH_NODE_KEYS,
            GRADING_THRESHOLD,
        )
    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback
        traceback.print_exc()
        return

    elapsed = time.time() - t0
    snapshot_after = tracemalloc.take_snapshot()
    current, peak = tracemalloc.get_traced_memory()
    rss_after = get_rss_mb()
    tracemalloc.stop()

    print()
    print("[4/4] Results")
    print("-" * 40)
    print(f"  Time:             {elapsed:.2f} s")
    print(f"  Peak traced mem:  {peak / 1024 / 1024:.1f} MB")
    print(f"  Current traced:   {current / 1024 / 1024:.1f} MB")
    print(f"  RSS before:       {rss_before:.1f} MB")
    print(f"  RSS after:        {rss_after:.1f} MB")
    print()

    # Show top allocators
    print("Top 15 memory allocators (peak):")
    print("-" * 60)
    stats = snapshot_after.compare_to(snapshot_before, 'lineno')
    for i, stat in enumerate(stats[:15]):
        print(f"  {i+1:2d}. {stat}")

    # Show output files
    print()
    print("Output files:")
    for f in sorted(output_dir.iterdir()):
        size = f.stat().st_size
        print(f"  {f.name}: {size / 1024:.1f} KB")

    # Cleanup
    shutil.rmtree(output_dir, ignore_errors=True)
    NOODLE_TERMINATE()
    print()
    print("Done.")


if __name__ == '__main__':
    run_benchmark()
