# drauu

[![NPM version](https://img.shields.io/npm/v/drauu?color=a1b858&label=)](https://www.npmjs.com/package/drauu)

SVG-based drawing tool in browser. Built for [Slidev](https://github.com/slidevjs/slidev).

[Live Demo](http://drauu.netlify.app/) (built with Vanilla JavaScript!)

## Features

- Vanilla JavaScript - integrate into any framework you like
- SVG-based - scalable, transparent, and serializable
- Stylus / Touch pressure support
- Translucent highlighter, with a per-brush `opacity` honored by every tool
- Eraser that takes away whole strokes, or only the ink it passes over
- Headless (unstyled) - style it as you want
- Undo / Redo stacks

## Install

```bash
npm i drauu
```

```html
<svg id="svg"></svg>
```

```js
import { createDrauu } from 'drauu'

const drauu = createDrauu({
  el: '#svg',
  brush: {
    mode: 'stylus', // 'draw', 'line', 'rectangle', 'ellipse', 'highlighter', 'eraseLine'
    color: 'skyblue',
    size: 5,
  }
})

// change brush color
drauu.options.brush.color = 'red'
```

## Erasing

`eraseLine` mode erases whole strokes: any element the eraser crosses is removed
outright. Set `eraseMode: 'partial'` to erase like a real eraser instead, taking
away only the ink the tip actually passes over and leaving the rest of the stroke
where it is.

```js
drauu.brush = {
  mode: 'eraseLine',
  eraseMode: 'partial', // 'element' (default) | 'partial'
  size: 24, // in 'partial' mode, the width of the eraser tip
}
```

The partial eraser does not cut geometry. It paints each erase stroke into a
shared `<mask>` and points every element it has touched at that mask, which is
why it costs the same per frame as drawing one path, and why it works the same on
a `stylus` stroke (a filled outline) as on a `rectangle` (a stroked shape).

Two consequences worth knowing:

- Erased ink stays in the document, invisible. `dump()` output grows rather than
  shrinks, and a stroke rubbed out completely is still a node in the DOM.
- `dump()` / `load()` round-trip correctly, because the mask travels with the
  markup under a fixed id (`drauu-eraser-mask`). That fixed id is also document
  wide, so two drauu instances on one page would share one mask.

## Credits

Inspired by

- [scribby](https://github.com/naknomum/scribby) by [naknomum](https://github.com/naknomum)
- [excalidraw](https://github.com/excalidraw/excalidraw)
- [draw](https://github.com/amoshydra/draw) by [amoshydra](https://github.com/amoshydra)
- [live-draw](https://github.com/antfu/live-draw) by [antfu](https://github.com/antfu)

Thanks!

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg'/>
  </a>
</p>

## License

MIT
