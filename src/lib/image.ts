// Phone photos are often 12+ MP; a wallpaper never needs more than a 4K screen's worth.
const MAX_EDGE = 3840
const KEEP_BELOW_BYTES = 4 << 20

/** Shrinks a photo for use as a wallpaper (JPEG, at most 4K on its long edge). */
export async function prepareWallpaper(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPEG, PNG, WebP or GIF).')
  // Animated GIFs would lose their animation on a canvas.
  if (file.type === 'image/gif') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`This browser can’t read ${file.name}. HEIC photos from iPhone need to be exported as JPEG first.`)
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < KEEP_BELOW_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Couldn’t encode the image.'))), 'image/jpeg', 0.9),
  )
}
