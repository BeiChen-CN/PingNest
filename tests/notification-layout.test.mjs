import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateNotificationOrigin,
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

test('notification styles use stable window widths', () => {
  assert.equal(calculateNotificationWidth('top-right', 'standard'), 400)
  assert.equal(calculateNotificationWidth('top-center', 'standard'), 360)
  assert.equal(calculateNotificationWidth('top-right', 'compact'), 344)
  assert.equal(calculateNotificationWidth('top-right', 'layered'), 420)
  assert.equal(calculateNotificationWidth('top-right', 'minimal'), 360)
  assert.equal(calculateNotificationMaxHeight('compact'), 96)
  assert.equal(calculateNotificationMaxHeight('standard'), 180)
  assert.equal(calculateNotificationMaxHeight('layered'), 190)
  assert.equal(normalizeNotificationStyle('unknown'), 'standard')
})
