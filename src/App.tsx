import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  IMAGE_DIMENSION,
  brushColor,
  convertImageDataMode,
  discoverAddress,
  formatAddress,
  generateRandomAddress,
  getImageStats,
  restoreAddress,
  type AddressDescriptor,
  type ImageMode,
} from './lib/infiniteCanvas'

type StudioTool = 'brush' | 'eraser' | 'fill' | 'sample'
type FlipDirection = 'forward' | 'backward'

interface ScrapbookPage {
  id: string
  mode: ImageMode
  address: string
  descriptor: AddressDescriptor
  payload: Uint8Array
  libraryId: string
  imageData: ImageData
  imageUrl: string
  label: string
}

const HISTORY_LIMIT = 24
const SCRAPBOOK_RADIUS = 1
const COLOR_SWATCHES = [
  '#ffffff',
  '#ffd166',
  '#ff7b72',
  '#7dd3fc',
  '#a78bfa',
  '#22c55e',
  '#f97316',
  '#0f172a',
]
const GRAYSCALE_SWATCHES = [255, 220, 176, 128, 92, 52, 24, 0]

function App() {
  const studioCanvasRef = useRef<HTMLCanvasElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const drawingRef = useRef({ active: false, x: 0, y: 0 })
  const undoStackRef = useRef<Uint8ClampedArray[]>([])
  const redoStackRef = useRef<Uint8ClampedArray[]>([])
  const [mode, setMode] = useState<ImageMode>('color')
  const [tool, setTool] = useState<StudioTool>('brush')
  const [libraryKey, setLibraryKey] = useState('inflib.io')
  const [scrapbookKey, setScrapbookKey] = useState('inflib.io')
  const [brushSize, setBrushSize] = useState(18)
  const [brushOpacity, setBrushOpacity] = useState(100)
  const [grayscaleShade, setGrayscaleShade] = useState(230)
  const [colorValue, setColorValue] = useState('#f5f7ff')
  const [addressText, setAddressText] = useState('')
  const [scrapbookPages, setScrapbookPages] = useState<ScrapbookPage[]>([])
  const [activePageIndex, setActivePageIndex] = useState(0)
  const [flipDirection, setFlipDirection] = useState<FlipDirection>('forward')
  const [flipToken, setFlipToken] = useState(0)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const [status, setStatus] = useState(
    'The library is ready. Draw, sample, fill, upload, and let the scrapbook flip open to the page you found.',
  )
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => getImageStats(mode), [mode])
  const opacityLabel = `${brushOpacity}%`
  const activePage = scrapbookPages[activePageIndex] ?? null
  const previousPage = activePageIndex > 0 ? scrapbookPages[activePageIndex - 1] : null
  const nextPage =
    activePageIndex < scrapbookPages.length - 1
      ? scrapbookPages[activePageIndex + 1]
      : null

  useEffect(() => {
    const studioCanvas = studioCanvasRef.current

    if (studioCanvas) {
      initializeCanvas(studioCanvas)
      paintBlank(studioCanvas)
    }
  }, [])

  useEffect(() => {
    const studioCanvas = studioCanvasRef.current
    const context = studioCanvas?.getContext('2d', { willReadFrequently: true })

    if (!studioCanvas || !context) {
      return
    }

    pushUndoSnapshot(studioCanvas, undoStackRef, redoStackRef, syncHistoryDepth)
    const converted = convertImageDataMode(
      context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION),
      mode,
    )
    context.putImageData(converted, 0, 0)
    setTool('brush')
    setStatus(
      `Studio converted to ${mode}. The editor keeps the current frame and rewrites it for the selected library mode.`,
    )
  }, [mode])

  function syncHistoryDepth() {
    setUndoDepth(undoStackRef.current.length)
    setRedoDepth(redoStackRef.current.length)
  }

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = studioCanvasRef.current

    if (!canvas) {
      return
    }

    const point = getCanvasPoint(canvas, event)

    if (tool === 'sample') {
      sampleColor(point.x, point.y)
      return
    }

    if (tool === 'fill') {
      pushUndoSnapshot(canvas, undoStackRef, redoStackRef, syncHistoryDepth)
      floodFillStudio(Math.floor(point.x), Math.floor(point.y))
      return
    }

    pushUndoSnapshot(canvas, undoStackRef, redoStackRef, syncHistoryDepth)
    drawingRef.current = { active: true, x: point.x, y: point.y }
    canvas.setPointerCapture(event.pointerId)
    drawLine(point.x, point.y, point.x, point.y)
  }

  function moveStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current.active) {
      return
    }

    const canvas = studioCanvasRef.current

    if (!canvas) {
      return
    }

    const point = getCanvasPoint(canvas, event)
    drawLine(drawingRef.current.x, drawingRef.current.y, point.x, point.y)
    drawingRef.current.x = point.x
    drawingRef.current.y = point.y
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = studioCanvasRef.current

    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }

    drawingRef.current.active = false
  }

  function drawLine(fromX: number, fromY: number, toX: number, toY: number) {
    const canvas = studioCanvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineWidth = brushSize
    context.globalAlpha = brushOpacity / 100
    context.strokeStyle =
      tool === 'eraser' ? '#000000' : brushColor(mode, grayscaleShade, colorValue)
    context.beginPath()
    context.moveTo(fromX, fromY)
    context.lineTo(toX, toY)
    context.stroke()
    context.restore()
  }

  function floodFillStudio(x: number, y: number) {
    const canvas = studioCanvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })

    if (!canvas || !context) {
      return
    }

    const imageData = context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION)
    const replacement = getActiveRgba(mode, tool, grayscaleShade, colorValue)
    const changed = floodFill(
      imageData.data,
      IMAGE_DIMENSION,
      IMAGE_DIMENSION,
      x,
      y,
      replacement,
      brushOpacity / 100,
    )

    if (!changed) {
      return
    }

    context.putImageData(imageData, 0, 0)
    setStatus(
      `Filled a contiguous ${mode} region with ${tool === 'eraser' ? 'black' : 'the selected tone'}.`,
    )
  }

  function sampleColor(x: number, y: number) {
    const canvas = studioCanvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })

    if (!canvas || !context) {
      return
    }

    const data = context.getImageData(
      Math.max(0, Math.min(IMAGE_DIMENSION - 1, Math.floor(x))),
      Math.max(0, Math.min(IMAGE_DIMENSION - 1, Math.floor(y))),
      1,
      1,
    ).data

    if (mode === 'grayscale') {
      setGrayscaleShade(data[0])
    } else {
      setColorValue(rgbToHex(data[0], data[1], data[2]))
    }

    setTool('brush')
    setStatus('Sampled the pixel under the cursor and switched back to brush mode.')
  }

  function clearStudio() {
    const canvas = studioCanvasRef.current

    if (!canvas) {
      return
    }

    pushUndoSnapshot(canvas, undoStackRef, redoStackRef, syncHistoryDepth)
    paintBlank(canvas)
    setError(null)
    setStatus('Studio cleared to deep black. Even an empty frame has an address.')
  }

  function applyStudioTransform(
    transform: (imageData: ImageData) => ImageData,
    message: string,
  ) {
    const canvas = studioCanvasRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })

    if (!canvas || !context) {
      return
    }

    pushUndoSnapshot(canvas, undoStackRef, redoStackRef, syncHistoryDepth)
    const next = transform(context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION))
    context.putImageData(next, 0, 0)
    setStatus(message)
  }

  function invertStudio() {
    applyStudioTransform(invertImageData, 'Inverted the studio frame.')
  }

  function mirrorStudio() {
    applyStudioTransform(mirrorImageData, 'Mirrored the studio frame horizontally.')
  }

  function undoStudio() {
    const canvas = studioCanvasRef.current

    if (!canvas || undoStackRef.current.length === 0) {
      return
    }

    const current = snapshotCanvas(canvas)

    if (!current) {
      return
    }

    const previous = undoStackRef.current.pop()

    if (!previous) {
      return
    }

    redoStackRef.current.push(current)
    restoreSnapshot(canvas, previous)
    syncHistoryDepth()
    setStatus('Undid the last studio edit.')
  }

  function redoStudio() {
    const canvas = studioCanvasRef.current

    if (!canvas || redoStackRef.current.length === 0) {
      return
    }

    const current = snapshotCanvas(canvas)

    if (!current) {
      return
    }

    const next = redoStackRef.current.pop()

    if (!next) {
      return
    }

    undoStackRef.current.push(current)
    restoreSnapshot(canvas, next)
    syncHistoryDepth()
    setStatus('Reapplied the next studio edit.')
  }

  async function handleDiscoverAddress() {
    const canvas = studioCanvasRef.current
    const trimmedKey = libraryKey.trim()

    if (!canvas) {
      return
    }

    if (!trimmedKey) {
      setError('A library key is required to derive an address.')
      return
    }

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return
    }

    try {
      setBusyLabel('Discovering address')
      setError(null)

      const imageData = context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION)
      const result = await discoverAddress(imageData, mode, trimmedKey)
      const centerPage = createScrapbookPage(
        {
          mode,
          address: result.address,
          descriptor: result.descriptor,
          payload: result.payload,
          libraryId: result.libraryId,
          imageData,
        },
        'Located by your studio search',
      )
      await openScrapbook(centerPage, trimmedKey, 'forward')
      setStatus(
        `The scrapbook flipped to the ${mode} page in library ${result.libraryId}. Nothing was uploaded or stored.`,
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
    }
  }

  async function handleRenderAddress() {
    const trimmedKey = libraryKey.trim()

    if (!trimmedKey) {
      setError('A library key is required to decode an address.')
      return
    }

    try {
      setBusyLabel('Rendering address')
      setError(null)

      const result = await restoreAddress(addressText, trimmedKey)
      const centerPage = createScrapbookPage(result, 'Located by pasted address')
      await openScrapbook(centerPage, trimmedKey, 'forward')
      setStatus(
        `The scrapbook flipped open at chamber ${result.descriptor.chamber} in ${result.mode} mode.`,
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
    }
  }

  async function handleRandomAddress() {
    const trimmedKey = libraryKey.trim()

    if (!trimmedKey) {
      setError('A library key is required to generate a random address.')
      return
    }

    try {
      setBusyLabel('Generating random address')
      setError(null)

      const result = await generateRandomAddress(mode, trimmedKey)
      const centerPage = createScrapbookPage(result, 'Randomly opened page')
      await openScrapbook(centerPage, trimmedKey, 'forward')
      setStatus(
        `The scrapbook opened at a random ${mode} page. Most neighboring pages are noise because most possible images are noise.`,
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
    }
  }

  async function openScrapbook(
    centerPage: ScrapbookPage,
    keyForPages: string,
    direction: FlipDirection,
  ) {
    const spread = await buildScrapbookSpread(centerPage, keyForPages)
    const centerIndex = spread.findIndex((page) => page.id === centerPage.id)
    const nextIndex = centerIndex >= 0 ? centerIndex : 0

    setScrapbookPages(spread)
    setScrapbookKey(keyForPages)
    setFlipDirection(direction)
    setFlipToken((current) => current + 1)
    setActivePageIndex(nextIndex)
    syncScrapbookState(spread[nextIndex])
  }

  function syncScrapbookState(page: ScrapbookPage | null) {
    if (!page) {
      return
    }

    startTransition(() => setAddressText(page.address))
  }

  async function turnPage(direction: FlipDirection) {
    if (!activePage) {
      return
    }

    const keyForPages = scrapbookKey.trim()

    if (!keyForPages) {
      setError('The scrapbook needs the original library key to turn pages.')
      return
    }

    setBusyLabel('Turning page')
    setError(null)

    try {
      if (direction === 'backward') {
        if (activePageIndex > 0) {
          const nextIndex = activePageIndex - 1
          setActivePageIndex(nextIndex)
          setFlipDirection('backward')
          setFlipToken((current) => current + 1)
          syncScrapbookState(scrapbookPages[nextIndex])
        } else {
          const neighbor = await createNeighborPage(
            scrapbookPages[0],
            'backward',
            keyForPages,
          )
          const nextPages = [neighbor, ...scrapbookPages]
          setScrapbookPages(nextPages)
          setActivePageIndex(0)
          setFlipDirection('backward')
          setFlipToken((current) => current + 1)
          syncScrapbookState(neighbor)
        }

        setStatus('Turned backward to an adjacent algorithm page.')
        return
      }

      if (activePageIndex < scrapbookPages.length - 1) {
        const nextIndex = activePageIndex + 1
        setActivePageIndex(nextIndex)
        setFlipDirection('forward')
        setFlipToken((current) => current + 1)
        syncScrapbookState(scrapbookPages[nextIndex])
      } else {
        const neighbor = await createNeighborPage(
          scrapbookPages[scrapbookPages.length - 1],
          'forward',
          keyForPages,
        )
        const nextPages = [...scrapbookPages, neighbor]
        const nextIndex = nextPages.length - 1
        setScrapbookPages(nextPages)
        setActivePageIndex(nextIndex)
        setFlipDirection('forward')
        setFlipToken((current) => current + 1)
        syncScrapbookState(neighbor)
      }

      setStatus('Turned forward to an adjacent algorithm page.')
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
    }
  }

  function jumpToPage(index: number) {
    if (index < 0 || index >= scrapbookPages.length || index === activePageIndex) {
      return
    }

    const direction = index > activePageIndex ? 'forward' : 'backward'
    setActivePageIndex(index)
    setFlipDirection(direction)
    setFlipToken((current) => current + 1)
    syncScrapbookState(scrapbookPages[index])
    setStatus('Jumped directly to a nearby scrapbook page.')
  }

  function usePreviewInStudio() {
    const page = activePage
    const studioCanvas = studioCanvasRef.current

    if (!page || !studioCanvas) {
      return
    }

    const studioContext = studioCanvas.getContext('2d')

    if (!studioContext) {
      return
    }

    pushUndoSnapshot(studioCanvas, undoStackRef, redoStackRef, syncHistoryDepth)
    const converted = convertImageDataMode(page.imageData, mode)
    studioContext.putImageData(converted, 0, 0)
    setStatus('Copied the open scrapbook page into the studio for further edits.')
  }

  async function copyAddress() {
    if (!addressText.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(addressText)
      setStatus('Address copied to clipboard.')
    } catch {
      setError('Clipboard access was blocked. Copy the address manually.')
    }
  }

  function downloadPreview() {
    if (!activePage) {
      return
    }

    const link = document.createElement('a')
    link.download = `inflib-${activePage.mode}-${Date.now()}.png`
    link.href = activePage.imageUrl
    link.click()
    setStatus('Downloaded the open scrapbook page as a PNG.')
  }

  async function importImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const studioCanvas = studioCanvasRef.current

    if (!file || !studioCanvas) {
      return
    }

    try {
      setBusyLabel('Importing image')
      setError(null)

      const bitmap = await createImageBitmap(file)
      const scratch = document.createElement('canvas')
      scratch.width = IMAGE_DIMENSION
      scratch.height = IMAGE_DIMENSION
      const context = scratch.getContext('2d')

      if (!context) {
        throw new Error('Could not create a resize surface.')
      }

      context.fillStyle = '#000000'
      context.fillRect(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION)
      const scale = Math.max(
        IMAGE_DIMENSION / bitmap.width,
        IMAGE_DIMENSION / bitmap.height,
      )
      const width = bitmap.width * scale
      const height = bitmap.height * scale
      const left = (IMAGE_DIMENSION - width) / 2
      const top = (IMAGE_DIMENSION - height) / 2

      context.drawImage(bitmap, left, top, width, height)
      bitmap.close()

      pushUndoSnapshot(studioCanvas, undoStackRef, redoStackRef, syncHistoryDepth)

      const imported = convertImageDataMode(
        context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION),
        mode,
      )
      paintImage(studioCanvas, imported)
      setStatus(
        'Imported and resized to 512×512. The editor center-crops to preserve the frame.',
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
      event.target.value = ''
    }
  }

  function activateBrushColor(color: string) {
    setColorValue(color)
    setTool('brush')
  }

  function activateGrayShade(shade: number) {
    setGrayscaleShade(shade)
    setTool('brush')
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">inflib.io</p>
          <h1>The Infinite Canvas</h1>
          <p className="lede">
            Every image that has ever existed, or ever will, already has an
            address. You do not create the frame. You locate it.
          </p>
          <p className="hero-note">
            The archive now opens like a scrapbook. Search for an image and the
            book flips to that page, with neighboring pages pulled from nearby
            addresses in the algorithm.
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card accent">
            <span className="stat-label">{mode === 'color' ? 'Color' : 'Grayscale'} mode</span>
            <strong>{stats.possibilitiesLabel}</strong>
            <span>{stats.digitsLabel}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Editor stack</span>
            <strong>{undoDepth} undo / {redoDepth} redo</strong>
            <span>Brush, erase, fill, sample, mirror, invert.</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Scrapbook</span>
            <strong>{scrapbookPages.length} bound pages</strong>
            <span>Turn outward to inspect nearby images in the library.</span>
          </article>
        </div>
      </section>

      <section className="grid">
        <section className="panel studio-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Studio</p>
              <h2>Editor</h2>
            </div>
            <div className="segmented">
              <button
                className={mode === 'grayscale' ? 'active' : ''}
                type="button"
                onClick={() => setMode('grayscale')}
              >
                Grayscale
              </button>
              <button
                className={mode === 'color' ? 'active' : ''}
                type="button"
                onClick={() => setMode('color')}
              >
                Color
              </button>
            </div>
          </div>

          <div className="studio-layout">
            <div className="studio-sidebar">
              <label className="field">
                <span>Library key</span>
                <input
                  value={libraryKey}
                  onChange={(event) => setLibraryKey(event.target.value)}
                  placeholder="inflib.io"
                />
              </label>

              <div className="tool-grid">
                <ToolButton label="Brush" active={tool === 'brush'} onClick={() => setTool('brush')} />
                <ToolButton label="Erase" active={tool === 'eraser'} onClick={() => setTool('eraser')} />
                <ToolButton label="Fill" active={tool === 'fill'} onClick={() => setTool('fill')} />
                <ToolButton label="Sample" active={tool === 'sample'} onClick={() => setTool('sample')} />
              </div>

              <div className="control-stack">
                <label className="field">
                  <span>Brush size</span>
                  <input
                    type="range"
                    min="1"
                    max="64"
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                  />
                  <small>{brushSize}px</small>
                </label>

                <label className="field">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={brushOpacity}
                    onChange={(event) => setBrushOpacity(Number(event.target.value))}
                  />
                  <small>{opacityLabel}</small>
                </label>

                {mode === 'grayscale' ? (
                  <label className="field">
                    <span>Tone</span>
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={grayscaleShade}
                      onChange={(event) => setGrayscaleShade(Number(event.target.value))}
                    />
                    <small>{grayscaleShade}</small>
                  </label>
                ) : (
                  <label className="field">
                    <span>Ink</span>
                    <input
                      className="color-input"
                      type="color"
                      value={colorValue}
                      onChange={(event) => setColorValue(event.target.value)}
                    />
                    <small>{colorValue}</small>
                  </label>
                )}
              </div>

              <div className="swatches">
                <span>{mode === 'grayscale' ? 'Tone bank' : 'Color bank'}</span>
                <div className="swatch-row">
                  {mode === 'grayscale'
                    ? GRAYSCALE_SWATCHES.map((shade) => (
                        <button
                          key={shade}
                          className="swatch"
                          type="button"
                          style={{ background: `rgb(${shade}, ${shade}, ${shade})` }}
                          onClick={() => activateGrayShade(shade)}
                          aria-label={`Use grayscale shade ${shade}`}
                        />
                      ))
                    : COLOR_SWATCHES.map((swatch) => (
                        <button
                          key={swatch}
                          className="swatch"
                          type="button"
                          style={{ background: swatch }}
                          onClick={() => activateBrushColor(swatch)}
                          aria-label={`Use color ${swatch}`}
                        />
                      ))}
                </div>
              </div>

              <div className="toolbar stack">
                <button className="ghost" type="button" onClick={undoStudio} disabled={undoDepth === 0}>
                  Undo
                </button>
                <button className="ghost" type="button" onClick={redoStudio} disabled={redoDepth === 0}>
                  Redo
                </button>
                <button className="ghost" type="button" onClick={mirrorStudio}>
                  Mirror
                </button>
                <button className="ghost" type="button" onClick={invertStudio}>
                  Invert
                </button>
                <button className="ghost" type="button" onClick={clearStudio}>
                  Clear
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  Upload
                </button>
                <input
                  ref={uploadInputRef}
                  className="hidden-input"
                  type="file"
                  accept="image/*"
                  onChange={importImage}
                />
              </div>
            </div>

            <div className="studio-stage">
              <div className="canvas-header">
                <div>
                  <strong>{tool}</strong>
                  <span>{tool === 'sample' ? 'Click a pixel to pick it.' : 'Drag directly on the 512×512 frame.'}</span>
                </div>
                <div className="canvas-meta">
                  <span>{brushSize}px</span>
                  <span>{opacityLabel}</span>
                </div>
              </div>

              <div className="canvas-wrap studio">
                <canvas
                  ref={studioCanvasRef}
                  className="image-canvas"
                  onPointerDown={beginStroke}
                  onPointerMove={moveStroke}
                  onPointerUp={endStroke}
                  onPointerLeave={endStroke}
                  onPointerCancel={endStroke}
                />
              </div>

              <div className="action-row">
                <button
                  type="button"
                  onClick={handleDiscoverAddress}
                  disabled={Boolean(busyLabel)}
                >
                  Discover address
                </button>
                <p className="hint">
                  The address is large because the frame is exact. The library
                  does not compress certainty.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel archive-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Archive</p>
              <h2>Scrapbook</h2>
            </div>
            <div className="panel-badge">{busyLabel ?? 'Book bound from algorithm pages'}</div>
          </div>

          <label className="field">
            <span>Library address</span>
            <textarea
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
              placeholder="inflib:v1:color:... paste or generate an address"
            />
          </label>

          <div className="toolbar">
            <button
              type="button"
              onClick={handleRenderAddress}
              disabled={Boolean(busyLabel)}
            >
              Open address
            </button>
            <button
              className="ghost"
              type="button"
              onClick={handleRandomAddress}
              disabled={Boolean(busyLabel)}
            >
              Random spread
            </button>
            <button className="ghost" type="button" onClick={copyAddress}>
              Copy address
            </button>
          </div>

          <div className="scrapbook-shell">
            {activePage ? (
              <div className="scrapbook-book">
                <div className="book-spine" />
                <div className="book-edges" />
                <div className="book-spread">
                  <article className="book-page page-left">
                    <p className="page-marker">
                      Spread {activePageIndex + 1} of {scrapbookPages.length}
                    </p>
                    <h3>{activePage.label}</h3>
                    <p className="page-copy">
                      This open page is the image you asked for. The tabs below
                      come from adjacent addresses so you can keep turning
                      through nearby algorithmic shelves.
                    </p>
                    <div className="page-facts">
                      <div>
                        <span>Library</span>
                        <strong>{activePage.descriptor.libraryId}</strong>
                      </div>
                      <div>
                        <span>Chamber</span>
                        <strong>{activePage.descriptor.chamber}</strong>
                      </div>
                      <div>
                        <span>Gallery</span>
                        <strong>{activePage.descriptor.gallery}</strong>
                      </div>
                      <div>
                        <span>Frame</span>
                        <strong>{activePage.descriptor.frame}</strong>
                      </div>
                    </div>
                    <div className="page-tabs">
                      {previousPage ? (
                        <button
                          className="page-tab"
                          type="button"
                          onClick={() => jumpToPage(activePageIndex - 1)}
                        >
                          <img src={previousPage.imageUrl} alt="" />
                          <span>Previous</span>
                        </button>
                      ) : (
                        <div className="page-tab placeholder">
                          <span>Earlier pages</span>
                        </div>
                      )}
                      {nextPage ? (
                        <button
                          className="page-tab"
                          type="button"
                          onClick={() => jumpToPage(activePageIndex + 1)}
                        >
                          <img src={nextPage.imageUrl} alt="" />
                          <span>Next</span>
                        </button>
                      ) : (
                        <div className="page-tab placeholder">
                          <span>Later pages</span>
                        </div>
                      )}
                    </div>
                  </article>

                  <article className="book-page page-right">
                    <div className="page-image-frame">
                      <img src={activePage.imageUrl} alt="Open scrapbook page" />
                    </div>
                    <p className="page-address-note">
                      {activePage.mode} page, checksum {activePage.descriptor.checksum}
                    </p>
                  </article>
                </div>
                <div
                  key={flipToken}
                  className={`page-flip-overlay ${flipDirection}`}
                  aria-hidden="true"
                />
              </div>
            ) : (
              <div className="scrapbook-empty">
                <p>No scrapbook page is open yet.</p>
                <span>Discover a studio frame, paste an address, or open a random spread.</span>
              </div>
            )}
          </div>

          <div className="toolbar">
            <button
              className="ghost"
              type="button"
              onClick={() => turnPage('backward')}
              disabled={Boolean(busyLabel) || !activePage}
            >
              Previous page
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => turnPage('forward')}
              disabled={Boolean(busyLabel) || !activePage}
            >
              Next page
            </button>
            <button
              className="ghost"
              type="button"
              onClick={usePreviewInStudio}
              disabled={!activePage}
            >
              Copy page to studio
            </button>
            <button
              className="ghost"
              type="button"
              onClick={downloadPreview}
              disabled={!activePage}
            >
              Download page
            </button>
          </div>
        </section>
      </section>

      <footer className="site-footer">
        <p>{status}</p>
        {error ? <p className="error">{error}</p> : null}
      </footer>
    </main>
  )
}

