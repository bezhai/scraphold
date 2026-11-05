// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullscreenButton } from './FullscreenButton';

/** happy-dom has no Fullscreen API: these stand in for the browser's, on the page's own document. */
function fakeFullscreen() {
  let element: Element | null = null;
  const change = (el: Element | null) => {
    element = el;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const request = vi.fn(async () => change(document.documentElement));
  const exit = vi.fn(async () => change(null));
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: request });
  /** The browser leaving fullscreen by itself (Esc, F11). */
  const leave = () => change(null);
  return { request, exit, leave };
}

afterEach(() => {
  cleanup();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
});

describe('FullscreenButton', () => {
  it('is not there when the browser has no Fullscreen API', () => {
    const { container } = render(<FullscreenButton class="btn" />);
    expect(container.innerHTML).toBe('');
  });

  it('puts the whole page in fullscreen and back; the label shows what a click does', () => {
    const api = fakeFullscreen();
    render(<FullscreenButton class="btn small" />);
    const button = screen.getByTestId('fullscreen');
    expect(button.textContent).toBe('全屏');
    expect(button.className).toBe('btn small');

    fireEvent.click(button);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBe(document.documentElement);
    expect(button.textContent).toBe('退出全屏');

    fireEvent.click(button);
    expect(api.exit).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('全屏');
  });

  it('as a glyph (the top bar has no room for the words), the label is its tooltip and accessible name', () => {
    fakeFullscreen();
    render(<FullscreenButton class="btn small" glyph />);
    const button = screen.getByTestId('fullscreen');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.title).toBe('全屏');
    expect(button.getAttribute('aria-label')).toBe('全屏');
    const enterGlyph = button.innerHTML;
    fireEvent.click(button);
    expect(button.title).toBe('退出全屏');
    expect(button.getAttribute('aria-label')).toBe('退出全屏');
    expect(button.innerHTML).not.toBe(enterGlyph);
  });

  it('follows the browser when it leaves fullscreen by itself (Esc, F11)', () => {
    const api = fakeFullscreen();
    render(<FullscreenButton class="btn" />);
    fireEvent.click(screen.getByTestId('fullscreen'));
    expect(screen.getByTestId('fullscreen').textContent).toBe('退出全屏');
    act(() => api.leave());
    expect(screen.getByTestId('fullscreen').textContent).toBe('全屏');
    expect(api.exit).not.toHaveBeenCalled();
  });

  it('a refused request changes nothing and leaves no unhandled rejection', async () => {
    fakeFullscreen();
    // A plain function: a vi.fn would attach its own handlers to the promise it returns.
    const refuse = () => Promise.reject(new TypeError('Permissions check failed'));
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: refuse });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      render(<FullscreenButton class="btn" />);
      fireEvent.click(screen.getByTestId('fullscreen'));
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.getByTestId('fullscreen').textContent).toBe('全屏');
  });
});
