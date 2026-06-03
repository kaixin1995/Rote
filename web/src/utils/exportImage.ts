import { toBlob } from 'html-to-image';

function getCanvasLimits() {
  let maxArea = 160000000;
  let maxDim = 32767;

  if (typeof navigator !== 'undefined' && typeof window !== 'undefined') {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (isMobile) {
      // 移动端更严格的内存和 Canvas 限制
      maxArea = 67108864; // 8192 * 8192
      maxDim = 16384;
    } else {
      // PC 端适当放宽限制 (268M 像素面积)
      maxArea = 268435456; // 16384 * 16384
      maxDim = 32767;
    }
  }

  return { MAX_AREA: maxArea, MAX_DIM: maxDim };
}

export function logExport(step: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[Export ${ts}]`;
  if (data) {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${step}`, data);
  } else {
    // eslint-disable-next-line no-console
    console.log(`${prefix} ${step}`);
  }
}

export function logExportError(step: string, error?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = `[Export ${ts}]`;
  if (error instanceof Error) {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`, { message: error.message, name: error.name });
  } else if (error) {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`, error);
  } else {
    // eslint-disable-next-line no-console
    console.error(`${prefix} ✗ ${step}`);
  }
}

export async function toDataURL(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

export async function waitForImagesToLoad(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll('img'));
  const promises = images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      img.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  });
  await Promise.all(promises);
}

export function calculateScale(width: number, height: number) {
  const { MAX_AREA, MAX_DIM } = getCanvasLimits();
  const currentArea = width * height;
  const maxAreaScale = Math.sqrt(MAX_AREA / currentArea);
  const maxDimScale = Math.min(MAX_DIM / width, MAX_DIM / height);
  const safeScale = Math.min(maxAreaScale, maxDimScale);

  let scale = 4;
  if (scale > safeScale) {
    scale = Math.floor(safeScale * 2) / 2;
    if (scale < 1) scale = 1;
  }

  // eslint-disable-next-line no-console
  console.log('[calculateScale]', {
    width,
    height,
    currentArea,
    MAX_AREA,
    MAX_DIM,
    maxAreaScale,
    maxDimScale,
    safeScale,
    finalScale: scale,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 'unknown',
  });

  return scale;
}

export async function captureElementToPng(el: HTMLElement, scale: number): Promise<Blob> {
  const rect = el.getBoundingClientRect();

  // 直接全量生成图片，不再通过 translate 切片。
  // 切片时的 transform: translateY 容易触发 Chromium 超过 2000px 的合成层降级（1x 分辨率光栅化），导致文字模糊。
  // 因为在上一步 calculateScale 中已经保证了生成尺寸一定在安全范围内，直接生成即可。
  const finalBlob = await toBlob(el, {
    pixelRatio: scale,
    backgroundColor: '#ffffff',
    width: rect.width,
    height: rect.height,
    style: {
      left: '0',
      top: '0',
      margin: '0',
      transformOrigin: 'top left',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
    } as any,
  });

  if (!finalBlob || finalBlob.size === 0) throw new Error('Empty image');
  return finalBlob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function cleanupOffscreenContainers() {
  document.body
    .querySelectorAll(
      '.ai-answer-export-container, [style*="left:-9999px"], [style*="left: -9999px"]'
    )
    .forEach((el) => el.remove());
}