export default App

function ToolButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button className={active ? 'tool-button active' : 'tool-button'} type="button" onClick={onClick}>
      {label}
    </button>
  )
}

function initializeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = IMAGE_DIMENSION
  canvas.height = IMAGE_DIMENSION
}

function paintBlank(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.fillStyle = '#000000'
  context.fillRect(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION)
}

function paintImage(canvas: HTMLCanvasElement | null, imageData: ImageData) {
  const context = canvas?.getContext('2d')

  if (!canvas || !context) {
    return
  }

  context.putImageData(imageData, 0, 0)
}

function getCanvasPoint(
  canvas: HTMLCanvasElement,
  event: React.PointerEvent<HTMLCanvasElement>,
) {
  const bounds = canvas.getBoundingClientRect()
  const scaleX = canvas.width / bounds.width
  const scaleY = canvas.height / bounds.height

  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  }
}

function asMessage(value: unknown) {
  return value instanceof Error ? value.message : 'An unexpected error occurred.'
}

function snapshotCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    return null
  }

  return new Uint8ClampedArray(
    context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION).data,
  )
}

function restoreSnapshot(canvas: HTMLCanvasElement, snapshot: Uint8ClampedArray) {
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.putImageData(
    new ImageData(new Uint8ClampedArray(snapshot), IMAGE_DIMENSION, IMAGE_DIMENSION),
    0,
    0,
  )
}

