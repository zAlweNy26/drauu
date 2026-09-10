import type { Point } from '../types'
import { DrawModel } from './draw'

export class HighlighterModel extends DrawModel {
  override onStart(point: Point) {
    const el = super.onStart(point)

    this.attr('stroke-linecap', 'butt')
    this.attr('stroke-linejoin', 'round')
    this.attr('opacity', (this.brush.opacity ?? 0.4).toString())

    return el
  }
}
