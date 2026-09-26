// npx electron-mocha test/window/linked-file-manager.main.test.js

const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const assert = require('assert')

const LinkedFileManager = require('../../src/js/window/linked-file-manager')

describe('LinkedFileManager', () => {
  let projectPath
  let linkedFileManager
  let board = { link: 'board-1-ABCDE.psd' }

  const psdPath = () => path.join(projectPath, 'images', board.link)
  const mtime = () => fs.statSync(psdPath()).mtimeMs

  const activate = async () => {
    let imported = []
    await linkedFileManager.activateBoard(board, filename => imported.push(filename))
    return imported
  }

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-file-manager-'))
    fs.mkdirpSync(path.join(projectPath, 'images'))
    fs.writeFileSync(psdPath(), 'psd')
    linkedFileManager = new LinkedFileManager({
      storyboarderFilePath: path.join(projectPath, 'example.storyboarder')
    })
  })

  afterEach(() => {
    fs.removeSync(projectPath)
  })

  it('does not import an unchanged file', async () => {
    linkedFileManager.addBoard(board)
    assert.deepEqual(await activate(), [])
  })

  it('imports a file saved after it was added', async () => {
    linkedFileManager.addBoard(board)
    let later = new Date(Date.now() + 10000)
    fs.utimesSync(psdPath(), later, later)

    assert.deepEqual(await activate(), [board.link])
    // only once
    assert.deepEqual(await activate(), [])
  })

  it('imports a file saved after the given timestamp', async () => {
    linkedFileManager.addBoard(board, { timestamp: mtime() - 1000 })
    assert.deepEqual(await activate(), [board.link])
  })

  it('does not import a file saved before the given timestamp', async () => {
    linkedFileManager.addBoard(board, { timestamp: mtime() + 1000 })
    assert.deepEqual(await activate(), [])
  })

  it('does not import a missing file', async () => {
    linkedFileManager.addBoard(board, { timestamp: 0 })
    fs.removeSync(psdPath())
    assert.deepEqual(await activate(), [])
  })
})