function pushUndoSnapshot(
  canvas: HTMLCanvasElement,
  undoStackRef: { current: Uint8ClampedArray[] },
  redoStackRef: { current: Uint8ClampedArray[] },
  syncHistoryDepth: () => void,
) {
  const snapshot = snapshotCanvas(canvas)

  if (!snapshot) {
    return
  }

  undoStackRef.current.push(snapshot)

  if (undoStackRef.current.length > HISTORY_LIMIT) {
    undoStackRef.current.shift()
  }

  redoStackRef.current = []
  syncHistoryDepth()
}

function getActiveRgba(
  mode: ImageMode,
  tool: StudioTool,
  grayscaleShade: number,
  colorValue: string,
) {
  if (tool === 'eraser') {
    return [0, 0, 0, 255]
  }

  if (mode === 'grayscale') {
    return [grayscaleShade, grayscaleShade, grayscaleShade, 255]
  }

  return hexToRgb(colorValue)
}

function createScrapbookPage(
  page: {
    mode: ImageMode
    address: string
    descriptor: AddressDescriptor
    payload: Uint8Array
    libraryId: string
    imageData: ImageData
  },
  label: string,
) {
  return {
    id: `${page.address}:${label}`,
    mode: page.mode,
    address: page.address,
    descriptor: page.descriptor,
    payload: new Uint8Array(page.payload),
    libraryId: page.libraryId,
    imageData: page.imageData,
    imageUrl: imageDataToUrl(page.imageData),
    label,
  }
}

