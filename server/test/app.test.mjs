import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'

import { createApiServer } from '../src/app.mjs'
import { createCard } from '../src/board-model.mjs'

const usersByName = new Map()
const usersById = new Map()
const sessions = new Map()
const boards = new Map()
const revisions = new Map()
const saveRequests = new Map()
let nextUserId = 1

const repository = {
  async health() {},
  async createUser({ username, normalizedUsername, passwordHash, initialBoard }) {
    if (usersByName.has(normalizedUsername)) return { conflict: true }
    const user = { id: `user-${nextUserId++}`, username, password_hash: passwordHash }
    usersByName.set(normalizedUsername, user)
    usersById.set(user.id, user)
    boards.set(user.id, { revision: 1, board: structuredClone(initialBoard), updatedAt: new Date() })
    revisions.set(user.id, [])
    return { user }
  },
  async findUserByUsername(normalizedUsername) { return usersByName.get(normalizedUsername) ?? null },
  async createSession(userId, tokenHash, expiresAt) { sessions.set(tokenHash, { userId, expiresAt }) },
  async getSession(tokenHash, at) {
    const session = sessions.get(tokenHash)
    if (!session || session.expiresAt <= at) return null
    return usersById.get(session.userId) ?? null
  },
  async deleteSession(tokenHash) { sessions.delete(tokenHash) },
  async loadBoard(userId) { return boards.has(userId) ? structuredClone(boards.get(userId)) : null },
  async saveBoard({ userId, board, expectedRevision, requestId, contentHash }) {
    const requestKey = `${userId}:${requestId}`
    if (saveRequests.has(requestKey)) {
      const saved = saveRequests.get(requestKey)
      return saved.contentHash === contentHash ? { revision: saved.revision, replayed: true } : { requestConflict: true }
    }
    const state = boards.get(userId)
    if (expectedRevision !== state.revision) return { stale: true, revision: state.revision }
    revisions.get(userId).unshift({ revision: state.revision, board: structuredClone(state.board), savedAt: new Date() })
    const next = { revision: state.revision + 1, board: structuredClone(board), updatedAt: new Date() }
    boards.set(userId, next)
    saveRequests.set(requestKey, { contentHash, revision: next.revision })
    return { revision: next.revision, replayed: false }
  },
  async listRevisions(userId) {
    return revisions.get(userId).map(item => ({ revision: item.revision, savedAt: item.savedAt, cardCount: item.board.cards.length }))
  },
  async getRevision(userId, revision) { return revisions.get(userId).find(item => item.revision === revision) ?? null }
}

const now = () => 1_800_000_000_000
const server = createApiServer({ repository, now })
let baseUrl
let aliceCookie
let bobCookie

async function register(username, password) {
  return fetch(`${baseUrl}/api/persotodo/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
  })
}

async function login(username, password) {
  return fetch(`${baseUrl}/api/persotodo/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
  })
}

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await once(server, 'close')
})

test('health and session status are public while boards require authentication', async () => {
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200)
  const session = await fetch(`${baseUrl}/api/persotodo/session`)
  assert.deepEqual(await session.json(), { authenticated: false, user: null })
  assert.equal((await fetch(`${baseUrl}/api/persotodo/board`)).status, 401)
})

test('account creation validates credentials and prevents case-insensitive duplicates', async () => {
  const weak = await register('ab', 'short')
  assert.equal(weak.status, 400)

  const alice = await register('Alice.Plans', 'correct horse battery staple')
  assert.equal(alice.status, 201)
  aliceCookie = alice.headers.get('set-cookie').split(';')[0]
  assert.match(alice.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/)
  assert.deepEqual((await alice.json()).user.username, 'Alice.Plans')

  const duplicate = await register('alice.plans', 'another long password')
  assert.equal(duplicate.status, 409)

  const bob = await register('Bob', 'bob has a safe password')
  assert.equal(bob.status, 201)
  bobCookie = bob.headers.get('set-cookie').split(';')[0]
})

