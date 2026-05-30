import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const PREFIX = 'enc:v1';

function encryptionKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('Missing DATA_ENCRYPTION_KEY');
  }
  // Deterministically derive a 32-byte key from any sufficiently random input.
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (plain.startsWith(`${PREFIX}:`)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!stored.startsWith(`${PREFIX}:`)) return stored; // Backward-compatible plaintext support.
  const parts = stored.split(':');
  if (parts.length !== 5) {
    throw new Error('Invalid encrypted secret format');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(`${PREFIX}:`));
}