async function buildScrapbookSpread(centerPage: ScrapbookPage, libraryKey: string) {
  const tasks: Array<Promise<ScrapbookPage>> = []

  for (let index = SCRAPBOOK_RADIUS; index >= 1; index -= 1) {
    tasks.push(createOffsetPage(centerPage, -index, libraryKey))
  }

  tasks.push(Promise.resolve(centerPage))

  for (let index = 1; index <= SCRAPBOOK_RADIUS; index += 1) {
    tasks.push(createOffsetPage(centerPage, index, libraryKey))
  }

  return Promise.all(tasks)
}

async function createNeighborPage(
  anchorPage: ScrapbookPage,
  direction: FlipDirection,
  libraryKey: string,
) {
  return createOffsetPage(anchorPage, direction === 'forward' ? 1 : -1, libraryKey)
}

async function createOffsetPage(
  centerPage: ScrapbookPage,
  delta: number,
  libraryKey: string,
) {
  let payload = new Uint8Array(centerPage.payload)

  if (delta > 0) {
    for (let count = 0; count < delta; count += 1) {
      payload = stepPayload(payload, 'forward')
    }
  } else if (delta < 0) {
    for (let count = 0; count < Math.abs(delta); count += 1) {
      payload = stepPayload(payload, 'backward')
    }
  }

  const address = formatAddress(centerPage.mode, centerPage.libraryId, payload)
  const result = await restoreAddress(address, libraryKey)
  const label =
    delta < 0
      ? `Earlier shelf ${Math.abs(delta)}`
      : delta > 0
        ? `Later shelf ${delta}`
        : 'Center page'

  return createScrapbookPage(result, label)
}

