// SSH keys for the tunnels, made here rather than with ssh-keygen (so only
// ssh is needed): Ed25519, in OpenSSH's own format, unencrypted, readable
// by this user only. Each tunnel has its own, so a stable address belongs
// to that tunnel, and the server's own keys are never offered to anyone.

import { generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function str(data: Buffer | string): Buffer {
  const b = typeof data === 'string' ? Buffer.from(data) : data;
  return Buffer.concat([u32(b.length), b]);
}

/** A new Ed25519 key: the private key file's text (`-----BEGIN OPENSSH
 * PRIVATE KEY-----`) and the public key's line (`ssh-ed25519 AAAA… comment`). */
export function newKey(comment: string): { privateKey: string; publicKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const pk = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  const seed = Buffer.from(jwk.d!, 'base64url');
  const blob = Buffer.concat([str('ssh-ed25519'), str(pk)]);
  const check = u32(Math.floor(Math.random() * 0xffffffff));
  let secret = Buffer.concat([check, check, str('ssh-ed25519'), str(pk), str(Buffer.concat([seed, pk])), str(comment)]);
  // Padded to the cipher's block size (8 for none): 1, 2, 3…
  const pad = (8 - (secret.length % 8)) % 8;
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const body = Buffer.concat([Buffer.from('openssh-key-v1\0'), str('none'), str('none'), str(''), u32(1), str(blob), str(secret)]);
  const lines = body.toString('base64').match(/.{1,70}/g) ?? [];
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${blob.toString('base64')} ${comment}`,
  };
}

/** The keys' folder in the plugin's data folder. */
export function keysDir(dataDir: string): string {
  return path.join(dataDir, 'keys');
}

/** The tunnel's key file, made the first time. */
export async function keyFor(dataDir: string, id: string): Promise<string> {
  const dir = keysDir(dataDir);
  const file = path.join(dir, id);
  try {
    await readFile(file);
    return file;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const key = newKey(`hyperpane-tunnel-${id}`);
  await writeFile(`${file}.tmp`, key.privateKey, { mode: 0o600 });
  await writeFile(`${file}.pub`, `${key.publicKey}\n`, { mode: 0o644 });
  await rename(`${file}.tmp`, file);
  // ssh refuses a private key others can read.
  await chmod(file, 0o600).catch(() => {});
  return file;
}

/** Forgets the tunnel's key (its stable address goes with it). */
export async function dropKey(dataDir: string, id: string): Promise<void> {
  const file = path.join(keysDir(dataDir), id);
  await rm(file, { force: true });
  await rm(`${file}.pub`, { force: true });
}
