// npx electron-mocha --renderer test/importers/psd.renderer.test.js
// find test/importers/psd.renderer.test.js | entr -c electron-mocha --renderer test/importers/psd.renderer.test.js

const path = require('path')
const fs = require('fs-extra')
const assert = require('assert')
const { writePsdBuffer } = require('ag-psd')

const importerPsd = require('../../src/js/importers/psd')
const exporterPsd = require('../../src/js/exporters/psd')

const fixturesPath = path.join(__dirname, '..', 'fixtures')
const psdPath = path.join(fixturesPath, 'psd', 'images', 'board-1-XCAKU.psd')

const WIDTH = 160
const HEIGHT = 90

const createCanvas = (draw, width = WIDTH, height = HEIGHT) => {
  let canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  if (draw) draw(canvas.getContext('2d'))
  return canvas
}

const pixel = (canvas, x, y) =>
  Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)

const drawRed = context => {
  context.fillStyle = 'red'
  context.fillRect(10, 10, 20, 20)
}
const drawBlue = context => {
  context.fillStyle = 'blue'
  context.fillRect(50, 20, 20, 20)
}
const drawWhite = context => {
  context.fillStyle = 'white'
  context.fillRect(0, 0, WIDTH, HEIGHT)
}

// a board as exported by main-window#openInEditor, with art on the reference and ink layers
const exportBoard = ({ referenceOpacity = 0.5 } = {}) =>
  exporterPsd.toPsdBuffer(
    importerPsd.BOARD_LAYER_NAMES.map(name => ({
      name,
      canvas: createCanvas(
        name === 'reference' ? drawRed : name === 'ink' ? drawBlue : null
      ),
      opacity: name === 'reference' ? referenceOpacity : undefined
    }))
  )

// a PSD as saved by an external editor
const writeEditedPsd = ({ children, hasRealMergedData = true }) => {
  let composite = createCanvas(drawWhite)
  const drawLayers = layers => {
    for (let layer of layers) {
      if (layer.hidden) continue
      if (layer.canvas) composite.getContext('2d').drawImage(layer.canvas, 0, 0)
      if (layer.children) drawLayers(layer.children)
    }
  }
  drawLayers(children)
  return writePsdBuffer({
    width: WIDTH,
    height: HEIGHT,
    imageResources: {
      versionInfo: {
        hasRealMergedData,
        writerName: 'Adobe Photoshop',
        readerName: 'Adobe Photoshop 2026',
        fileVersion: 1
      }
    },
    canvas: hasRealMergedData ? composite : createCanvas(drawWhite),
    children: [
      { name: 'Background', canvas: createCanvas(drawWhite) },
      ...children
    ]
  })
}

const read = buffer =>
  importerPsd.fromPsdBufferForBoard(Buffer.from(buffer), { width: WIDTH, height: HEIGHT })

