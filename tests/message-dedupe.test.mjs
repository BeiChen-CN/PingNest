import test from 'node:test'
import assert from 'node:assert/strict'
import { TtlKeyCache } from '../electron/services/messageDedupe.ts'

test('TtlKeyCache：remember 后 has 命中', () => {
  const cache = new TtlKeyCache(60_000)
  cache.remember('a')
  assert.equal(cache.has('a'), true)
  assert.equal(cache.has('b'), false)
})

test('TtlKeyCache：TTL 过期后不再命中', async () => {
  const cache = new TtlKeyCache(15)
  cache.remember('a')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(cache.has('a'), false)
})

test('TtlKeyCache：clear 清空全部', () => {
  const cache = new TtlKeyCache(60_000)
  cache.remember('a')
  cache.remember('b')
  cache.clear()
  assert.equal(cache.has('a'), false)
  assert.equal(cache.has('b'), false)
})
