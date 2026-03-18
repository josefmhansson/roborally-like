export type Point = { x: number; y: number }
export type RectLike = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

export function getRectCenter(rect: RectLike): Point {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

export function getTransformToPoint(sourceRect: RectLike, targetX: number, targetY: number, scale: number): string {
  const sourceCenter = getRectCenter(sourceRect)
  return `translate(${targetX - sourceCenter.x}px, ${targetY - sourceCenter.y}px) scale(${scale})`
}

export function interpolatePoint(start: Point, end: Point, progress: number): Point {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  }
}
