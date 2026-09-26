const path = require('path')
const { writePsdBuffer } = require('ag-psd')

const exporterCommon = require('./common')

/*
interface Meta {
  name: string,
  canvas: HTMLCanvasElement,
  opacity?: number
}
*/
const toPsdBuffer = async metas => {
  let psd = {
    width: 0,
    height: 0,
    imageResources: {
      // TODO what does this mean? why 3?
      layerSelectionIds: [3],
      // tells readers the flattened image is real (see psd.canvas below)
      versionInfo: {
        hasRealMergedData: true,
        writerName: 'Storyboarder',
        readerName: 'Storyboarder',
        fileVersion: 1
      }
    },
    children: [
      {
        id: 1,
        name: 'Background',
        canvas: undefined
      }
    ]
  }

  let id = 2 // 1 = Background, 2 = Layer #1
  for (let meta of metas) {
    // hack
    // "fix for external editor in storyboarder spec for clip studio pro"
    // see: https://github.com/wonderunit/storyboarder/commit/d22dd34
    //
    // only if the corner pixel is empty, so the pixel doesn't darken
    // every time the board makes a round trip through the PSD
    let context = meta.canvas.getContext('2d')
    if (context.getImageData(0, 0, 1, 1).data[3] === 0) {
      context.fillStyle = 'rgba(0, 0, 0, 0.1)'
      context.fillRect(0, 0, 1, 1)
    }

    psd.children.push({
      id, // 
      name: meta.name,
      canvas: meta.canvas,
      opacity: meta.opacity
    })

    psd.width = meta.canvas.width > psd.width ? meta.canvas.width : psd.width
    psd.height = meta.canvas.height > psd.height ? meta.canvas.height : psd.height

    id++
  }

  // generate a canvas for the Background layer
  let canvas = document.createElement('canvas')
  canvas.width = psd.width
  canvas.height = psd.height
  var context = canvas.getContext('2d')
  context.fillStyle = 'white'
  context.fillRect(0, 0, canvas.width, canvas.height)
  psd.children[0].canvas = canvas

  // generate the flattened image
  // without it, apps that only read the flattened image see a black board
  let composite = document.createElement('canvas')
  composite.width = psd.width
  composite.height = psd.height
  let compositeContext = composite.getContext('2d')
  compositeContext.drawImage(canvas, 0, 0)
  for (let meta of metas) {
    compositeContext.globalAlpha = meta.opacity == null ? 1 : meta.opacity
    compositeContext.drawImage(meta.canvas, 0, 0)
  }
  psd.canvas = composite

  return writePsdBuffer(psd)
}

module.exports = {
  toPsdBuffer
}
