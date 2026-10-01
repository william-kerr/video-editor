// One portal keeps compact tooltips outside scrolling panels and clipped headers.
export function installTooltips() {
  let timer = 0
  let current: HTMLElement | null = null
  let box: HTMLDivElement | null = null
  const hide = () => { clearTimeout(timer); box?.remove(); box = null; current = null }
  const show = (target: HTMLElement) => {
    hide(); current = target
    if (!target.dataset.tip || (target instanceof HTMLButtonElement && target.disabled)) return
    timer = window.setTimeout(() => {
      if (current !== target) return
      box = document.createElement('div'); box.className = 'tooltip'; box.role = 'tooltip'; box.textContent = target.dataset.tip!
      document.body.append(box)
      const rect = target.getBoundingClientRect(), bounds = box.getBoundingClientRect()
      box.style.left = `${Math.max(7, Math.min(innerWidth - bounds.width - 7, rect.left + rect.width / 2 - bounds.width / 2))}px`
      box.style.top = `${rect.bottom + bounds.height + 12 < innerHeight ? rect.bottom + 6 : rect.top - bounds.height - 6}px`
    }, 500)
  }
  document.addEventListener('pointerover', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]'); if (target && target !== current) show(target); else if (!target) hide() })
  document.addEventListener('pointerout', event => { if (current && !(event.relatedTarget instanceof Node && current.contains(event.relatedTarget))) hide() })
  document.addEventListener('pointerdown', hide)
  document.addEventListener('keydown', hide)
  document.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
}
