const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 256
const SALT = 'app-proxy-salt-v1'

let cachedKey: CryptoKey | null = null
let cachedPassphrase: string | null = null

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  if (cachedKey && cachedPassphrase === passphrase) {
    return cachedKey
  }

  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
  cachedPassphrase = passphrase
  return cachedKey
}

export async function encryptPayload(data: any, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH * 8 },
    key,
    encoder.encode(JSON.stringify(data)),
  )

  // Web Crypto appends the components tag to the ciphertext automatically
  // Format: IV (12) || ciphertext || tag (16) — same as server
  const result = new Uint8Array(IV_LENGTH + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), IV_LENGTH)

  return btoa(String.fromCharCode(...result))
}

export async function decryptPayload(encoded: string, passphrase: string): Promise<any> {
  const key = await deriveKey(passphrase)
  const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))

  const iv = raw.slice(0, IV_LENGTH)
  // ciphertext + tag (Web Crypto expects them together)
  const ciphertextWithTag = raw.slice(IV_LENGTH)

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH * 8 },
    key,
    ciphertextWithTag,
  )

  return JSON.parse(new TextDecoder().decode(decrypted))
}
