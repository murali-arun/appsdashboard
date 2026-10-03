import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hashPassword, normalizeUsername, validatePassword, validateUsername, verifyPassword } from '../src/auth.mjs'

test('password hashes are salted and verify without storing plaintext', async () => {
  const password = 'a deliberate long password'
  const first = await hashPassword(password)
  const second = await hashPassword(password)
  assert.notEqual(first, second)
  assert.doesNotMatch(first, new RegExp(password))
  assert.equal(await verifyPassword(password, first), true)
  assert.equal(await verifyPassword('the wrong password', first), false)
})

test('username and password validation use predictable account rules', () => {
  assert.equal(normalizeUsername('  Alice.Plans '), 'alice.plans')
  assert.equal(validateUsername('Alice.Plans').ok, true)
  assert.equal(validateUsername('two words').ok, false)
  assert.equal(validatePassword('too-short').ok, false)
  assert.equal(validatePassword('long enough password').ok, true)
})
