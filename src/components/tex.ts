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
  const render = () => {
    node.textContent = current.src;
    void loadKatex().then((k) => {
      k.render(current.src, node, {
        displayMode: current.display ?? false,
        output: 'htmlAndMathml',
        throwOnError: false,
        strict: 'ignore',
      });
    });
  };
  render();
  return {
    update(p: { src: string; display?: boolean }) {
      current = p;
      render();
    },
  };
}