function imageDataToUrl(imageData: ImageData) {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const context = canvas.getContext('2d')

  if (!context) {
    return ''
  }

  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

function stepPayload(payload: Uint8Array, direction: FlipDirection) {
  const next = new Uint8Array(payload)

  if (direction === 'forward') {
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (next[index] === 255) {
        next[index] = 0
        continue
      }

      next[index] += 1
      break
    }

    return next
  }

  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index] === 0) {
      next[index] = 255
      continue
    }

    next[index] -= 1
    break
  }

  return next
}

// Flood fill is done on the raw pixel buffer so it works identically for brush-generated pixels and imported images.
function floodFill(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fillColor: number[],
  opacity: number,
) {
  const startOffset = (startY * width + startX) * 4
  const target = [
    pixels[startOffset],
    pixels[startOffset + 1],
    pixels[startOffset + 2],
    pixels[startOffset + 3],
  ]
  const replacement = blendRgba(target, fillColor, opacity)

  if (sameColor(target, replacement)) {
    return false
  }

  const stack = [startOffset]

  while (stack.length > 0) {
    const offset = stack.pop()

    if (offset === undefined || !matchesAt(pixels, offset, target)) {
      continue
    }

    pixels[offset] = replacement[0]
    pixels[offset + 1] = replacement[1]
    pixels[offset + 2] = replacement[2]
    pixels[offset + 3] = 255

    const pixelIndex = offset / 4
    const x = pixelIndex % width
    const y = Math.floor(pixelIndex / width)

    if (x > 0) {
      stack.push(offset - 4)
    }
    if (x < width - 1) {
      stack.push(offset + 4)
    }
    if (y > 0) {
      stack.push(offset - width * 4)
    }
    if (y < height - 1) {
      stack.push(offset + width * 4)
    }
  }

  return true
}

