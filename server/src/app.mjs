import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

const COOKIE_NAME = 'persotodo_session'
const SESSION_SECONDS = 60 * 60 * 12
const MAX_BODY_BYTES = 8 * 1024

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  response.end(JSON.stringify(body))
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const separator = value.indexOf('=')
        return separator === -1
          ? [value, '']
          : [value.slice(0, separator), decodeURIComponent(value.slice(separator + 1))]
      })
  )
}

function signature(secret, expiresAt) {
  return createHmac('sha256', secret)
    .update(`persotodo:${expiresAt}`)
    .digest('hex')
}

function createSession(secret, now) {
  const expiresAt = now() + SESSION_SECONDS * 1000
  return `${expiresAt}.${signature(secret, expiresAt)}`
}

function validSession(token, secret, now) {
  if (!token) return false
  const [expiresAtRaw, suppliedSignature, extra] = token.split('.')
  const expiresAt = Number(expiresAtRaw)
  if (extra || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) return false

  const expected = Buffer.from(signature(secret, expiresAt))
  const supplied = Buffer.from(suppliedSignature ?? '')
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

function matchingPin(supplied, expected) {
  const suppliedHash = createHash('sha256').update(String(supplied)).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(suppliedHash, expectedHash)
}

async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json.')
    error.status = 415
    throw error
  }

  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.status = 400
    throw error
  }
}

function normalizeTitle(value) {
  if (typeof value !== 'string') return null
  const title = value.trim()
  return title.length > 0 && title.length <= 500 ? title : null
}

function clientAddress(request) {
  return request.headers['x-forwarded-for']?.split(',')[0]?.trim()
    ?? request.socket.remoteAddress
    ?? 'unknown'
}

export function createApiServer({ repository, pin, sessionSecret, now = Date.now }) {
  const failedLogins = new Map()

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')

    try {
      if (request.method === 'GET' && url.pathname === '/healthz') {
        await repository.health()
        json(response, 200, { status: 'ok' })
        return
      }

      if (!url.pathname.startsWith('/api/persotodo/')) {
        json(response, 404, { error: 'Not found.' })
        return
      }

      const cookies = parseCookies(request.headers.cookie)
      const authenticated = validSession(cookies[COOKIE_NAME], sessionSecret, now)

      if (url.pathname === '/api/persotodo/session' && request.method === 'GET') {
        json(response, 200, { authenticated })
        return
      }

      if (url.pathname === '/api/persotodo/session' && request.method === 'POST') {
        const address = clientAddress(request)
        const record = failedLogins.get(address)
        const windowStart = now() - 15 * 60 * 1000
        const recentFailures = record?.since > windowStart ? record.count : 0
        if (recentFailures >= 5) {
          json(response, 429, { error: 'Too many attempts. Try again later.' })
          return
        }

        const body = await readJson(request)
        if (!matchingPin(body.pin ?? '', pin)) {
          failedLogins.set(address, {
            count: recentFailures + 1,
            since: record?.since > windowStart ? record.since : now()
          })
          json(response, 401, { error: 'Incorrect PIN.' })
          return
        }

        failedLogins.delete(address)
        const token = createSession(sessionSecret, now)
        json(response, 200, { authenticated: true }, {
          'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
        })
        return
      }

      if (url.pathname === '/api/persotodo/session' && request.method === 'DELETE') {
        json(response, 200, { authenticated: false }, {
          'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
        })
        return
      }

      if (!authenticated) {
        json(response, 401, { error: 'Authentication required.' })
        return
      }

      if (url.pathname === '/api/persotodo/todos' && request.method === 'GET') {
        json(response, 200, { todos: await repository.list() })
        return
      }

      if (url.pathname === '/api/persotodo/todos' && request.method === 'POST') {
        const body = await readJson(request)
        const title = normalizeTitle(body.title)
        if (!title) {
          json(response, 400, { error: 'Title must contain 1 to 500 characters.' })
          return
        }
        json(response, 201, { todo: await repository.create(title) })
        return
      }

      const match = url.pathname.match(/^\/api\/persotodo\/todos\/(\d+)$/)
      if (match && request.method === 'PATCH') {
        const body = await readJson(request)
        const changes = {}
        if (Object.hasOwn(body, 'title')) {
          const title = normalizeTitle(body.title)
          if (!title) {
            json(response, 400, { error: 'Title must contain 1 to 500 characters.' })
            return
          }
          changes.title = title
        }
        if (Object.hasOwn(body, 'completed')) {
          if (typeof body.completed !== 'boolean') {
            json(response, 400, { error: 'Completed must be true or false.' })
            return
          }
          changes.completed = body.completed
        }
        if (Object.keys(changes).length === 0) {
          json(response, 400, { error: 'No supported changes were supplied.' })
          return
        }

        const todo = await repository.update(match[1], changes)
        json(response, todo ? 200 : 404, todo ? { todo } : { error: 'Todo not found.' })
        return
      }

      if (match && request.method === 'DELETE') {
        const removed = await repository.remove(match[1])
        json(response, removed ? 200 : 404, removed ? { deleted: true } : { error: 'Todo not found.' })
        return
      }

      json(response, 404, { error: 'Not found.' })
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500
      if (status === 500) console.error('Persotodo request failed:', error)
      json(response, status, { error: status === 500 ? 'Unexpected server error.' : error.message })
    }
  })
}
