import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword
} from './auth.mjs'
import { createEmptyBoard, validateBoard } from './board-model.mjs'

const COOKIE_NAME = 'clearspace_session'
const SESSION_SECONDS = 60 * 60 * 12
const MAX_BODY_BYTES = 2 * 1024 * 1024
const boardModelSource = await readFile(new URL('./board-model.mjs', import.meta.url), 'utf8')
const dummyPasswordHash = await hashPassword('not-a-real-clearspace-account')

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  response.end(JSON.stringify(body))
}

function attachment(response, filename, body) {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(JSON.stringify(body, null, 2))
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const separator = value.indexOf('=')
    return separator === -1 ? [value, ''] : [value.slice(0, separator), decodeURIComponent(value.slice(separator + 1))]
  }))
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

function clientAddress(request) {
  return request.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? request.socket.remoteAddress ?? 'unknown'
}

function publicUser(user) {
  return { id: user.id, username: user.username }
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function rateLimited(records, key, now, limit, windowMs) {
  const cutoff = now - windowMs
  const record = records.get(key)
  const count = record?.since > cutoff ? record.count : 0
  return { blocked: count >= limit, fail: () => records.set(key, { count: count + 1, since: record?.since > cutoff ? record.since : now }), clear: () => records.delete(key) }
}

export function createApiServer({ repository, now = Date.now }) {
  const failedLogins = new Map()
  const registrations = new Map()

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
      if (url.pathname === '/api/persotodo/board-model.js' && request.method === 'GET') {
        response.writeHead(200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        response.end(boardModelSource)
        return
      }

      const cookies = parseCookies(request.headers.cookie)
      const rawToken = cookies[COOKIE_NAME]
      const user = rawToken ? await repository.getSession(hashSessionToken(rawToken), new Date(now())) : null

      if (url.pathname === '/api/persotodo/session' && request.method === 'GET') {
        json(response, 200, { authenticated: Boolean(user), user: user ? publicUser(user) : null })
        return
      }

      if (url.pathname === '/api/persotodo/users' && request.method === 'POST') {
        const limiter = rateLimited(registrations, clientAddress(request), now(), 10, 60 * 60 * 1000)
        if (limiter.blocked) {
          json(response, 429, { error: 'Too many account creation attempts. Try again later.' })
          return
        }
        const body = await readJson(request)
        const usernameResult = validateUsername(body.username)
        const passwordResult = validatePassword(body.password)
        if (!usernameResult.ok) { limiter.fail(); json(response, 400, { error: usernameResult.error }); return }
        if (!passwordResult.ok) { limiter.fail(); json(response, 400, { error: passwordResult.error }); return }

        const created = await repository.createUser({
          username: usernameResult.username,
          normalizedUsername: usernameResult.normalizedUsername,
          passwordHash: await hashPassword(body.password),
          initialBoard: createEmptyBoard()
        })
        if (created.conflict) {
          limiter.fail()
          json(response, 409, { error: 'That username is already in use.' })
          return
        }
        limiter.clear()
        const token = createSessionToken()
        await repository.createSession(created.user.id, hashSessionToken(token), new Date(now() + SESSION_SECONDS * 1000))
        json(response, 201, { authenticated: true, user: publicUser(created.user) }, { 'Set-Cookie': sessionCookie(token) })
        return
      }

      if (url.pathname === '/api/persotodo/session' && request.method === 'POST') {
        const body = await readJson(request)
        const normalizedUsername = normalizeUsername(body.username)
        const limiter = rateLimited(failedLogins, `${clientAddress(request)}:${normalizedUsername}`, now(), 5, 15 * 60 * 1000)
        if (limiter.blocked) {
          json(response, 429, { error: 'Too many attempts. Try again later.' })
          return
        }
        const account = await repository.findUserByUsername(normalizedUsername)
        const passwordMatches = await verifyPassword(body.password ?? '', account?.password_hash ?? dummyPasswordHash)
        if (!account || !passwordMatches) {
          limiter.fail()
          json(response, 401, { error: 'Incorrect username or password.' })
          return
        }
        limiter.clear()
        const token = createSessionToken()
        await repository.createSession(account.id, hashSessionToken(token), new Date(now() + SESSION_SECONDS * 1000))
        json(response, 200, { authenticated: true, user: publicUser(account) }, { 'Set-Cookie': sessionCookie(token) })
        return
      }

      if (url.pathname === '/api/persotodo/session' && request.method === 'DELETE') {
        if (rawToken) await repository.deleteSession(hashSessionToken(rawToken))
        json(response, 200, { authenticated: false }, { 'Set-Cookie': clearSessionCookie() })
        return
      }

      if (!user) {
        json(response, 401, { error: 'Authentication required.' })
        return
      }

      if (url.pathname === '/api/persotodo/board' && request.method === 'GET') {
        const result = await repository.loadBoard(user.id)
        if (!result) { json(response, 503, { error: 'Your Clearspace board could not be loaded. Check the database before editing.' }); return }
        json(response, 200, result, { ETag: `"${result.revision}"` })
        return
      }

      if (url.pathname === '/api/persotodo/board' && request.method === 'PUT') {
        const match = request.headers['if-match']?.match(/^(?:W\/)?"?(\d+)"?$/)
        if (!match) { json(response, 428, { error: 'If-Match with the loaded revision is required.' }); return }
        const requestId = request.headers['x-request-id']
        if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(requestId)) { json(response, 400, { error: 'A valid X-Request-ID is required.' }); return }
        const body = await readJson(request)
        const validation = validateBoard(body.board)
        if (!validation.ok) { json(response, 422, { error: 'Board validation failed.', details: validation.errors.slice(0, 50) }); return }
        const result = await repository.saveBoard({
          userId: user.id,
          board: body.board,
          expectedRevision: Number(match[1]),
          requestId,
          contentHash: createHash('sha256').update(JSON.stringify(body.board)).digest('hex')
        })
        if (result.requestConflict) { json(response, 409, { error: 'That save request ID was already used for different content.' }); return }
        if (result.stale) { json(response, 412, { error: 'This board is stale. Reload before making more changes.', revision: result.revision }, { ETag: `"${result.revision}"` }); return }
        json(response, 200, result, { ETag: `"${result.revision}"` })
        return
      }

      if (url.pathname === '/api/persotodo/revisions' && request.method === 'GET') {
        json(response, 200, { revisions: await repository.listRevisions(user.id) })
        return
      }
      const revisionMatch = url.pathname.match(/^\/api\/persotodo\/revisions\/(\d+)$/)
      if (revisionMatch && request.method === 'GET') {
        const revision = await repository.getRevision(user.id, Number(revisionMatch[1]))
        if (!revision) { json(response, 404, { error: 'Saved revision not found.' }); return }
        if (url.searchParams.get('download') === '1') { attachment(response, `clearspace-revision-${revision.revision}.json`, revision.board); return }
        json(response, 200, revision)
        return
      }
      if (url.pathname === '/api/persotodo/export' && request.method === 'GET') {
        const result = await repository.loadBoard(user.id)
        if (!result) { json(response, 503, { error: 'Your Clearspace board could not be loaded.' }); return }
        attachment(response, `clearspace-board-revision-${result.revision}.json`, result.board)
        return
      }

      json(response, 404, { error: 'Not found.' })
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500
      if (status === 500) console.error('Clearspace request failed:', error)
      json(response, status, { error: status === 500 ? 'Unexpected server error.' : error.message })
    }
  })
}
