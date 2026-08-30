import { useEffect, useRef, useState } from 'react'

/**
 * 数字滚动计数：从上一次值缓动到目标值（ease-out cubic）。
 * 首挂从 0 起滚；prefers-reduced-motion 直接取目标值。
 */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduced) { setValue(target); fromRef.current = target; return }
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduced])

  return value
}
