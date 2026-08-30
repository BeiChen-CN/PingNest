import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateNotificationOrigin,
  notificationScaleFactor,
  normalizeNotificationSize,
  calculateNotificationMaxHeight,
  calculateNotificationWidth,
  normalizeNotificationPosition,
  normalizeNotificationStyle
} from '../shared/notificationMetrics.ts'

const workArea = { x: 100, y: 50, width: 1920, height: 1040 }

test('bottom positions remain anchored after a height change', () => {
  const right = calculateNotificationOrigin('bottom-right', 400, 180, workArea, 20)
  const left = calculateNotificationOrigin('bottom-left', 400, 180, workArea, 20)

  assert.deepEqual(right, { x: 1600, y: 890 })
  assert.deepEqual(left, { x: 120, y: 890 })
  assert.equal(right.y + 180, workArea.y + workArea.height - 20)
})

test('top-center uses the selected display work area', () => {
  assert.deepEqual(
    calculateNotificationOrigin('top-center', 360, 126, workArea, 20),
    { x: 880, y: 70 }
  )
})

test('unknown positions fall back to top-right', () => {
  assert.equal(normalizeNotificationPosition('unknown'), 'top-right')
})

test('nine styles use stable window widths', () => {
  assert.equal(calculateNotificationWidth('top-right', 'tidal'), 400)
  assert.equal(calculateNotificationWidth('top-right', 'terminal'), 460)
  assert.equal(calculateNotificationWidth('top-right', 'mail'), 430)
  assert.equal(calculateNotificationWidth('top-right', 'neon'), 420)
  assert.equal(calculateNotificationWidth('top-right', 'wave'), 400)
  assert.equal(calculateNotificationWidth('top-right', 'scroll'), 330)
  assert.equal(calculateNotificationWidth('top-right', 'halo'), 400)
  assert.equal(calculateNotificationWidth('top-right', 'capsule'), 430)
  assert.equal(calculateNotificationWidth('top-center', 'capsule'), 430)
})

test('hex width grows with the stack to form a honeycomb row', () => {
  assert.equal(calculateNotificationWidth('top-right', 'hex', 1), 116)
  assert.equal(calculateNotificationWidth('top-right', 'hex', 3), 368)
  assert.equal(calculateNotificationWidth('top-right', 'hex', 6), 746)
  // 越界堆叠数收敛到 [1, 6]
  assert.equal(calculateNotificationWidth('top-right', 'hex', 99), 746)
  assert.equal(calculateNotificationWidth('top-right', 'hex', 0), 116)
})

test('per-style max heights stack with card count', () => {
  assert.equal(calculateNotificationMaxHeight('tidal'), 156)
  assert.equal(calculateNotificationMaxHeight('terminal'), 104)
  assert.equal(calculateNotificationMaxHeight('mail'), 204)
  assert.equal(calculateNotificationMaxHeight('neon'), 150)
  assert.equal(calculateNotificationMaxHeight('wave'), 152)
  assert.equal(calculateNotificationMaxHeight('hex'), 148)
  assert.equal(calculateNotificationMaxHeight('scroll'), 150)
  assert.equal(calculateNotificationMaxHeight('halo'), 116)
  assert.equal(calculateNotificationMaxHeight('capsule'), 92)
  // 堆叠：单卡上限 × 卡片数 + 间距（10px）
  assert.equal(calculateNotificationMaxHeight('capsule', 3), 92 * 3 + 20)
  assert.equal(calculateNotificationMaxHeight('capsule', 99), 92 * 6 + 50)
})

test('card size scales window width and height', () => {
  assert.equal(calculateNotificationWidth('top-right', 'terminal', 1, 'large'), Math.round(460 * 1.15))
  assert.equal(calculateNotificationWidth('top-right', 'terminal', 1, 'small'), Math.round(460 * 0.85))
  assert.equal(calculateNotificationWidth('top-right', 'capsule', 1, 'medium'), 430)
  // 蜂巢小尺寸：蜂窝排整体缩放
  assert.equal(calculateNotificationWidth('top-right', 'hex', 3, 'small'), Math.round(368 * 0.85))
  assert.equal(calculateNotificationMaxHeight('capsule', 1, 'large'), Math.round(92 * 1.15))
  assert.equal(calculateNotificationMaxHeight('capsule', 3, 'small'), Math.round((92 * 3 + 20) * 0.85))
})

test('notification size normalization and scale factor', () => {
  assert.equal(normalizeNotificationSize('large'), 'large')
  assert.equal(normalizeNotificationSize('small'), 'small')
  assert.equal(normalizeNotificationSize('unknown'), 'medium')
  assert.equal(notificationScaleFactor('large'), 1.15)
  assert.equal(notificationScaleFactor('small'), 0.85)
  assert.equal(notificationScaleFactor('medium'), 1)
})

test('legacy style ids migrate to their 2026 successors', () => {
  assert.equal(normalizeNotificationStyle('island'), 'capsule')
  assert.equal(normalizeNotificationStyle('standard'), 'tidal')
  assert.equal(normalizeNotificationStyle('compact'), 'terminal')
  assert.equal(normalizeNotificationStyle('layered'), 'tidal')
  assert.equal(normalizeNotificationStyle('minimal'), 'halo')
})

test('new styles pass through; unknown falls back to capsule', () => {
  for (const id of ['tidal', 'terminal', 'mail', 'neon', 'wave', 'hex', 'scroll', 'halo', 'capsule']) {
    assert.equal(normalizeNotificationStyle(id), id)
  }
  assert.equal(normalizeNotificationStyle('unknown'), 'capsule')
})