describe('importers/psd', () => {
  it('can load a PSD file and read the flattened canvas', () => {
    let canvas = importerPsd.fromPsdBufferComposite(
      fs.readFileSync(psdPath)
    )
    assert.equal(canvas.width, 1600)
    assert.equal(canvas.height, 900)
  })

  it('reads the board layers of a PSD saved by Photoshop', () => {
    let { layers, flattenedReason } = importerPsd.fromPsdBufferForBoard(
      fs.readFileSync(psdPath),
      { width: 1600, height: 900 }
    )

    assert.equal(flattenedReason, undefined)
    for (let name of Object.keys(layers)) {
      assert(importerPsd.BOARD_LAYER_NAMES.includes(name))
      assert.equal(layers[name].width, 1600)
      assert.equal(layers[name].height, 900)
    }
    // the fixture's reference layer is offset to (100, 56)
    assert(layers.reference)
    assert.equal(pixel(layers.reference, 99, 55)[3], 0)
  })

  it('reads back the layers of an exported board', async () => {
    let { layers, flattenedReason } = read(await exportBoard())

    assert.equal(flattenedReason, undefined)
    assert.deepEqual(Object.keys(layers).sort(), ['ink', 'reference'])
    // reference layer opacity is not baked into its pixels
    assert.deepEqual(pixel(layers.reference, 15, 15), [255, 0, 0, 255])
    assert.deepEqual(pixel(layers.reference, 40, 40), [0, 0, 0, 0])
    assert.deepEqual(pixel(layers.ink, 55, 25), [0, 0, 255, 255])
  })

  it('does not leave the export marker on imported layers', async () => {
    let { layers } = read(await exportBoard())
    assert.deepEqual(pixel(layers.reference, 0, 0), [0, 0, 0, 0])
    assert.deepEqual(pixel(layers.ink, 0, 0), [0, 0, 0, 0])
  })

  it('exports a real flattened image', async () => {
    let composite = importerPsd.fromPsdBufferComposite(Buffer.from(await exportBoard()))
    // red at 50% over white
    let [r, g, b, a] = pixel(composite, 15, 15)
    assert.equal(r, 255)
    assert(Math.abs(g - 127) <= 1 && Math.abs(b - 127) <= 1)
    assert.equal(a, 255)
    assert.deepEqual(pixel(composite, 55, 25), [0, 0, 255, 255])
    assert.deepEqual(pixel(composite, 100, 80), [255, 255, 255, 255])
  })

  it('ignores hidden layers', () => {
    let { layers, flattenedReason } = read(writeEditedPsd({
      children: [
        { name: 'reference', canvas: createCanvas(drawRed) },
        { name: 'Layer 1', canvas: createCanvas(drawBlue), hidden: true },
        { name: 'ink', canvas: createCanvas(drawBlue), hidden: true }
      ]
    }))
    assert.equal(flattenedReason, undefined)
    assert.deepEqual(Object.keys(layers), ['reference'])
  })

  describe('uses the flattened image as the reference layer', () => {
    const assertFlattened = (buffer, reasonPattern) => {
      let { layers, flattenedReason } = read(buffer)
      assert.match(flattenedReason, reasonPattern)
      assert.deepEqual(Object.keys(layers), ['reference'])
      assert.deepEqual(pixel(layers.reference, 15, 15), [255, 0, 0, 255])
      assert.deepEqual(pixel(layers.reference, 55, 25), [0, 0, 255, 255])
      assert.deepEqual(pixel(layers.reference, 100, 80), [255, 255, 255, 255])
    }

    it('when a layer was added', () => {
      assertFlattened(writeEditedPsd({
        children: [
          { name: 'reference', canvas: createCanvas(drawRed) },
          { name: 'Layer 1', canvas: createCanvas(drawBlue) }
        ]
      }), /Layer 1/)
    })

    it('when a layer has a blend mode', () => {
      assertFlattened(writeEditedPsd({
        children: [
          { name: 'reference', canvas: createCanvas(drawRed) },
          { name: 'ink', canvas: createCanvas(drawBlue), blendMode: 'multiply' }
        ]
      }), /ink/)
    })

    it('when layers were reordered', () => {
      assertFlattened(writeEditedPsd({
        children: [
          { name: 'ink', canvas: createCanvas(drawBlue) },
          { name: 'reference', canvas: createCanvas(drawRed) }
        ]
      }), /reordered/)
    })

    it('when layers were grouped', () => {
      assertFlattened(writeEditedPsd({
        children: [
          { name: 'reference', canvas: createCanvas(drawRed) },
          { name: 'ink', children: [{ name: 'ink', canvas: createCanvas(drawBlue) }] }
        ]
      }), /ink/)
    })

    it('when the Background layer was drawn on', () => {
      let buffer = writeEditedPsd({
        children: [{ name: 'reference', canvas: createCanvas(drawRed) }]
      })
      // draw on the Background layer
      let background = createCanvas(context => {
        drawWhite(context)
        drawBlue(context)
      })
      let composite = createCanvas(context => {
        context.drawImage(background, 0, 0)
        drawRed(context)
      })
      buffer = writePsdBuffer({
        width: WIDTH,
        height: HEIGHT,
        imageResources: { versionInfo: { hasRealMergedData: true, writerName: '', readerName: '', fileVersion: 1 } },
        canvas: composite,
        children: [
          { name: 'Background', canvas: background },
          { name: 'reference', canvas: createCanvas(drawRed) }
        ]
      })
      assertFlattened(buffer, /Background/)
    })

    it('when the size changed', async () => {
      let { flattenedReason } = importerPsd.fromPsdBufferForBoard(
        Buffer.from(await exportBoard()),
        { width: WIDTH * 2, height: HEIGHT * 2 }
      )
      assert.match(flattenedReason, /size/)
    })
  })

  it('refuses a flattened image that Photoshop saved without Maximize Compatibility', () => {
    let buffer = Buffer.from(writeEditedPsd({
      hasRealMergedData: false,
      children: [
        { name: 'reference', canvas: createCanvas(drawRed) },
        { name: 'Layer 1', canvas: createCanvas(drawBlue) }
      ]
    }))
    assert.throws(() => read(buffer), /Maximize PSD and PSB File Compatibility/)
    assert.throws(() => importerPsd.fromPsdBufferComposite(buffer), /Maximize PSD and PSB File Compatibility/)
  })

  it('does not need the flattened image to read board layers', () => {
    let { layers, flattenedReason } = read(writeEditedPsd({
      hasRealMergedData: false,
      children: [
        { name: 'reference', canvas: createCanvas(drawRed) },
        { name: 'ink', canvas: createCanvas(drawBlue) }
      ]
    }))
    assert.equal(flattenedReason, undefined)
    assert.deepEqual(Object.keys(layers).sort(), ['ink', 'reference'])
  })
})
