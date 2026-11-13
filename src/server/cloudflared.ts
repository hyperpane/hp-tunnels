// cloudflared, for Cloudflare's quick tunnels: the one on the server's PATH,
// else a copy of a pinned release in the plugin's data folder, downloaded
// once from Cloudflare's GitHub releases and checked against the SHA-256
// the release published before it's ever run.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/** 2026.10.6 (29 Oct 2026). Each file and its SHA-256, from the release's
 * notes. */
export const VERSION = '2026.10.6';
const FILES: Record<string, { file: string; sha256: string; tgz?: boolean }> = {
  'darwin-arm64': { file: 'cloudflared-darwin-arm64.tgz', sha256: '380451015c3676789adc4200f43757e950e7173b920b0094e272e8bea59d7927', tgz: true },
  'darwin-x64': { file: 'cloudflared-darwin-amd64.tgz', sha256: '2b74a9a6b9e5161dbf79a77c2fcc6337cd7e9d2b23eee9d1b6635ecb17608589', tgz: true },
  'linux-x64': { file: 'cloudflared-linux-amd64', sha256: '1d356dac769d0dbf62ebe588c4034824bbff98d5790c2f844cc99e0e2f57462d' },
  'linux-arm64': { file: 'cloudflared-linux-arm64', sha256: '0ae0e179475b2c77651a718d2b376e0151f4fca5954702a84f02843a4d5fcac0' },
  'win32-x64': { file: 'cloudflared-windows-amd64.exe', sha256: 'd521b3bf68982165f0d06d76732f22d9a105ef057ff3ae4c0986f3a23190950f' },
};

const EXE = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

/** cloudflared on PATH, if it's there. */
export function onPath(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, EXE);
    if (existsSync(file)) return file;
  }
  return null;
}

/** The one file in a .tar.gz with this name. */
export function fromTgz(tgz: Buffer, name: string): Buffer {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const file = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const body = at + 512;
    if ((type === '0' || type === '\0') && path.posix.basename(file) === name) return Buffer.from(tar.subarray(body, body + size));
    at = body + Math.ceil(size / 512) * 512;
  }
  throw new Error(`There's no ${name} in the download.`);
}

export interface Download {
  /** Fetches a URL's bytes, saying how far it got (0 to 1). */
  fetch(url: string, progress: (done: number) => void): Promise<Buffer>;
}

/** Node's fetch, with progress from Content-Length. */
export const httpDownload: Download = {
  async fetch(url, progress) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${url} answered ${res.status}.`);
    const total = Number(res.headers.get('content-length') ?? 0);
    const parts: Uint8Array[] = [];
    let got = 0;
    for await (const part of res.body) {
      parts.push(part);
      got += part.length;
      if (total) progress(Math.min(1, got / total));
    }
    return Buffer.concat(parts);
  },
};

let pending: Promise<string> | null = null;

/** cloudflared to run: on PATH, else the plugin's own copy (downloaded the
 * first time, once even when several tunnels ask together). */
export function cloudflared(dataDir: string, o: { note(text: string | null): void; download?: Download; platform?: string; env?: NodeJS.ProcessEnv }): Promise<string> {
  const found = onPath(o.env);
  if (found) return Promise.resolve(found);
  const dir = path.join(dataDir, 'bin', `cloudflared-${VERSION}`);
  const file = path.join(dir, EXE);
  if (existsSync(file)) return Promise.resolve(file);
  pending ??= fetchIt(dir, file, o).finally(() => {
    pending = null;
  });
  return pending;
}

async function fetchIt(dir: string, file: string, o: { note(text: string | null): void; download?: Download; platform?: string }): Promise<string> {
  const platform = o.platform ?? `${process.platform}-${process.arch}`;
  const asset = FILES[platform];
  if (!asset) throw new Error(`There's no cloudflared download for ${platform}: install it on the server (it's then found on the PATH).`);
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${asset.file}`;
  o.note('Downloading cloudflared…');
  const bytes = await (o.download ?? httpDownload).fetch(url, (done) => o.note(`Downloading cloudflared… ${Math.round(done * 100)}%`));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== asset.sha256) throw new Error(`The cloudflared download isn't the one Cloudflare published (its SHA-256 is ${sha.slice(0, 12)}…): not used.`);
  const exe = asset.tgz ? fromTgz(bytes, 'cloudflared') : bytes;
  await mkdir(dir, { recursive: true });
  await writeFile(`${file}.tmp`, exe, { mode: 0o755 });
  await chmod(`${file}.tmp`, 0o755).catch(() => {});
  await rename(`${file}.tmp`, file);
  o.note(null);
  return file;
}

/** Forgets the downloaded copies (for the tests). */
export async function forget(dataDir: string): Promise<void> {
  await rm(path.join(dataDir, 'bin'), { recursive: true, force: true });
}

