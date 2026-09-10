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
- Bucket that fills the space around a click, whatever strokes enclose it
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
    mode: 'stylus', // 'draw', 'line', 'rectangle', 'ellipse', 'highlighter', 'eraseLine', 'bucket'
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

## Filling

`bucket` mode fills the space you click in with the brush color, the way a paint
bucket does: the ink around the click is what stops it, however many strokes
that ink came from. A triangle drawn as three separate lines fills, and so does
the inside of a freehand loop. Hold alt while clicking to clear a fill again.

```js
drauu.brush = {
  mode: 'bucket',
  color: 'skyblue', // the color a click fills with
  opacity: 1, // applied to the fill alone, as `fill-opacity`
}
```

The space is found by rasterizing the drawing to a canvas, flooding it outward
from the click until ink stops it, and tracing the flooded pixels back into a
path in SVG user units. Rasterizing runs through `Path2D` rather than through an
`<svg>` image, which keeps a click synchronous — 23ms on a busy 800x500 canvas,
and 50ms for a slide-sized space on a 1600x900 one.

Worth knowing:

- **A space has to be enclosed.** When the flood runs off the edge of the
  drawing the click does nothing, just as a bucket poured into an open shape
  does nothing. Dashed and dotted outlines wall a space off exactly as solid
  ones do, and ink the partial eraser has taken away stops walling anything off
  at all.
- **Paint reaches into a hard angle.** The first attempt floods the ink exactly
  as it rasterized, without thickening it and without counting its antialiased
  skirt, both of which wall a sharp corner off well before the ink itself does
  and leave a white sliver in the corner. Only a space that leaked buys a
  second, forgiving attempt, where walls do grow to bridge the gaps a shaky hand
  leaves behind — at the cost of a little of that sharpness.
- **Islands are kept.** Fill the space between two loops and the inner one stays
  bare; the traced path carries one contour per outline.
- **Paint goes under the strokes**, and over the paint already there, so a fill
  never hides the outlines that shaped it.
- **A space that is exactly one hollow shape's inside is painted through that
  shape**, by setting its own `fill` rather than by adding a node: crisper at any
  zoom, and the paint goes when the shape goes. Every other space becomes a
  traced `<path data-drauu-fill>`, which `dump()` carries, the bucket recolors on
  a second click, and the eraser takes away like any other element.
- **A click on ink repaints the shape it landed on** rather than a space, which
  is how a stylus stroke, or a shape that is already filled, gets recolored.

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
