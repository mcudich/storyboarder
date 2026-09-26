const { readPsd, initializeCanvas } = require('ag-psd')

// the board layers written to a linked PSD by exporters/psd, bottom to top
const BOARD_LAYER_NAMES = [
  'shot-generator',
  'reference',
  'fill',
  'tone',
  'pencil',
  'ink',
  'notes'
]

const NO_COMPOSITE_MESSAGE =
  'This PSD was saved without a flattened image, so Storyboarder can’t read it. ' +
  'In Photoshop, set Settings > File Handling > ' +
  '“Maximize PSD and PSB File Compatibility” to Always, then save the file again.'

const readPsdBuffer = buffer => {
  // setup the PSD reader's initializeCanvas function
  initializeCanvas(
    (width, height) => {
      let canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas
    }
  )

  return readPsd(buffer)
}

// Photoshop only stores a real flattened image when "Maximize PSD and PSB File Compatibility" is on.
// Otherwise the flattened image is a solid white placeholder.
const getComposite = psd => {
  let versionInfo = psd.imageResources && psd.imageResources.versionInfo
  if (!psd.canvas || (versionInfo && versionInfo.hasRealMergedData === false)) {
    throw new Error(NO_COMPOSITE_MESSAGE)
  }
  return psd.canvas
}

const hasEnabledEffects = layer =>
  layer.effects != null &&
  !layer.effects.disabled &&
  Object.values(layer.effects)
    .reduce((all, effect) => all.concat(effect), [])
    .some(effect => effect != null && effect.enabled)

// true if the layer draws exactly like its pixels stacked on the layers below
const isPlainLayer = layer =>
  layer.children == null &&
  (layer.blendMode == null || layer.blendMode === 'normal') &&
  (layer.fillOpacity == null || layer.fillOpacity === 1) &&
  !layer.clipping &&
  !(layer.mask && !layer.mask.disabled) &&
  !layer.vectorMask &&
  !layer.adjustment &&
  !hasEnabledEffects(layer)

// exporters/psd marks each layer with a faint pixel in its corner (the Clip Studio hack)
const removeExportMarker = canvas => {
  let context = canvas.getContext('2d')
  let [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  if (r === 0 && g === 0 && b === 0 && (a === 25 || a === 26)) {
    context.clearRect(0, 0, 1, 1)
  }
}

const isTransparent = canvas => {
  let { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false
  }
  return true
}

const isWhiteOrTransparent = canvas => {
  let { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 0 && (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)) {
      return false
    }
  }
  return true
}

// Reads the PSD's layers back into board layers, if it still has only the layers
// Storyboarder wrote (in the same order, with nothing that changes how they draw).
// Returns a reason string if it can't.
const readBoardLayers = (psd, { width, height }) => {
  if (!psd.children) return 'it has no layers'
  if (psd.width !== width || psd.height !== height) return 'its size doesn’t match the board'

  let layers = {}
  let position = -1

  for (let layer of psd.children) {
    // hidden layers aren't in the flattened image either
    if (layer.hidden) continue

    // the white Background layer written by exporters/psd, left alone
    if (layer.name === 'Background' && position === -1 && !layer.children) {
      if (!layer.canvas || isWhiteOrTransparent(layer.canvas)) continue
      return 'its Background layer was drawn on'
    }

    let name = layer.name.toLowerCase()
    let layerPosition = BOARD_LAYER_NAMES.indexOf(name)
    if (layerPosition === -1) return `it has a layer Storyboarder doesn’t use (“${layer.name}”)`
    if (layerPosition <= position) return 'its layers were reordered or duplicated'
    if (!isPlainLayer(layer)) return `its “${layer.name}” layer uses a group, mask, blend mode, or effect`
    position = layerPosition

    let canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    let context = canvas.getContext('2d')

    // reference layer opacity is a board setting (the layers slider),
    // other layers keep theirs in their pixels
    if (name !== 'reference') {
      context.globalAlpha = layer.opacity
    }

    if (!layer.canvas) continue

    // the PSD layer canvas may have a smaller rect
    context.drawImage(layer.canvas, layer.left || 0, layer.top || 0)
    removeExportMarker(canvas)

    // leave out empty layers, like the board does
    if (isTransparent(canvas)) continue

    layers[name] = canvas
  }

  return { layers }
}

/**
 * Reads a PSD linked to a board.
 *
 * Returns { layers, flattenedReason }
 *   layers: canvases by board layer name. board layers not present should be cleared.
 *   flattenedReason: if set, the PSD's flattened image was used as the reference layer, because of this reason
 *
 * Throws if the PSD can't be read.
 */
const fromPsdBufferForBoard = (buffer, { width, height }) => {
  let psd = readPsdBuffer(buffer)

  let result = readBoardLayers(psd, { width, height })
  if (typeof result !== 'string') return result

  return {
    layers: { reference: getComposite(psd) },
    flattenedReason: result
  }
}

const fromPsdBufferComposite = buffer => getComposite(readPsdBuffer(buffer))

module.exports = {
  BOARD_LAYER_NAMES,
  fromPsdBufferForBoard,
  fromPsdBufferComposite
}
