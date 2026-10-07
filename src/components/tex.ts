/**
 * Svelte action that typesets a TeX string with KaTeX. KaTeX (and its CSS and fonts) load on
 * first use only — the "How it works" drawer — so they never weigh on the first screen.
 * Until it arrives, the plain TeX source is shown.
 */
type Katex = typeof import('katex').default;
let katexPromise: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  katexPromise ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([m]) => m.default,
  );
  return katexPromise;
}

export function tex(node: HTMLElement, params: { src: string; display?: boolean }) {
  let current = params;
  // A display equation wider than a phone scrolls sideways; a scrollable region must be
  // reachable by keyboard (WCAG 2.1.1), so it becomes focusable only while it overflows.
  const syncFocusable = () => {
    if (!(current.display ?? false)) return;
    if (node.scrollWidth > node.clientWidth + 1) {
      node.tabIndex = 0;
      node.setAttribute('role', 'group');
      node.setAttribute('aria-label', 'Equation (scrolls sideways)');
    } else {
      node.removeAttribute('tabindex');
      node.removeAttribute('role');
      node.removeAttribute('aria-label');
    }
  };
  const ro = new ResizeObserver(syncFocusable);
  ro.observe(node);
  const render = () => {
    node.textContent = current.src;
    void loadKatex().then((k) => {
      k.render(current.src, node, {
        displayMode: current.display ?? false,
        output: 'htmlAndMathml',
        throwOnError: false,
        strict: 'ignore',
      });
      syncFocusable();
    });
  };
  render();
  return {
    update(p: { src: string; display?: boolean }) {
      current = p;
      render();
    },
    destroy() {
      ro.disconnect();
    },
  };
}
