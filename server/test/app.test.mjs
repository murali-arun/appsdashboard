import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'

import { createApiServer } from '../src/app.mjs'

const todos = []
let nextId = 1
const repository = {
  async health() {},
  async list() { return [...todos] },
  async create(title) {
    const todo = { id: String(nextId++), title, completed: false }
    todos.unshift(todo)
    return todo
  },
  async update(id, changes) {
    const todo = todos.find(item => item.id === id)
    if (!todo) return null
    Object.assign(todo, changes)
    return todo
  },
  async remove(id) {
    const index = todos.findIndex(item => item.id === id)
    if (index === -1) return false
    todos.splice(index, 1)
    return true
  }
}

const server = createApiServer({
  repository,
  pin: '8787',
  sessionSecret: 'test-session-secret-that-is-long-enough',
  now: () => 1_800_000_000_000
})

let baseUrl
let cookie

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.close()
  await once(server, 'close')
})

test('health endpoint is public', async () => {
  const response = await fetch(`${baseUrl}/healthz`)
  assert.equal(response.status, 200)
})

test('todo list requires authentication', async () => {
  const response = await fetch(`${baseUrl}/api/persotodo/todos`)
  assert.equal(response.status, 401)
})

test('incorrect PIN is rejected', async () => {
  const response = await fetch(`${baseUrl}/api/persotodo/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1111' })
  })
  assert.equal(response.status, 401)
})

test('correct PIN starts a secure session', async () => {
  const response = await fetch(`${baseUrl}/api/persotodo/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '8787' })
  })
  assert.equal(response.status, 200)
  cookie = response.headers.get('set-cookie').split(';')[0]
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/)
})

test('authenticated client can create, update, and remove a todo', async () => {
  const created = await fetch(`${baseUrl}/api/persotodo/todos`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '  First task  ' })
  })
  assert.equal(created.status, 201)
  const { todo } = await created.json()
  assert.equal(todo.title, 'First task')

  const updated = await fetch(`${baseUrl}/api/persotodo/todos/${todo.id}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: true })
  })
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).todo.completed, true)

  const listed = await fetch(`${baseUrl}/api/persotodo/todos`, {
    headers: { Cookie: cookie }
  })
  assert.equal(listed.status, 200)
  assert.equal((await listed.json()).todos.length, 1)

  const removed = await fetch(`${baseUrl}/api/persotodo/todos/${todo.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  })
  assert.equal(removed.status, 200)
})
