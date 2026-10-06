import { axisBottom, axisLeft, axisRight, axisTop, type AxisDomain, type AxisScale } from 'd3-axis';
import { select } from 'd3-selection';

export interface AxisParams<D extends AxisDomain> {
  scale: AxisScale<D>;
  orient: 'top' | 'right' | 'bottom' | 'left';
  ticks?: number;
  tickValues?: D[];
  format?: (d: D) => string;
  tickSize?: number;
}

/** Svelte action: renders a d3 axis into an SVG <g> and re-renders when the params change. */
export function axis<D extends AxisDomain>(node: SVGGElement, params: AxisParams<D>) {
  const render = (p: AxisParams<D>) => {
    const make = { top: axisTop, right: axisRight, bottom: axisBottom, left: axisLeft }[p.orient];
    const a = make<D>(p.scale).tickSizeOuter(0);
    if (p.tickSize !== undefined) a.tickSizeInner(p.tickSize);
    if (p.ticks !== undefined) a.ticks(p.ticks);
    if (p.tickValues) a.tickValues(p.tickValues);
    if (p.format) a.tickFormat(p.format);
    select(node).call(a);
  };
  render(params);
  return { update: render };
}
