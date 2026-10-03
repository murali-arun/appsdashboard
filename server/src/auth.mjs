import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const PASSWORD_VERSION = 'scrypt-v1'

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function validateUsername(value) {
  const username = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(username)) {
    return { ok: false, error: 'Username must be 3–32 characters and use letters, numbers, dots, dashes, or underscores.' }
  }
  return { ok: true, username, normalizedUsername: normalizeUsername(username) }
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    return { ok: false, error: 'Password must be 10–128 characters.' }
  }
  return { ok: true }
}

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 64)
  return `${PASSWORD_VERSION}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false
  const [version, saltValue, hashValue, extra] = storedHash.split('$')
  if (extra || version !== PASSWORD_VERSION || !saltValue || !hashValue) return false
  try {
    const expected = Buffer.from(hashValue, 'base64url')
    const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}
