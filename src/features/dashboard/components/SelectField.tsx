import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  label: string
  id?: string
  disabled?: boolean
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

export function SelectField({ value, options, onChange, label, id, disabled = false }: Props) {
  const generatedId = useId()
  const triggerId = id || `select-${generatedId}`
  const listId = `${triggerId}-listbox`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectedOption = options[selectedIndex]

  const close = (restoreFocus = false) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    if (option.value !== value) onChange(option.value)
    close(true)
  }

  const openMenu = () => {
    if (disabled || !options.length) return
    setActiveIndex(selectedIndex)
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const desiredHeight = Math.min(menuRef.current?.scrollHeight || options.length * 34 + 8, 224)
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const openAbove = spaceBelow < Math.min(desiredHeight, 152) && spaceAbove > spaceBelow
      const available = Math.max(72, openAbove ? spaceAbove - 4 : spaceBelow - 4)
      const maxHeight = Math.min(224, available)
      const menuHeight = Math.min(desiredHeight, maxHeight)
      setPosition({
        top: openAbove ? Math.max(8, rect.top - menuHeight - 4) : rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
        width: rect.width,
        maxHeight
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.requestAnimationFrame(() => menuRef.current?.focus({ preventScroll: true }))
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'End' ? options.length - 1 : event.key === 'Home' ? 0 : selectedIndex)
      setOpen(true)
    }
  }

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + direction + options.length) % options.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close()
      return
    }
    if (event.key.length === 1) {
      const query = event.key.toLocaleLowerCase()
      const match = options.findIndex((option, index) => index > activeIndex && option.label.toLocaleLowerCase().startsWith(query))
      const wrappedMatch = match >= 0 ? match : options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(query))
      if (wrappedMatch >= 0) setActiveIndex(wrappedMatch)
    }
  }

  return <div className={`select-wrap${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}>
    <button
      ref={triggerRef}
      type="button"
      id={triggerId}
      className="select-trigger"
      disabled={disabled}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      onClick={() => open ? close() : openMenu()}
      onKeyDown={onTriggerKeyDown}
    >
      <span>{selectedOption?.label || ''}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div
      ref={menuRef}
      id={listId}
      className="custom-select-menu"
      role="listbox"
      tabIndex={-1}
      aria-label={label}
      aria-activedescendant={`${listId}-option-${activeIndex}`}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, width: position?.width, maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}
      onKeyDown={onMenuKeyDown}
    >
      {options.map((option, index) => <button
        type="button"
        id={`${listId}-option-${index}`}
        role="option"
        aria-selected={option.value === value}
        key={option.value}
        className={`custom-select-option${option.value === value ? ' selected' : ''}${index === activeIndex ? ' active' : ''}`}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(index)}
      >
        <Check size={13} aria-hidden="true" />
        <span>{option.label}</span>
      </button>)}
    </div>, document.body)}
  </div>
}
