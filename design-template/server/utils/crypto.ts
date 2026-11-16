import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32
const SALT = 'app-proxy-salt-v1'

let cachedKey: Buffer | null = null
let cachedPassphrase: string | null = null

function deriveKey(passphrase: string): Buffer {
  if (cachedKey && cachedPassphrase === passphrase) {
    return cachedKey
  }
  cachedKey = pbkdf2Sync(passphrase, SALT, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
  cachedPassphrase = passphrase
  return cachedKey
}

export function encrypt(data: any, passphrase: string): string {
  const key = deriveKey(passphrase)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const plaintext = JSON.stringify(data)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // Format: IV (12) || ciphertext || tag (16)
  return Buffer.concat([iv, encrypted, tag]).toString('base64')
}

export function decrypt(encoded: string, passphrase: string): any {
  const key = deriveKey(passphrase)
  const buffer = Buffer.from(encoded, 'base64')

  const iv = buffer.subarray(0, IV_LENGTH)
  const tag = buffer.subarray(buffer.length - TAG_LENGTH)
  const ciphertext = buffer.subarray(IV_LENGTH, buffer.length - TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}
