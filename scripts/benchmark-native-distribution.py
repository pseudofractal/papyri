"""Measure fresh Papyri launches with targeted Linux file-cache eviction."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import random
import tempfile


spec = importlib.util.spec_from_file_location('benchmark_native', Path(__file__).with_name('benchmark-native.py'))
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('showcase', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--samples', type=int, default=30)
    parser.add_argument('--seed', type=int, default=271828)
    parser.add_argument('--latex', choices=['pdf', 'fallback'], required=True,
                        help='Expect compiled PDF or source fallback for LaTeX')
    args = parser.parse_args()
    if args.samples < 1:
        parser.error('samples must be positive')
    binary = args.binary.resolve(strict=True)
    showcase = args.showcase.resolve(strict=True)
    wrapped = binary.parent / '.papyri-wrapped'
    files = [binary] + ([wrapped] if wrapped.is_file() else [])
    files += [file for file in showcase.rglob('*') if file.is_file()]
    latex_name = 'LaTeX source fallback' if args.latex == 'fallback' else 'LaTeX PDF'
    workloads = [
        ('Folder', showcase, 'folder'),
        ('Markdown', showcase / 'markdown.md', 'document'),
        ('PDF', showcase / 'sample.pdf', 'pdf-page'),
        ('Typst', showcase / 'paper.typ', 'pdf-page'),
        (latex_name, showcase / 'paper.tex', 'document' if args.latex == 'fallback' else 'pdf-page'),
    ]
    results = {
        'binary': str(binary), 'seed': args.seed, 'samplesPerWorkload': args.samples,
        'conditions': 'Fresh process and XDG profile per launch; POSIX_FADV_DONTNEED for Papyri executables and showcase files before each launch; shared libraries, fonts, WebKit and OS caches not controlled',
        'workloads': {name: {'path': str(path), 'target': target, 'samples': [], 'errors': []} for name, path, target in workloads},
    }
    rng = random.Random(args.seed)
    for iteration in range(args.samples):
        order = workloads.copy()
        rng.shuffle(order)
        for name, path, target in order:
            for file in files:
                fd = os.open(file, os.O_RDONLY)
                try:
                    os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                finally:
                    os.close(fd)
            with tempfile.TemporaryDirectory(prefix='papyri-cold-profile-') as directory:
                profile = {key: str(Path(directory) / value) for key, value in [
                    ('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'), ('XDG_CACHE_HOME', 'cache')
                ]}
                try:
                    markers = benchmark.measure(str(binary), str(path), 20, profile, target)
                    results['workloads'][name]['samples'].append(markers)
                except Exception as error:
                    results['workloads'][name]['errors'].append({'iteration': iteration, 'error': str(error)})
            args.output.write_text(json.dumps(results, indent=2))
            print(f'{iteration + 1}/{args.samples} {name}: {len(results["workloads"][name]["errors"])} errors', flush=True)
    if any(workload['errors'] for workload in results['workloads'].values()):
        raise SystemExit('One or more launches failed; details are in the output.')


if __name__ == '__main__':
    main()
