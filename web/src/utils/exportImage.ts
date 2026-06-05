import { toBlob } from 'html-to-image';

const DEFAULT_EXPORT_SCALE = 4;
const MIN_SAFE_OUTPUT_HEIGHT = 2048;
const SLICE_DOWNLOAD_DELAY_MS = 80;
const EXPORT_CONTAINER_CLASS = 'export-render-container';
const SLICE_VIEWPORT_CLASS = 'export-slice-viewport';

interface CanvasLimitHints {
  MAX_AREA: number;
  MAX_DIM: number;
  safeMaxOutputHeight: number;
  safetyFactor: number;
  reason: string;
}

interface CanvasHeightSupport {
  canUseFullHeight: boolean;
  maxOutputHeight: number;
  capability: 'probed' | 'estimated';
  reason: string;
}

interface CaptureOptions {
  backgroundColor?: string;
  scale?: number;
}

export interface ExportPngPart {
  blob: Blob;
  cssHeight: number;
  outputHeight: number;
  index: number;
  total: number;
}

export interface ExportPngResult {
  files: number;
  mode: 'single' | 'sliced';
  scale: number;
  outputWidth: number;
  outputHeight: number;
  maxSliceOutputHeight: number;
  sliceCssHeight: number;
  totalSize: number;
  capability: 'probed' | 'estimated';
  reason: string;
}

export interface OffscreenExportElement {
  container: HTMLElement;
  element: HTMLElement;
  cleanup: () => void;
}

interface RenderOffscreenExportElementOptions {
  className?: string;
  render: (container: HTMLElement, onReady: () => void) => (() => void) | void;
}

class BlankCaptureError extends Error {
  constructor() {
    super('Blank image capture');
    this.name = 'BlankCaptureError';
  }
}

