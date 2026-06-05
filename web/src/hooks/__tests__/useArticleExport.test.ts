import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useArticleExport } from '../useArticleExport';

// --- Helpers ---

function makePNGBlob(size = 1024): Blob {
  const header = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const body = new Uint8Array(size - 4).fill(0xff);
  return new Blob([header, body], { type: 'image/png' });
}

// --- Shared Mocks ---

const mockToBlob = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockPrint = vi.fn();

let cardWidth = 720;
let cardHeight = 800;
let mockDPR = 2;

vi.mock('html-to-image', () => ({
  toBlob: (...args: unknown[]) => mockToBlob(...args),
}));

// Mock HTMLCanvasElement for the master canvas chunking logic
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
});
HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((cb) => {
  cb(makePNGBlob());
});

global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
global.URL.revokeObjectURL = vi.fn();

// Mock Image so that setting src synchronously triggers onload
global.Image = class {
  onload: any;
  set src(_value: string) {
    setTimeout(() => {
      if (this.onload) this.onload(new Event('load'));
    }, 0);
  }
} as any;

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/article/ExportCard', () => ({
  default: ({ onReady }: { onReady?: () => void }) => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({
      width: cardWidth,
      height: cardHeight,
      top: 0,
      left: 0,
      right: cardWidth,
      bottom: cardHeight,
      x: 0,
      y: 0,
      toJSON() {},
    });
    // Add a fake querySelectorAll for images
    el.querySelectorAll = (sel: string) => {
      if (sel === 'img') return [] as any;
      return [];
    };
    onReady?.();
    return el;
  },
}));

vi.mock('react-dom/client', () => ({
  createRoot: (container: Element) => ({
    render: (element: React.ReactElement) => {
      if (element && typeof element === 'object' && 'type' in element) {
        const type = element.type as any;
        const props = element.props as any;
        const result = type(props);
        if (result instanceof HTMLElement) {
          container.appendChild(result);
        }
      }
    },
    unmount: vi.fn(),
  }),
}));

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  cardWidth = 720;
  cardHeight = 800;
  mockDPR = 2;

  Object.defineProperty(window, 'devicePixelRatio', {
    value: mockDPR,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'print', {
    value: mockPrint,
    writable: true,
    configurable: true,
  });

  mockToBlob.mockResolvedValue(makePNGBlob());

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    blob: vi.fn().mockResolvedValue(new Blob(['avatar'], { type: 'image/png' })),
  });

  global.FileReader = class {
    result: string | null = null;
    onloadend: (() => void) | null = null;
    readAsDataURL() {
      this.result = 'data:image/png;base64,abc';
      this.onloadend?.();
    }
  } as any;
});

afterEach(() => {
  document.body
    .querySelectorAll('[style*="left:-9999px"], [style*="left: -9999px"]')
    .forEach((el) => el.remove());
});

// --- Tests ---

