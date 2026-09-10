import type { Brush, DrawingMode } from 'drauu'
import { createDrauu } from 'drauu'
import 'virtual:windi.css'
import './style.css'

const drauu = createDrauu({
  el: '#svg',
  brush: {
    color: '#000000',
    size: 3,
  },
  // acceptsInputTypes: ['pen'],
})

const sizeEl = document.getElementById('size')! as HTMLInputElement
sizeEl.addEventListener('input', () => drauu.brush.size = +sizeEl.value)

const modeShortcuts: Record<string, string> = {
  KeyS: 'm-stylus',
  KeyD: 'm-draw',
  KeyH: 'm-highlighter',
  KeyL: 'm-line',
  KeyR: 'm-rect',
  KeyE: 'm-ellipse',
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
    if (e.shiftKey)
      drauu.redo()
    else
      drauu.undo()
    return
  }

  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
    return

  // Click the toolbar button rather than setting `drauu.mode` directly, so the
  // shortcut also applies that tool's brush preset (notably resetting `opacity`
  // after the highlighter) and moves the `active` highlight.
  if (modeShortcuts[e.code]) {
    document.getElementById(modeShortcuts[e.code])!.click()
  }
  else if (e.code === 'KeyC') {
    drauu.clear()
  }
  else if (e.code === 'Equal') {
    drauu.brush.size = Math.min(40, drauu.brush.size + 0.5)
    sizeEl.value = `${drauu.brush.size}`
  }
  else if (e.code === 'Minus') {
    drauu.brush.size = Math.max(1, drauu.brush.size - 0.5)
    sizeEl.value = `${drauu.brush.size}`
  }
})

document.getElementById('undo')?.addEventListener('click', () => drauu.undo())
document.getElementById('redo')?.addEventListener('click', () => drauu.redo())
document.getElementById('clear')?.addEventListener('click', () => drauu.clear())
document.getElementById('download')?.addEventListener('click', () => {
  drauu.el!.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const data = drauu.el!.outerHTML || ''
  const blob = new Blob([data], { type: 'image/svg+xml' })
  const elem = window.document.createElement('a')
  elem.href = window.URL.createObjectURL(blob)
  elem.download = 'drauu.svg'
  document.body.appendChild(elem)
  elem.click()
  document.body.removeChild(elem)
})

const colors = Array.from(document.querySelectorAll('[data-color]')) as HTMLElement[]
colors.forEach((i) => {
  i.addEventListener('click', () => {
    colors.forEach(i => i.classList.remove('active'))
    i.classList.add('active')
    drauu.brush.color = i.dataset.color!
  })
})

/**
 * Every tool keeps its own color / size / opacity, so switching to the
 * highlighter (fat, translucent, yellow) and back doesn't leave the pen fat,
 * translucent and yellow. Adjustments made while a tool is active are
 * remembered for that tool alone.
 */
type ToolState = Required<Pick<Brush, 'color' | 'size' | 'opacity'>>

interface Tool {
  el: HTMLElement
  mode: DrawingMode
  arrowEnd: boolean
  state: ToolState
}

const PEN: ToolState = { color: '#000000', size: 3, opacity: 1 }
const HIGHLIGHTER: ToolState = { color: '#ede215', size: 20, opacity: 0.4 }

function tool(id: string, mode: DrawingMode, state: ToolState = PEN, arrowEnd = false): Tool {
  return { el: document.getElementById(id)!, mode, arrowEnd, state: { ...state } }
}

const tools: Tool[] = [
  tool('m-stylus', 'stylus'),
  tool('m-eraser', 'eraseLine'),
  tool('m-draw', 'draw'),
  tool('m-highlighter', 'highlighter', HIGHLIGHTER),
  tool('m-line', 'line'),
  tool('m-arrow', 'line', PEN, true),
  tool('m-rect', 'rectangle'),
  tool('m-ellipse', 'ellipse'),
]

// `m-stylus` is the one carrying the `active` class in index.html.
let activeTool = tools[0]

function activate(next: Tool) {
  // Snapshot the outgoing tool before the shared brush is overwritten.
  activeTool.state = {
    color: drauu.brush.color,
    size: drauu.brush.size,
    opacity: drauu.brush.opacity ?? 1,
  }
  activeTool = next

  tools.forEach(({ el }) => el.classList.remove('active'))
  next.el.classList.add('active')

  drauu.brush.arrowEnd = next.arrowEnd
  Object.assign(drauu.brush, next.state)
  // `mode` is assigned last, and through the setter, so `onUnselected` still
  // reaches the model we are leaving rather than the one we are entering.
  drauu.mode = next.mode

  sizeEl.value = `${next.state.size}`
  colors.forEach(c => c.classList.toggle('active', c.dataset.color === next.state.color))
}

tools.forEach(t => t.el.addEventListener('click', () => activate(t)))

const lines: { el: HTMLElement, value: string | undefined }[] = [
  { el: document.getElementById('l-solid')!, value: undefined },
  { el: document.getElementById('l-dashed')!, value: '4' },
  { el: document.getElementById('l-dotted')!, value: '1 7' },
]

lines.forEach(({ el, value }) => {
  el.addEventListener('click', () => {
    lines.forEach(({ el }) => el.classList.remove('active'))
    el.classList.add('active')
    drauu.brush.dasharray = value
  })
})