function getCanvasLimits(): CanvasLimitHints {
  let maxArea = 160000000;
  let maxDim = 32767;
  let safetyFactor = 0.9;
  let reason = 'default';

  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return {
      MAX_AREA: maxArea,
      MAX_DIM: maxDim,
      safeMaxOutputHeight: Math.floor(maxDim * safetyFactor),
      safetyFactor,
      reason,
    };
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  if (isMobile) {
    maxArea = 67108864;
    maxDim = 16384;
    safetyFactor = 0.85;
    reason = 'mobile';
  } else {
    maxArea = 268435456;
    maxDim = 32767;
    safetyFactor = 0.92;
    reason = 'desktop';
  }

  if (typeof deviceMemory === 'number') {
    if (deviceMemory <= 2) {
      maxArea = Math.min(maxArea, 33554432);
      maxDim = Math.min(maxDim, 8192);
      safetyFactor = Math.min(safetyFactor, 0.8);
      reason += '-low-memory';
    } else if (deviceMemory <= 4) {
      maxArea = Math.min(maxArea, 67108864);
      maxDim = Math.min(maxDim, 16384);
      safetyFactor = Math.min(safetyFactor, 0.85);
      reason += '-medium-memory';
    }
  }

  return {
    MAX_AREA: maxArea,
    MAX_DIM: maxDim,
    safeMaxOutputHeight: Math.floor(maxDim * safetyFactor),
    safetyFactor,
    reason,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFontsToLoad() {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;

  await Promise.race([document.fonts.ready, delay(3000)]);
}

function getRawMaxOutputHeight(outputWidth: number, limits: CanvasLimitHints) {
  const areaHeight = Math.floor(limits.MAX_AREA / Math.max(1, outputWidth));
  return Math.max(MIN_SAFE_OUTPUT_HEIGHT, Math.min(limits.MAX_DIM, areaHeight));
}

function getEstimatedMaxOutputHeight(outputWidth: number, limits: CanvasLimitHints) {
  const rawHeight = getRawMaxOutputHeight(outputWidth, limits);
  return Math.max(
    MIN_SAFE_OUTPUT_HEIGHT,
    Math.min(limits.safeMaxOutputHeight, Math.floor(rawHeight * limits.safetyFactor))
  );
}

function probeCanvasSize(width: number, height: number): boolean | undefined {
  if (typeof document === 'undefined') return undefined;

  const canvas = document.createElement('canvas');
  const canvasWidth = Math.max(1, Math.floor(width));
  const canvasHeight = Math.max(1, Math.floor(height));

  try {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      return false;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.getImageData !== 'function') {
      return undefined;
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(canvasWidth - 1, canvasHeight - 1, 1, 1);
    return ctx.getImageData(canvasWidth - 1, canvasHeight - 1, 1, 1).data[3] > 0;
  } catch {
    return false;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

function getCanvasHeightSupport(
  outputWidth: number,
  desiredOutputHeight: number
): CanvasHeightSupport {
  const limits = getCanvasLimits();
  const rawMaxHeight = getRawMaxOutputHeight(outputWidth, limits);
  const estimatedMaxHeight = getEstimatedMaxOutputHeight(outputWidth, limits);

  if (desiredOutputHeight <= rawMaxHeight) {
    const directProbe = probeCanvasSize(outputWidth, desiredOutputHeight);
    if (directProbe === true) {
      return {
        canUseFullHeight: true,
        maxOutputHeight: desiredOutputHeight,
        capability: 'probed',
        reason: limits.reason,
      };
    }

    if (directProbe === undefined && desiredOutputHeight <= estimatedMaxHeight) {
      return {
        canUseFullHeight: true,
        maxOutputHeight: desiredOutputHeight,
        capability: 'estimated',
        reason: limits.reason,
      };
    }
  }

  const highestCandidate = Math.min(desiredOutputHeight, rawMaxHeight);
  const highProbe = probeCanvasSize(outputWidth, highestCandidate);

  if (highProbe === true) {
    return {
      canUseFullHeight: false,
      maxOutputHeight: highestCandidate,
      capability: 'probed',
      reason: limits.reason,
    };
  }

  if (highProbe === undefined) {
    return {
      canUseFullHeight: false,
      maxOutputHeight: Math.min(highestCandidate, estimatedMaxHeight),
      capability: 'estimated',
      reason: limits.reason,
    };
  }

  let low = MIN_SAFE_OUTPUT_HEIGHT;
  let high = highestCandidate;
  let best = 0;

  while (low <= high) {
    const candidateHeight = Math.floor((low + high) / 2);
    const probe = probeCanvasSize(outputWidth, candidateHeight);

    if (probe === true) {
      best = candidateHeight;
      low = candidateHeight + 1;
    } else if (probe === undefined && candidateHeight <= estimatedMaxHeight) {
      return {
        canUseFullHeight: false,
        maxOutputHeight: candidateHeight,
        capability: 'estimated',
        reason: limits.reason,
      };
    } else {
      high = candidateHeight - 1;
    }
  }

  return {
    canUseFullHeight: false,
    maxOutputHeight: best || Math.min(MIN_SAFE_OUTPUT_HEIGHT, estimatedMaxHeight),
    capability: best ? 'probed' : 'estimated',
    reason: limits.reason,
  };
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

export function calculateScale(_width: number, _height: number) {
  return DEFAULT_EXPORT_SCALE;
}

function getElementRect(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid export size ${width}x${height}`);
  }

  return { width, height };
}

async function getCapturePlan(el: HTMLElement, options: CaptureOptions | undefined) {
  const { width, height } = getElementRect(el);
  const scale = options?.scale ?? DEFAULT_EXPORT_SCALE;
  const outputWidth = Math.ceil(width * scale);
  const outputHeight = Math.ceil(height * scale);
  const support = getCanvasHeightSupport(outputWidth, outputHeight);

  if (support.canUseFullHeight) {
    return {
      mode: 'single' as const,
      scale,
      width,
      height,
      outputWidth,
      outputHeight,
      maxSliceOutputHeight: outputHeight,
      sliceCssHeight: height,
      sliceCount: 1,
      capability: support.capability,
      reason: support.reason,
    };
  }

  const sliceCssHeight = Math.max(1, Math.floor(support.maxOutputHeight / scale));

  return {
    mode: 'sliced' as const,
    scale,
    width,
    height,
    outputWidth,
    outputHeight,
    maxSliceOutputHeight: support.maxOutputHeight,
    sliceCssHeight,
    sliceCount: Math.ceil(height / sliceCssHeight),
    capability: support.capability,
    reason: support.reason,
  };
}

async function captureNodeToPng(
  el: HTMLElement,
  width: number,
  height: number,
  scale: number,
  backgroundColor: string,
  style?: Partial<CSSStyleDeclaration>
) {
  const blob = await toBlob(el, {
    pixelRatio: scale,
    backgroundColor,
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    skipAutoScale: true,
    style: {
      left: '0',
      top: '0',
      margin: '0',
      transformOrigin: 'top left',
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      ...style,
    } as any,
  });

  if (!blob || blob.size === 0) throw new Error('Empty image');
  return blob;
}

async function captureElementSliceToPng(
  el: HTMLElement,
  width: number,
  fullHeight: number,
  sliceTop: number,
  sliceHeight: number,
  scale: number,
  backgroundColor: string
) {
  return captureNodeToPng(el, width, sliceHeight, scale, backgroundColor, {
    height: `${fullHeight}px`,
    marginTop: `-${sliceTop}px`,
    overflow: 'visible',
  });
}

async function isLikelyBlankPng(blob: Blob) {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return false;

  let bitmap: ImageBitmap | undefined;

  try {
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(64, bitmap.width);
    canvas.height = Math.min(256, bitmap.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== 'function') return false;

    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let visiblePixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];

      if (alpha > 16 && (red < 253 || green < 253 || blue < 253)) {
        visiblePixels += 1;
      }
    }

    return visiblePixels === 0;
  } catch {
    return false;
  } finally {
    bitmap?.close();
  }
}

export async function captureElementToPng(el: HTMLElement, scale: number): Promise<Blob> {
  const { width, height } = getElementRect(el);
  return captureNodeToPng(el, width, height, scale, '#ffffff');
}

function createSlicedPlan(
  plan: Awaited<ReturnType<typeof getCapturePlan>>,
  maxSliceOutputHeight: number
) {
  const safeMaxSliceOutputHeight = Math.max(
    MIN_SAFE_OUTPUT_HEIGHT,
    Math.min(plan.outputHeight, maxSliceOutputHeight)
  );
  const sliceCssHeight = Math.max(1, Math.floor(safeMaxSliceOutputHeight / plan.scale));

  return {
    ...plan,
    mode: 'sliced' as const,
    maxSliceOutputHeight: safeMaxSliceOutputHeight,
    sliceCssHeight,
    sliceCount: Math.ceil(plan.height / sliceCssHeight),
  };
}

async function captureSlicedParts(
  el: HTMLElement,
  plan: Awaited<ReturnType<typeof getCapturePlan>>,
  backgroundColor: string
) {
  const parts: ExportPngPart[] = [];

  for (let index = 0; index < plan.sliceCount; index += 1) {
    const sliceTop = index * plan.sliceCssHeight;
    const sliceHeight = Math.min(plan.sliceCssHeight, plan.height - sliceTop);
    const blob = await captureElementSliceToPng(
      el,
      plan.width,
      plan.height,
      sliceTop,
      sliceHeight,
      plan.scale,
      backgroundColor
    );

    if (await isLikelyBlankPng(blob)) {
      throw new BlankCaptureError();
    }

    parts.push({
      blob,
      cssHeight: sliceHeight,
      outputHeight: Math.ceil(sliceHeight * plan.scale),
      index,
      total: plan.sliceCount,
    });
  }

  return parts;
}

export async function captureElementToPngParts(
  el: HTMLElement,
  options?: CaptureOptions
): Promise<{ parts: ExportPngPart[]; result: Omit<ExportPngResult, 'files' | 'totalSize'> }> {
  await waitForFontsToLoad();

  const backgroundColor = options?.backgroundColor ?? '#ffffff';
  let plan = await getCapturePlan(el, options);

  logExport('Capture plan', {
    mode: plan.mode,
    cssSize: `${plan.width}x${plan.height}`,
    outputPixels: `${plan.outputWidth}x${plan.outputHeight}`,
    scale: plan.scale,
    maxSliceOutputHeight: plan.maxSliceOutputHeight,
    sliceCssHeight: plan.sliceCssHeight,
    sliceCount: plan.sliceCount,
    capability: plan.capability,
    reason: plan.reason,
  });

  if (plan.mode === 'single') {
    const blob = await captureNodeToPng(el, plan.width, plan.height, plan.scale, backgroundColor);
    if (await isLikelyBlankPng(blob)) {
      plan = createSlicedPlan(plan, Math.floor(plan.outputHeight / 2));
    } else {
      return {
        parts: [
          {
            blob,
            cssHeight: plan.height,
            outputHeight: plan.outputHeight,
            index: 0,
            total: 1,
          },
        ],
        result: {
          mode: plan.mode,
          scale: plan.scale,
          outputWidth: plan.outputWidth,
          outputHeight: plan.outputHeight,
          maxSliceOutputHeight: plan.maxSliceOutputHeight,
          sliceCssHeight: plan.sliceCssHeight,
          capability: plan.capability,
          reason: plan.reason,
        },
      };
    }
  }

  let activePlan = createSlicedPlan(plan, plan.maxSliceOutputHeight);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const parts = await captureSlicedParts(el, activePlan, backgroundColor);
      return {
        parts,
        result: {
          mode: activePlan.mode,
          scale: activePlan.scale,
          outputWidth: activePlan.outputWidth,
          outputHeight: activePlan.outputHeight,
          maxSliceOutputHeight: activePlan.maxSliceOutputHeight,
          sliceCssHeight: activePlan.sliceCssHeight,
          capability: activePlan.capability,
          reason: activePlan.reason,
        },
      };
    } catch (error) {
      if (!(error instanceof BlankCaptureError)) throw error;

      const nextMaxSliceOutputHeight = Math.floor(activePlan.maxSliceOutputHeight / 2);
      if (nextMaxSliceOutputHeight < MIN_SAFE_OUTPUT_HEIGHT) throw error;

      logExport('Blank slice detected, retrying with smaller slices', {
        previousMaxSliceOutputHeight: activePlan.maxSliceOutputHeight,
        nextMaxSliceOutputHeight,
      });
      activePlan = createSlicedPlan(activePlan, nextMaxSliceOutputHeight);
    }
  }

  throw new BlankCaptureError();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getPartFilename(filename: string, index: number, total: number) {
  const normalizedFilename = filename.trim() || 'export.png';
  const pngFilename = normalizedFilename.toLowerCase().endsWith('.png')
    ? normalizedFilename
    : `${normalizedFilename}.png`;

  if (total === 1) return pngFilename;

  return pngFilename.replace(/\.png$/i, `-${index + 1}.png`);
}

export async function exportElementToPng(
  el: HTMLElement,
  filename: string,
  options?: CaptureOptions
): Promise<ExportPngResult> {
  const { parts, result } = await captureElementToPngParts(el, options);

  for (const part of parts) {
    downloadBlob(part.blob, getPartFilename(filename, part.index, part.total));
    if (parts.length > 1) await delay(SLICE_DOWNLOAD_DELAY_MS);
  }

  return {
    ...result,
    files: parts.length,
    totalSize: parts.reduce((total, part) => total + part.blob.size, 0),
  };
}

export async function renderOffscreenExportElement({
  className,
  render,
}: RenderOffscreenExportElementOptions): Promise<OffscreenExportElement> {
  const container = document.createElement('div');
  container.className = [EXPORT_CONTAINER_CLASS, className].filter(Boolean).join(' ');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(container);

  let cleanupRender: (() => void) | undefined;

  try {
    await new Promise<void>((resolve) => {
      cleanupRender = render(container, resolve) || undefined;
    });

    const element = container.firstElementChild as HTMLElement | null;
    if (!element) throw new Error('Card not rendered');

    await delay(100);
    await waitForImagesToLoad(element);
    await waitForFontsToLoad();

    return {
      container,
      element,
      cleanup: () => {
        cleanupRender?.();
        container.remove();
      },
    };
  } catch (error) {
    cleanupRender?.();
    container.remove();
    throw error;
  }
}

export function cleanupOffscreenContainers() {
  document.body
    .querySelectorAll(
      [
        `.${EXPORT_CONTAINER_CLASS}`,
        `.${SLICE_VIEWPORT_CLASS}`,
        '.ai-answer-export-container',
        '[style*="left:-9999px"]',
        '[style*="left: -9999px"]',
      ].join(',')
    )
    .forEach((el) => el.remove());
}