describe('useArticleExport', () => {
  it('returns exporting=false and handleExportImage', () => {
    const { result } = renderHook(() => useArticleExport());
    expect(result.current.exporting).toBe(false);
    expect(typeof result.current.handleExportImage).toBe('function');
    expect(typeof result.current.handleExportPdf).toBe('function');
  });

  it('does nothing with empty content', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: '' });
    });
    expect(mockToBlob).not.toHaveBeenCalled();
  });

  it('captures at the shared high quality scale', async () => {
    cardWidth = 720;
    cardHeight = 800;
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    const [, opts] = mockToBlob.mock.calls[0];
    expect(opts.pixelRatio).toBe(4);
    expect(opts.canvasWidth).toBe(opts.width);
    expect(opts.canvasHeight).toBe(opts.height);
    expect(opts.skipAutoScale).toBe(true);
  });

  it('keeps scale and slices tall articles', async () => {
    cardWidth = 720;
    cardHeight = 25000;
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(mockToBlob.mock.calls.length).toBeGreaterThan(1);
    const pixelRatios = mockToBlob.mock.calls.map(([, opts]) => (opts as any).pixelRatio);
    const outputHeights = mockToBlob.mock.calls.map(([, opts]) => (opts as any).height * 4);
    const skipAutoScaleFlags = mockToBlob.mock.calls.map(([, opts]) => (opts as any).skipAutoScale);
    expect(pixelRatios.every((pixelRatio) => pixelRatio === 4)).toBe(true);
    expect(outputHeights.every((height) => height <= 32767)).toBe(true);
    expect(outputHeights.some((height) => height > 16384)).toBe(true);
    expect(skipAutoScaleFlags.every(Boolean)).toBe(true);
    expect(mockToastSuccess).toHaveBeenCalledWith('exportSplitSuccess');
  });

  it('uses original filename for a single image and suffixes sliced images', async () => {
    const downloads: string[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = orig('a');
        let filename = '';
        Object.defineProperty(a, 'download', {
          get: () => filename,
          set: (value) => {
            filename = value;
            downloads.push(value);
          },
          configurable: true,
        });
        Object.defineProperty(a, 'click', { value: vi.fn() });
        return a;
      }
      return orig(tag);
    });

    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'Short', content: 'C' });
    });

    expect(downloads).toEqual(['Short.png']);

    downloads.length = 0;
    cardHeight = 25000;
    mockToBlob.mockClear();

    await act(async () => {
      await result.current.handleExportImage({ title: 'Long', content: 'C' });
    });

    expect(downloads[0]).toBe('Long-1.png');
    expect(downloads[downloads.length - 1]).toMatch(/^Long-\d+\.png$/);
    vi.restoreAllMocks();
  });

  it('downloads valid PNG', async () => {
    const mockClick = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const a = orig('a');
        Object.defineProperty(a, 'click', { value: mockClick });
        return a;
      }
      return orig(tag);
    });

    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'Art', content: 'Text' });
    });

    expect(mockClick).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('prints article PDF without capturing PNG', async () => {
    let printContainer: Element | null = null;
    mockPrint.mockImplementationOnce(() => {
      printContainer = document.querySelector('.print-container.article-print-container');
    });

    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportPdf({ title: 'Art', content: 'Text' });
    });

    expect(mockPrint).toHaveBeenCalled();
    expect(printContainer).not.toBeNull();
    expect(mockToBlob).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('exportPdfSuccess');
  });

  it('cleans up DOM after export', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(document.body.querySelectorAll('[style*="left:-9999px"]')).toHaveLength(0);
  });

  it('sets exporting back to false', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(result.current.exporting).toBe(false);
  });

  it('blocks concurrent exports', async () => {
    const { result } = renderHook(() => useArticleExport());
    let resolve!: () => void;
    mockToBlob.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = () => r(makePNGBlob());
        })
    );

    act(() => {
      result.current.handleExportImage({ title: 'A', content: 'a' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      await result.current.handleExportImage({ title: 'B', content: 'b' });
    });
    expect(mockToBlob).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('resolves avatar via fetch', async () => {
    const url = 'https://example.com/avatar.jpg';
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({
        title: 'T',
        content: 'C',
        author: { avatar: url },
      });
    });
    expect(global.fetch).toHaveBeenCalledWith(url);
  });

  it('falls back on avatar fetch failure', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('net'));
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({
        title: 'T',
        content: 'C',
        author: { avatar: 'https://bad.jpg' },
      });
    });
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it('skips avatar when no URL', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('catches html-to-image error', async () => {
    mockToBlob.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(mockToastError).toHaveBeenCalled();
    expect(result.current.exporting).toBe(false);
  });

  it('catches toBlob returning null', async () => {
    mockToBlob.mockResolvedValue(null);
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(mockToastError).toHaveBeenCalled();
  });

  it('catches empty blob', async () => {
    mockToBlob.mockResolvedValue(new Blob([], { type: 'image/png' }));
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(mockToastError).toHaveBeenCalled();
  });

  it('cleans up DOM on error', async () => {
    mockToBlob.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: 'T', content: 'C' });
    });
    expect(document.body.querySelectorAll('[style*="left:-9999px"]')).toHaveLength(0);
  });

  it('handles empty title', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ title: '', content: 'C' });
    });
    expect(mockToBlob).toHaveBeenCalled();
  });

  it('handles undefined title', async () => {
    const { result } = renderHook(() => useArticleExport());
    await act(async () => {
      await result.current.handleExportImage({ content: 'C' } as any);
    });
    expect(mockToBlob).toHaveBeenCalled();
  });
});
