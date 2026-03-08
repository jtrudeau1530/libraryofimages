import CryptoJS from 'crypto-js'

export const IMAGE_DIMENSION = 512

export type ImageMode = 'grayscale' | 'color'

export interface LibraryAddress {
  address: string
  descriptor: AddressDescriptor
  libraryId: string
  payload: Uint8Array
}

export interface ParsedAddress {
  mode: ImageMode
  libraryId: string
  payload: Uint8Array
}

export interface DecodedAddress extends ParsedAddress {
  address: string
  imageData: ImageData
  descriptor: AddressDescriptor
}

export interface AddressDescriptor {
  libraryId: string
  chamber: number
  gallery: number
  wall: number
  shelf: number
  frame: number
  checksum: string
}

const ADDRESS_PREFIX = 'inflib:v1'
const encoder = new TextEncoder()

export function getByteLength(mode: ImageMode) {
  const pixelCount = IMAGE_DIMENSION * IMAGE_DIMENSION
  return mode === 'grayscale' ? pixelCount : pixelCount * 3
}

export function getImageStats(mode: ImageMode) {
  if (mode === 'grayscale') {
    return {
      possibilitiesLabel: '256^262,144',
      digitsLabel: '631,669 digits',
    }
  }

  return {
    possibilitiesLabel: '256^786,432',
    digitsLabel: '1,895,007 digits',
  }
}

export async function discoverAddress(
  imageData: ImageData,
  mode: ImageMode,
  libraryKey: string,
): Promise<LibraryAddress> {
  const plainBytes = serializeImageData(imageData, mode)
  const payload = await transformBytes(plainBytes, mode, libraryKey, 'encrypt')
  const libraryId = await deriveLibraryId(libraryKey)

  return {
    address: formatAddress(mode, libraryId, payload),
    descriptor: await describePayload(payload, libraryId),
    libraryId,
    payload,
  }
}

export async function restoreAddress(
  rawAddress: string,
  libraryKey: string,
): Promise<DecodedAddress> {
  const parsed = parseAddress(rawAddress)
  const plainBytes = await transformBytes(
    parsed.payload,
    parsed.mode,
    libraryKey,
    'decrypt',
  )

  return {
    ...parsed,
    address: formatAddress(parsed.mode, parsed.libraryId, parsed.payload),
    imageData: deserializeImageData(plainBytes, parsed.mode),
    descriptor: await describePayload(parsed.payload, parsed.libraryId),
  }
}

export async function generateRandomAddress(
  mode: ImageMode,
  libraryKey: string,
): Promise<DecodedAddress> {
  const payload = randomBytes(getByteLength(mode))
  const libraryId = await deriveLibraryId(libraryKey)
  const imageBytes = await transformBytes(payload, mode, libraryKey, 'decrypt')

  return {
    address: formatAddress(mode, libraryId, payload),
    mode,
    libraryId,
    payload,
    imageData: deserializeImageData(imageBytes, mode),
    descriptor: await describePayload(payload, libraryId),
  }
}

export function parseAddress(rawAddress: string): ParsedAddress {
  const compact = rawAddress.replace(/\s+/g, '')
  const match = compact.match(
    /^inflib:v1:(grayscale|color):([a-f0-9]{12}):([A-Za-z0-9_-]+)$/i,
  )

  if (!match) {
    throw new Error('Address format is invalid.')
  }

  const mode = match[1] as ImageMode
  const libraryId = match[2].toLowerCase()
  const payload = decodeBase64Url(match[3])

  if (payload.length !== getByteLength(mode)) {
    throw new Error('Address length does not match the encoded image mode.')
  }

  return { mode, libraryId, payload }
}

export function formatAddress(
  mode: ImageMode,
  libraryId: string,
  payload: Uint8Array,
) {
  const body = wrapText(encodeBase64Url(payload), 104)
  return `${ADDRESS_PREFIX}:${mode}:${libraryId}:${body}`
}

export function convertImageDataMode(imageData: ImageData, mode: ImageMode) {
  const next = new Uint8ClampedArray(imageData.data)

  for (let index = 0; index < next.length; index += 4) {
    if (mode === 'grayscale') {
      const luminance = Math.round(
        next[index] * 0.299 + next[index + 1] * 0.587 + next[index + 2] * 0.114,
      )
      next[index] = luminance
      next[index + 1] = luminance
      next[index + 2] = luminance
    }

    next[index + 3] = 255
  }

  return new ImageData(next, IMAGE_DIMENSION, IMAGE_DIMENSION)
}

export function brushColor(mode: ImageMode, shade: number, color: string) {
  if (mode === 'grayscale') {
    return `rgb(${shade}, ${shade}, ${shade})`
  }

  return color
}

