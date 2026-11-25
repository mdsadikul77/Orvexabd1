/**
 * Client-side HD image optimizer for long-term (10-20 year) database & storage efficiency.
 * Resizes oversized camera photos (<= 1280px) and converts to WebP/JPEG at 82% quality,
 * typically shrinking 3-4MB uploads down to ~70-150KB with crisp visual quality.
 */
export async function compressImageFile(
  file: File,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  const maxDimension = options.maxDimension ?? 1280;
  const quality = options.quality ?? 0.82;
  const maxUploadBytes = 1.4 * 1024 * 1024;
  const isImageByName = /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(file.name || '');

  // Keep non-images, small files, and animated GIFs untouched
  if (!file.type.startsWith('image/') && !isImageByName) return file;
  if (file.type === 'image/gif' && file.size <= 1.5 * 1024 * 1024) return file;
  if (file.size <= 110 * 1024 && file.type.startsWith('image/')) return file;

  let objectUrl: string | null = null;
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode error'));
      el.src = objectUrl!;
    });

    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    if (!origW || !origH) return file;

    const renderToBlob = async (dimLimit: number, q: number): Promise<Blob | null> => {
      const scale = Math.min(1, dimLimit / Math.max(origW, origH));
      const targetW = Math.max(1, Math.round(origW * scale));
      const targetH = Math.max(1, Math.round(origH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);

      return await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
          (b) => {
            if (b) {
              resolve(b);
            } else {
              canvas.toBlob((fallback) => resolve(fallback), 'image/jpeg', q);
            }
          },
          'image/webp',
          q
        );
      });
    };

    let blob = await renderToBlob(maxDimension, quality);
    if (blob && blob.size > maxUploadBytes) {
      blob = await renderToBlob(Math.min(maxDimension, 960), Math.min(quality, 0.72));
    }

    if (!blob || (blob.size >= file.size && file.type.startsWith('image/') && file.size <= maxUploadBytes)) {
      return file;
    }

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'orvexa-image';
    return new File([blob], `${baseName}.${ext}`, {
      type: blob.type || 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