function matchesAt(pixels: Uint8ClampedArray, offset: number, color: number[]) {
  return (
    pixels[offset] === color[0] &&
    pixels[offset + 1] === color[1] &&
    pixels[offset + 2] === color[2] &&
    pixels[offset + 3] === color[3]
  )
}

function sameColor(a: number[], b: number[]) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

function blendRgba(base: number[], next: number[], opacity: number) {
  return [
    Math.round(base[0] + (next[0] - base[0]) * opacity),
    Math.round(base[1] + (next[1] - base[1]) * opacity),
    Math.round(base[2] + (next[2] - base[2]) * opacity),
    255,
  ]
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(value: string) {
  const normalized = value.replace('#', '')
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : normalized

  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
    255,
  ]
}

function invertImageData(imageData: ImageData) {
  const next = new Uint8ClampedArray(imageData.data)

  for (let index = 0; index < next.length; index += 4) {
    next[index] = 255 - next[index]
    next[index + 1] = 255 - next[index + 1]
    next[index + 2] = 255 - next[index + 2]
    next[index + 3] = 255
  }

  return new ImageData(next, imageData.width, imageData.height)
}

function mirrorImageData(imageData: ImageData) {
  const { width, height, data } = imageData
  const next = new Uint8ClampedArray(data.length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4
      const targetOffset = (y * width + (width - x - 1)) * 4

      next[targetOffset] = data[sourceOffset]
      next[targetOffset + 1] = data[sourceOffset + 1]
      next[targetOffset + 2] = data[sourceOffset + 2]
      next[targetOffset + 3] = 255
    }
  }

  return new ImageData(next, width, height)
}