function serializeImageData(imageData: ImageData, mode: ImageMode) {
  const bytes = new Uint8Array(getByteLength(mode))
  let offset = 0

  for (let index = 0; index < imageData.data.length; index += 4) {
    if (mode === 'grayscale') {
      bytes[offset] = imageData.data[index]
      offset += 1
      continue
    }

    bytes[offset] = imageData.data[index]
    bytes[offset + 1] = imageData.data[index + 1]
    bytes[offset + 2] = imageData.data[index + 2]
    offset += 3
  }

  return bytes
}

function deserializeImageData(bytes: Uint8Array, mode: ImageMode) {
  const rgba = new Uint8ClampedArray(IMAGE_DIMENSION * IMAGE_DIMENSION * 4)
  let offset = 0

  for (let index = 0; index < rgba.length; index += 4) {
    if (mode === 'grayscale') {
      const value = bytes[offset]
      rgba[index] = value
      rgba[index + 1] = value
      rgba[index + 2] = value
      rgba[index + 3] = 255
      offset += 1
      continue
    }

    rgba[index] = bytes[offset]
    rgba[index + 1] = bytes[offset + 1]
    rgba[index + 2] = bytes[offset + 2]
    rgba[index + 3] = 255
    offset += 3
  }

  return new ImageData(rgba, IMAGE_DIMENSION, IMAGE_DIMENSION)
}

async function describePayload(payload: Uint8Array, libraryId: string) {
  const digest = await sha256(concatBytes(encoder.encode(libraryId), payload))
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  )

  return {
    libraryId,
    chamber: (view.getUint16(0) % 4096) + 1,
    gallery: (view.getUint32(2) % 65535) + 1,
    wall: (view.getUint16(6) % 2048) + 1,
    shelf: (view.getUint16(8) % 2048) + 1,
    frame: (view.getUint32(10) % 65535) + 1,
    checksum: toHex(digest.slice(0, 6)),
  }
}

async function transformBytes(
  bytes: Uint8Array,
  mode: ImageMode,
  libraryKey: string,
  operation: 'encrypt' | 'decrypt',
) {
  const key = await deriveAesKey(libraryKey, mode)
  const iv = zeroWordArray()

  if (operation === 'encrypt') {
    const encrypted = CryptoJS.AES.encrypt(bytesToWordArray(bytes), key, {
      iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    })

    return wordArrayToBytes(encrypted.ciphertext)
  }

  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({
      ciphertext: bytesToWordArray(bytes),
    }),
    key,
    {
      iv,
      mode: CryptoJS.mode.CTR,
      padding: CryptoJS.pad.NoPadding,
    },
  )

  return wordArrayToBytes(decrypted)
}

async function deriveAesKey(libraryKey: string, mode: ImageMode) {
  return CryptoJS.SHA256(`inflib.io:${mode}:${libraryKey}`)
}

async function deriveLibraryId(libraryKey: string) {
  const digest = await sha256(encoder.encode(`inflib.io:${libraryKey}`))
  return toHex(digest.slice(0, 6))
}

async function sha256(bytes: Uint8Array) {
  return wordArrayToBytes(CryptoJS.SHA256(bytesToWordArray(bytes)))
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = ''

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string) {
  const padding = (4 - (value.length % 4)) % 4
  const normalized =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding)
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function wrapText(value: string, width: number) {
  const lines: string[] = []

  for (let index = 0; index < value.length; index += width) {
    lines.push(value.slice(index, index + width))
  }

  return lines.join('\n')
}

function concatBytes(a: Uint8Array, b: Uint8Array) {
  const result = new Uint8Array(a.length + b.length)
  result.set(a, 0)
  result.set(b, a.length)
  return result
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  const chunkSize = 65_536

  for (let index = 0; index < length; index += chunkSize) {
    crypto.getRandomValues(bytes.subarray(index, index + chunkSize))
  }

  return bytes
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  )
}

function bytesToWordArray(bytes: Uint8Array) {
  const words: number[] = []

  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8)
  }

  return CryptoJS.lib.WordArray.create(words, bytes.length)
}

function wordArrayToBytes(wordArray: CryptoJS.lib.WordArray) {
  const { sigBytes, words } = wordArray
  const bytes = new Uint8Array(sigBytes)

  for (let index = 0; index < sigBytes; index += 1) {
    bytes[index] = (words[index >>> 2] >>> (24 - (index % 4) * 8)) & 0xff
  }

  return bytes
}

function zeroWordArray() {
  return CryptoJS.lib.WordArray.create([0, 0, 0, 0], 16)
}
