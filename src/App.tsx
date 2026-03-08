import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  IMAGE_DIMENSION,
  brushColor,
  convertImageDataMode,
  discoverAddress,
  generateRandomAddress,
  getImageStats,
  restoreAddress,
  type AddressDescriptor,
  type ImageMode,
} from './lib/infiniteCanvas'

function App() {
  const studioCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const drawingRef = useRef({ active: false, x: 0, y: 0 })
  const [mode, setMode] = useState<ImageMode>('color')
  const [libraryKey, setLibraryKey] = useState('inflib.io')
  const [brushSize, setBrushSize] = useState(14)
  const [grayscaleShade, setGrayscaleShade] = useState(32)
  const [colorValue, setColorValue] = useState('#24160c')
  const [isErasing, setIsErasing] = useState(false)
  const [addressText, setAddressText] = useState('')
  const [descriptor, setDescriptor] = useState<AddressDescriptor | null>(null)
  const [activePreviewMode, setActivePreviewMode] = useState<ImageMode>('color')
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [status, setStatus] = useState(
    'Paint, upload, or generate noise to reveal where the image has always lived.',
  )
  const [error, setError] = useState<string | null>(null)

  const stats = useMemo(() => getImageStats(mode), [mode])

  useEffect(() => {
    const studioCanvas = studioCanvasRef.current
    const previewCanvas = previewCanvasRef.current

    if (studioCanvas) {
      initializeCanvas(studioCanvas)
      paintBlank(studioCanvas)
    }

    if (previewCanvas) {
      initializeCanvas(previewCanvas)
      paintBlank(previewCanvas)
    }
  }, [])

  useEffect(() => {
    const studioCanvas = studioCanvasRef.current
    const context = studioCanvas?.getContext('2d', { willReadFrequently: true })

    if (!studioCanvas || !context) {
      return
    }

    const converted = convertImageDataMode(
      context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION),
      mode,
    )
    context.putImageData(converted, 0, 0)
  }, [mode])

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = studioCanvasRef.current

    if (!canvas) {
      return
    }

    const point = getCanvasPoint(canvas, event)
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
    context.strokeStyle = isErasing
      ? '#f4efe5'
      : brushColor(mode, grayscaleShade, colorValue)
    context.beginPath()
    context.moveTo(fromX, fromY)
    context.lineTo(toX, toY)
    context.stroke()
    context.restore()
  }

  function clearStudio() {
    const canvas = studioCanvasRef.current

    if (!canvas) {
      return
    }

    paintBlank(canvas)
    setError(null)
    setStatus('Studio cleared. Even the blank frame has a permanent address.')
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

      paintImage(previewCanvasRef.current, imageData)
      setActivePreviewMode(mode)
      setDescriptor(result.descriptor)
      startTransition(() => setAddressText(result.address))
      setStatus(
        `Revealed a ${mode} address in library ${result.libraryId}. Nothing was uploaded or stored.`,
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
      paintImage(previewCanvasRef.current, result.imageData)
      setActivePreviewMode(result.mode)
      setDescriptor(result.descriptor)
      setStatus(
        `Rendered a ${result.mode} frame from chamber ${result.descriptor.chamber}.`,
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
      paintImage(previewCanvasRef.current, result.imageData)
      setActivePreviewMode(mode)
      setDescriptor(result.descriptor)
      startTransition(() => setAddressText(result.address))
      setStatus(
        `Opened a random ${mode} location. Most of the library is noise because most possible images are noise.`,
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
    }
  }

  function usePreviewInStudio() {
    const previewCanvas = previewCanvasRef.current
    const studioCanvas = studioCanvasRef.current

    if (!previewCanvas || !studioCanvas) {
      return
    }

    const previewContext = previewCanvas.getContext('2d', { willReadFrequently: true })
    const studioContext = studioCanvas.getContext('2d')

    if (!previewContext || !studioContext) {
      return
    }

    const imageData = previewContext.getImageData(
      0,
      0,
      IMAGE_DIMENSION,
      IMAGE_DIMENSION,
    )
    const converted = convertImageDataMode(imageData, mode)
    studioContext.putImageData(converted, 0, 0)
    setStatus('Copied the rendered frame into the studio for further edits.')
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
    const canvas = previewCanvasRef.current

    if (!canvas) {
      return
    }

    const link = document.createElement('a')
    link.download = `inflib-${activePreviewMode}-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    setStatus('Downloaded the rendered frame as a PNG.')
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

      context.fillStyle = '#f4efe5'
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

      const imported = convertImageDataMode(
        context.getImageData(0, 0, IMAGE_DIMENSION, IMAGE_DIMENSION),
        mode,
      )
      paintImage(studioCanvas, imported)
      setStatus(
        'Imported and resized to 512×512. The app center-crops to preserve the frame.',
      )
    } catch (caughtError) {
      setError(asMessage(caughtError))
    } finally {
      setBusyLabel(null)
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">inflib.io</p>
          <h1>The Infinite Canvas</h1>
          <p className="lede">
            Every image that has ever existed, or ever will, already has an
            address. You are not creating anything. You are discovering where it
            has always been.
          </p>
          <p className="hero-note">
            Inspired by Borges&apos; <em>The Library of Babel</em>, but for
            images. Draw. Upload. Or open a random address and stare at what
            completion looks like in practice.
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card accent">
            <span className="stat-label">{mode === 'color' ? 'Color' : 'Grayscale'} mode</span>
            <strong>{stats.possibilitiesLabel}</strong>
            <span>{stats.digitsLabel}</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Observable universe</span>
            <strong>~10^80 atoms</strong>
            <span>About 81 digits</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Library key</span>
            <strong>{libraryKey || 'Required'}</strong>
            <span>Different keys create different shelf layouts.</span>
          </article>
        </div>
      </section>

      <section className="grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Studio</p>
              <h2>Draw or upload</h2>
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

          <label className="field">
            <span>Library key</span>
            <input
              value={libraryKey}
              onChange={(event) => setLibraryKey(event.target.value)}
              placeholder="inflib.io"
            />
          </label>

          <div className="control-grid">
            <label className="field">
              <span>Brush size</span>
              <input
                type="range"
                min="1"
                max="48"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
            </label>

            {mode === 'grayscale' ? (
              <label className="field">
                <span>Shade</span>
                <input
                  type="range"
                  min="0"
                  max="255"
                  value={grayscaleShade}
                  onChange={(event) => setGrayscaleShade(Number(event.target.value))}
                />
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
              </label>
            )}
          </div>

          <div className="toolbar">
            <button
              className={isErasing ? 'ghost active' : 'ghost'}
              type="button"
              onClick={() => setIsErasing((current) => !current)}
            >
              {isErasing ? 'Eraser on' : 'Eraser off'}
            </button>
            <button className="ghost" type="button" onClick={clearStudio}>
              Clear canvas
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => uploadInputRef.current?.click()}
            >
              Upload image
            </button>
            <input
              ref={uploadInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              onChange={importImage}
            />
          </div>

          <div className="canvas-wrap">
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
              Exact addresses are enormous because exact images contain enormous
              information.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Archive</p>
              <h2>Explore by address</h2>
            </div>
            <div className="panel-badge">{busyLabel ?? 'Realtime, no backend'}</div>
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
              Render address
            </button>
            <button
              className="ghost"
              type="button"
              onClick={handleRandomAddress}
              disabled={Boolean(busyLabel)}
            >
              Random
            </button>
            <button className="ghost" type="button" onClick={copyAddress}>
              Copy address
            </button>
          </div>

          <div className="canvas-wrap preview">
            <canvas ref={previewCanvasRef} className="image-canvas" />
          </div>

          <div className="toolbar">
            <button className="ghost" type="button" onClick={usePreviewInStudio}>
              Copy preview to studio
            </button>
            <button className="ghost" type="button" onClick={downloadPreview}>
              Download PNG
            </button>
          </div>

          {descriptor ? (
            <div className="descriptor">
              <div>
                <span>Library</span>
                <strong>{descriptor.libraryId}</strong>
              </div>
              <div>
                <span>Chamber</span>
                <strong>{descriptor.chamber}</strong>
              </div>
              <div>
                <span>Gallery</span>
                <strong>{descriptor.gallery}</strong>
              </div>
              <div>
                <span>Wall</span>
                <strong>{descriptor.wall}</strong>
              </div>
              <div>
                <span>Shelf</span>
                <strong>{descriptor.shelf}</strong>
              </div>
              <div>
                <span>Frame</span>
                <strong>{descriptor.frame}</strong>
              </div>
              <div>
                <span>Checksum</span>
                <strong>{descriptor.checksum}</strong>
              </div>
              <div>
                <span>Preview mode</span>
                <strong>{activePreviewMode}</strong>
              </div>
            </div>
          ) : null}
        </section>
      </section>

      <section className="philosophy">
        <article className="panel inset">
          <p className="panel-kicker">What&apos;s happening</p>
          <h2>The library is computed, not stored</h2>
          <p>
            Each 512×512 image becomes one vast byte sequence. A deterministic
            reversible cipher maps that sequence to an address and back again.
            Different keys create different filing systems, but every library is
            still complete.
          </p>
        </article>
        <article className="panel inset">
          <p className="panel-kicker">The paradox</p>
          <h2>Everything meaningful is buried in static</h2>
          <p>
            The Infinite Canvas contains every masterpiece and every worthless
            frame. It is the most complete archive imaginable and almost
            perfectly useless unless you already know what you want.
          </p>
        </article>
      </section>

      <footer className="site-footer">
        <p>{status}</p>
        {error ? <p className="error">{error}</p> : null}
      </footer>
    </main>
  )
}

export default App

function initializeCanvas(canvas: HTMLCanvasElement) {
  canvas.width = IMAGE_DIMENSION
  canvas.height = IMAGE_DIMENSION
}

function paintBlank(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  context.fillStyle = '#f4efe5'
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