test('password login is verified and logout invalidates the server-side session', async () => {
  assert.equal((await login('Alice.Plans', 'wrong password value')).status, 401)
  const loggedIn = await login('alice.plans', 'correct horse battery staple')
  assert.equal(loggedIn.status, 200)
  const temporaryCookie = loggedIn.headers.get('set-cookie').split(';')[0]
  const active = await fetch(`${baseUrl}/api/persotodo/session`, { headers: { Cookie: temporaryCookie } })
  assert.equal((await active.json()).user.username, 'Alice.Plans')
  const loggedOut = await fetch(`${baseUrl}/api/persotodo/session`, { method: 'DELETE', headers: { Cookie: temporaryCookie } })
  assert.equal(loggedOut.status, 200)
  assert.equal((await fetch(`${baseUrl}/api/persotodo/board`, { headers: { Cookie: temporaryCookie } })).status, 401)
})

test('boards, save request IDs, revisions, and exports are isolated per user', async () => {
  const aliceLoaded = await fetch(`${baseUrl}/api/persotodo/board`, { headers: { Cookie: aliceCookie } })
  const aliceState = await aliceLoaded.json()
  aliceState.board.cards.push(createCard(aliceState.board, { title: 'Alice private task' }))
  const headers = { Cookie: aliceCookie, 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-Request-ID': 'shared-request-0001' }
  const saved = await fetch(`${baseUrl}/api/persotodo/board`, { method: 'PUT', headers, body: JSON.stringify({ board: aliceState.board }) })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).revision, 2)

  const replay = await fetch(`${baseUrl}/api/persotodo/board`, { method: 'PUT', headers, body: JSON.stringify({ board: aliceState.board }) })
  assert.equal((await replay.json()).replayed, true)

  const bobLoaded = await fetch(`${baseUrl}/api/persotodo/board`, { headers: { Cookie: bobCookie } })
  const bobState = await bobLoaded.json()
  assert.equal(bobState.board.cards.length, 0)
  assert.equal(bobState.revision, 1)
  const bobSave = await fetch(`${baseUrl}/api/persotodo/board`, {
    method: 'PUT',
    headers: { Cookie: bobCookie, 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-Request-ID': 'shared-request-0001' },
    body: JSON.stringify({ board: bobState.board })
  })
  assert.equal(bobSave.status, 200, 'the same request ID is valid in a different user scope')

  const aliceHistory = await fetch(`${baseUrl}/api/persotodo/revisions`, { headers: { Cookie: aliceCookie } })
  const bobHistory = await fetch(`${baseUrl}/api/persotodo/revisions`, { headers: { Cookie: bobCookie } })
  assert.equal((await aliceHistory.json()).revisions.length, 1)
  assert.equal((await bobHistory.json()).revisions.length, 1)

  const aliceExport = await fetch(`${baseUrl}/api/persotodo/export`, { headers: { Cookie: aliceCookie } })
  const bobExport = await fetch(`${baseUrl}/api/persotodo/export`, { headers: { Cookie: bobCookie } })
  assert.equal((await aliceExport.json()).cards[0].title, 'Alice private task')
  assert.equal((await bobExport.json()).cards.length, 0)
})

test('stale and invalid board saves are rejected inside the authenticated user scope', async () => {
  const loaded = await fetch(`${baseUrl}/api/persotodo/board`, { headers: { Cookie: aliceCookie } })
  const { board } = await loaded.json()
  const stale = await fetch(`${baseUrl}/api/persotodo/board`, {
    method: 'PUT',
    headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', 'If-Match': '"1"', 'X-Request-ID': 'stale-request-0002' },
    body: JSON.stringify({ board })
  })
  assert.equal(stale.status, 412)

  board.cards[0].title = ''
  const invalid = await fetch(`${baseUrl}/api/persotodo/board`, {
    method: 'PUT',
    headers: { Cookie: aliceCookie, 'Content-Type': 'application/json', 'If-Match': '"2"', 'X-Request-ID': 'invalid-request-03' },
    body: JSON.stringify({ board })
  })
  assert.equal(invalid.status, 422)
})
