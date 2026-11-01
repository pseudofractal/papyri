"""Measure native WebKit first paint or opening a Markdown file from a folder."""

import argparse
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4444"


def request(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, body, {"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error
    value = result.get("value")
    if isinstance(value, dict) and "error" in value:
        raise RuntimeError(value)
    return value


def run(binary, folder, filename, samples, first_paint=False):
    with tempfile.TemporaryDirectory(prefix="papyri-folder-benchmark-") as root:
        env = {
            **os.environ,
            "XDG_DATA_HOME": root + "/data",
            "XDG_CONFIG_HOME": root + "/config",
            "XDG_CACHE_HOME": root + "/cache",
        }
        driver = subprocess.Popen(["tauri-driver"], stdout=subprocess.DEVNULL, env=env, start_new_session=True)
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    request("GET", "/status")
                    break
                except (OSError, urllib.error.URLError):
                    if driver.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("WebDriver did not start")
                    time.sleep(0.05)
            results = []
            for _ in range(samples):
                options = {"capabilities": {"alwaysMatch": {"tauri:options": {"application": binary, "args": [folder]}}}}
                session = request("POST", "/session", options)["sessionId"]
                prefix = "/session/" + session
                try:
                    deadline = time.monotonic() + 20
                    while True:
                        if first_paint:
                            paint = request("POST", prefix + "/execute/sync", {
                                "script": "return performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null",
                                "args": [],
                            })
                            if paint is not None:
                                results.append(paint)
                                break
                            if time.monotonic() >= deadline:
                                raise RuntimeError("WebKit did not report first-contentful-paint")
                            time.sleep(0.05)
                            continue
                        ready = request("POST", prefix + "/execute/sync", {
                            "script": "return [...document.querySelectorAll('.file-row')].some(b => b.textContent.trim() === arguments[0])",
                            "args": [filename],
                        })
                        if ready:
                            break
                        if time.monotonic() >= deadline:
                            raise RuntimeError(f"File {filename!r} did not appear in the folder")
                        time.sleep(0.05)
                    if first_paint:
                        continue
                    script = """const name = arguments[0], done = arguments[arguments.length - 1];
const button = [...document.querySelectorAll('.file-row')].find(b => b.textContent.trim() === name);
const start = performance.now();
const timeout = setTimeout(() => done({error: 'preview timed out'}), 20000);
window.addEventListener('message', function receive(event) {
  if (event.data?.type !== 'ready' || event.source !== document.querySelector('iframe')?.contentWindow) return;
  window.removeEventListener('message', receive);
  requestAnimationFrame(() => requestAnimationFrame(() => {clearTimeout(timeout); done({ms: performance.now() - start});}));
});
button.click();"""
                    result = request("POST", prefix + "/execute/async", {"script": script, "args": [filename]})
                    if "error" in result:
                        raise RuntimeError(result["error"])
                    results.append(result["ms"])
                finally:
                    request("DELETE", prefix)
            return results
        finally:
            if driver.poll() is None:
                os.killpg(driver.pid, signal.SIGTERM)
            driver.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", help="Release Papyri executable")
    parser.add_argument("folder", help="Folder to open, or a document with --first-paint")
    parser.add_argument("filename", nargs="?", help="Markdown file name in that folder")
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--first-paint", action="store_true", help="Measure WebKit navigation to first contentful paint")
    args = parser.parse_args()
    folder = Path(args.folder).resolve()
    if args.samples < 1:
        parser.error("Provide a positive sample count")
    if args.first_paint:
        if not folder.exists() or args.filename is not None:
            parser.error("Provide one existing file or folder for --first-paint")
    else:
        if not folder.is_dir() or not args.filename:
            parser.error("Provide a folder and Markdown file name")
        file = folder / args.filename
        if not file.is_file() or file.parent != folder:
            parser.error("Provide a file directly inside the folder")
        if file.suffix.lower() not in (".md", ".markdown", ".mdown", ".mkd"):
            parser.error("This benchmark measures Markdown preview readiness")
    results = run(str(Path(args.binary).resolve()), str(folder), args.filename, args.samples, args.first_paint)
    summary = {
        "metric": "navigation-to-first-contentful-paint" if args.first_paint else "click-to-preview",
        "medianMs": round(statistics.median(results)),
        "samplesMs": [round(result) for result in results],
    }
    if args.first_paint:
        summary["path"] = str(folder)
    else:
        summary["folder"] = str(folder)
        summary["file"] = args.filename
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
