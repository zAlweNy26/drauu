import type { Drauu } from '../drauu'
import type { DrawingMode } from '../types'

import { BucketModel } from './bucket'
import { DrawModel } from './draw'
import { EllipseModel } from './ellipse'
import { EraserModel } from './eraser'
import { HighlighterModel } from './highlighter'
import { LineModel } from './line'
import { RectModel } from './rect'
import { StylusModel } from './stylus'

export function createModels(drauu: Drauu): Record<DrawingMode, DrawModel | StylusModel | LineModel | RectModel | EllipseModel | EraserModel | HighlighterModel | BucketModel> {
  return {
    draw: new DrawModel(drauu),
    stylus: new StylusModel(drauu),
    line: new LineModel(drauu),
    rectangle: new RectModel(drauu),
    ellipse: new EllipseModel(drauu),
    eraseLine: new EraserModel(drauu),
    highlighter: new HighlighterModel(drauu),
    bucket: new BucketModel(drauu),
  }
}

export { BucketModel, DrawModel, EllipseModel, EraserModel, HighlighterModel, LineModel, RectModel, StylusModel }
