import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('pre-push hook', () => {
  let directory: string;
  let repository: string;
  let head: string;
  let previous: string;
  let environment: NodeJS.ProcessEnv;

  function git(...args: string[]) {
    return execFileSync('git', args, {
      cwd: repository,
      env: environment,
      encoding: 'utf8',
    }).trim();
  }
  function push(input: string) {
    return spawnSync('sh', [resolve('.githooks/pre-push')], {
      cwd: repository,
      env: environment,
      input,
      encoding: 'utf8',
    });
  }
  function ref(oid: string) {
    return `refs/heads/main ${oid} refs/heads/main ${'0'.repeat(40)}\n`;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'papyri-hook-'));
    repository = join(directory, 'repo');
    const bin = join(directory, 'bin');
    mkdirSync(repository);
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'nix'),
      '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_LOG"\nexit "${HOOK_EXIT:-0}"\n',
    );
    chmodSync(join(bin, 'nix'), 0o755);
    environment = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HOOK_LOG: join(directory, 'hook.log'),
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    };
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(repository, 'document'), 'first');
    git('add', 'document');
    git('commit', '-qm', 'first');
    previous = git('rev-parse', 'HEAD');
    writeFileSync(join(repository, 'document'), 'second');
    git('commit', '-qam', 'second');
    head = git('rev-parse', 'HEAD');
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('runs the browser suite for a clean checked-out commit and propagates failures', () => {
    expect(push(ref(head)).status).toBe(0);
    expect(readFileSync(environment.HOOK_LOG!, 'utf8')).toContain('develop -c npm run test:e2e');
    environment.HOOK_EXIT = '1';
    expect(push(ref(head)).status).toBe(1);
  });

  it('rejects a dirty working tree and a different pushed commit', () => {
    writeFileSync(join(repository, 'untracked'), 'change');
    expect(push(ref(head)).stderr).toContain('working-tree changes');
    rmSync(join(repository, 'untracked'));
    expect(push(ref(previous)).stderr).toContain('checked-out commit');
  });

  it('skips the suite for deletion-only pushes', () => {
    const result = push(`(delete) ${'0'.repeat(40)} refs/heads/old ${head}\n`);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Running browser tests');
  });
});
