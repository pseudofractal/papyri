"""Measure a real Linux app launch. Run with an existing display and a release binary."""

import argparse
import json
import os
from pathlib import Path
import selectors
import signal
import statistics
import subprocess
import tempfile
import time


def measure(binary, document, timeout, profile, target=None):
    start = time.monotonic()
    process = subprocess.Popen(
        [binary, document],
        env={**os.environ, "PAPYRI_STARTUP_TRACE": "1", **profile},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        start_new_session=True,
        bufsize=0,
    )
    target = target or (
        "folder" if Path(document).is_dir()
        else "pdf-page" if Path(document).suffix.lower() in (".pdf", ".typ", ".tex")
        else "document"
    )
    markers = {}
    log = bytearray()
    buffer = b""
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stderr, selectors.EVENT_READ)
            deadline = start + timeout
            while target not in markers or "shell" not in markers:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(f"Timed out waiting for {target}: {log.decode(errors='replace')}")
                if not selector.select(remaining):
                    continue
                chunk = os.read(process.stderr.fileno(), 65536)
                if not chunk:
                    raise RuntimeError(f"Application exited before {target}: {log.decode(errors='replace')}")
                observed = (time.monotonic() - start) * 1000
                log.extend(chunk)
                buffer += chunk
                lines = buffer.split(b"\n")
                buffer = lines.pop()
                for line in lines:
                    parts = line.decode(errors="replace").split()
                    if len(parts) == 3 and parts[0] == "PAPYRI_STARTUP":
                        markers[parts[1]] = {"launchMs": observed, "navigationMs": float(parts[2])}
                    elif len(parts) == 2 and parts[0] == "PAPYRI_NATIVE":
                        markers[f"native-{parts[1]}"] = {"launchMs": observed}
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        process.stderr.close()
    return markers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", help="Release Papyri executable")
    parser.add_argument("document", nargs="?", default=".", help="Document or directory to open (default: current directory)")
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args()
    if args.samples < 1 or args.timeout <= 0:
        parser.error("samples and timeout must be positive")
    binary = str(Path(args.binary).resolve())
    document = str(Path(args.document).resolve())
    with tempfile.TemporaryDirectory(prefix="papyri-startup-profile-") as directory:
        profile = {key: str(Path(directory) / name) for key, name in (
            ("XDG_DATA_HOME", "data"), ("XDG_CONFIG_HOME", "config"), ("XDG_CACHE_HOME", "cache")
        )}
        results = [measure(binary, document, args.timeout, profile) for _ in range(args.samples)]
    summary = {}
    for stage in results[0]:
        stage_samples = [sample[stage] for sample in results if stage in sample]
        values = sorted(sample["launchMs"] for sample in stage_samples)
        summary[stage] = {
            "medianMs": round(statistics.median(values)),
            "p95Ms": round(values[max(0, (95 * len(values) + 99) // 100 - 1)]),
            "samplesMs": [round(value) for value in values],
        }
        if "navigationMs" in stage_samples[0]:
            summary[stage]["navigationMedianMs"] = round(statistics.median(sample["navigationMs"] for sample in stage_samples))
            summary[stage]["preNavigationEstimateMedianMs"] = round(statistics.median(sample["launchMs"] - sample["navigationMs"] for sample in stage_samples))
    print(json.dumps({"binary": binary, "document": document, "samples": args.samples, "summary": summary, "markers": results}, indent=2))


if __name__ == "__main__":
    main()
