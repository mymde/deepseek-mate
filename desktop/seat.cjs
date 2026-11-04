'use strict'

// The physical top edge is used whenever there is room for her head. At the screen's top
// (including maximised windows) use an explicitly inset seat, rather than reject the window.
function seatRect(rect, size, viewport) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const margin = size * 0.35
  const left = Math.max(0, rect.left)
  const right = Math.min(viewport.width, rect.left + rect.width)
  if (right - left < margin * 2) return null
  const top = Math.max(rect.top, size * 0.82 + 8)
  if (top > viewport.height - size * 0.3 || top > rect.top + rect.height) return null
  return { left, top, width: right - left, height: Math.max(1, rect.height - (top - rect.top)), inset: top !== rect.top }
}

module.exports = { seatRect }
