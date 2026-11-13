// A session that's one program (ssh, cloudflared): what it prints is read
// for the address; when it exits, what it said last is why.

import type { ChildProcess } from 'node:child_process';
import type { Context, Handlers, Session } from './index.ts';

/** Text as a terminal shows it: no colors, no cursor moves. */
export function plain(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g, '').replace(/\r/g, '');
}

/** The last line worth showing of what a program said. */
export function lastWords(text: string): string | null {
  const lines = plain(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/[█▀▄]/.test(l) && !/^[─│┌┐└┘├┤┬┴┼|+-]+$/.test(l));
  const line = lines.at(-1);
  return line ? line.slice(0, 300) : null;
}

export function runCommand(
  ctx: Context,
  on: Handlers,
  run: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv; name: string },
  find: (text: string) => string | null,
): Session {
  let out = '';
  let found = false;
  let child: ChildProcess;
  try {
    // stdin stays open: with -tt, ssh ends the session when it closes.
    child = ctx.spawn(run.cmd, run.args, { stdio: ['pipe', 'pipe', 'pipe'], env: run.env });
  } catch (e) {
    queueMicrotask(() => on.ended(`${run.name} couldn't be started: ${(e as Error).message}`, true));
    return { stop() {} };
  }
  ctx.log(`${run.name} started (pid ${child.pid ?? '?'})`);
  const take = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    out = (out + text).slice(-16_384);
    on.output(text);
    if (found) return;
    const url = find(plain(out));
    if (url) {
      found = true;
      on.address(url);
    }
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  let done = false;
  child.on('error', (e: NodeJS.ErrnoException) => {
    if (done) return;
    done = true;
    on.ended(e.code === 'ENOENT' ? `${run.name} isn't installed on this server (or isn't on its PATH).` : `${run.name} couldn't be started: ${e.message}`, true);
  });
  child.on('exit', (code, signal) => {
    if (done) return;
    done = true;
    ctx.log(`${run.name} exited (${code ?? signal}); it said: ${JSON.stringify(plain(out).slice(-600))}`);
    on.ended(plain(out) || `${run.name} stopped (exit code ${code ?? signal}).`);
  });
  return {
    stop() {
      if (done) return;
      child.kill();
    },
  };
}
