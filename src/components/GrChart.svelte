<script lang="ts">
  import { scaleLinear, scaleLog } from 'd3-scale';
  import { line } from 'd3-shape';
  import { formatInt } from '../lib/format';
  import type { BValue, Fmd } from '../lib/stats';
  import { axis } from './axis';

  interface Props {
    fmd: Fmd;
    mc: number;
    b: BValue | null;
  }
  let { fmd, mc, b }: Props = $props();

  let width = $state(420);
  const height = 230;
  const M = { top: 10, right: 12, bottom: 36, left: 52 };
  const plotW = $derived(Math.max(120, width - M.left - M.right));
  const plotH = height - M.top - M.bottom;

  const mMax = $derived(fmd.mags.length ? fmd.mags[fmd.mags.length - 1] : 9);
  const x = $derived(
    scaleLinear()
      .domain([4.9, Math.max(7, mMax + 0.2)])
      .range([0, plotW]),
  );
  const y = $derived(
    scaleLog()
      .domain([0.8, Math.max(10, fmd.total * 1.5)])
      .range([plotH, 0])
      .clamp(true),
  );

  const yTicks = $derived.by(() => {
    const top = Math.max(10, fmd.total * 1.5);
    const out: number[] = [];
    for (let v = 1; v <= top; v *= 10) out.push(v);
    return out;
  });

  const fitPath = $derived.by(() => {
    if (!b) return null;
    const pts: [number, number][] = [];
    for (let m = b.mc - 0.05; m <= mMax + 0.05; m += 0.05) {
      const n = 10 ** (b.a - b.b * m);
      if (n < 0.8) break;
      pts.push([x(m), y(n)]);
    }
    return line()(pts);
  });

  const summary = $derived(
    b
      ? `Gutenberg–Richter plot. b-value ${b.b.toFixed(2)} plus or minus ${b.sigma.toFixed(2)}, magnitude of completeness ${b.mc.toFixed(1)}, from ${b.n} earthquakes.`
      : `Gutenberg–Richter plot of ${fmd.total} earthquakes; too few for a b-value.`,
  );
</script>

<div class="chart" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label={summary}>
    <g transform={`translate(${M.left},${M.top})`}>
      {#each yTicks as t (t)}
        <line class="grid" x1="0" x2={plotW} y1={y(t)} y2={y(t)} />
      {/each}
      <g
        class="axis"
        use:axis={{
          scale: y,
          orient: 'left',
          tickValues: yTicks,
          format: (d) => formatInt(Number(d)),
          tickSize: 4,
        }}
      ></g>
      <g
        class="axis"
        transform={`translate(0,${plotH})`}
        use:axis={{
          scale: x,
          orient: 'bottom',
          ticks: 6,
          format: (d) => Number(d).toFixed(0),
          tickSize: 4,
        }}
      ></g>
      <text class="axis-title" x={plotW / 2} y={plotH + 31} text-anchor="middle">Magnitude</text>
      <text
        class="axis-title"
        transform={`translate(${-42},${plotH / 2}) rotate(-90)`}
        text-anchor="middle">Number of earthquakes</text
      >

      {#if Number.isFinite(mc)}
        <line class="mc" x1={x(mc)} x2={x(mc)} y1="0" y2={plotH} />
        <text class="mc-label" x={x(mc) + 5} y={12}>Mc {mc.toFixed(1)}</text>
      {/if}

      {#each fmd.mags as m, j (m)}
        {#if fmd.counts[j] > 0}
          <rect class="inc" x={x(m) - 2.5} y={y(fmd.counts[j]) - 2.5} width="5" height="5" />
        {/if}
      {/each}
      {#each fmd.mags as m, j (m)}
        <circle class="cum" cx={x(m)} cy={y(fmd.cumulative[j])} r="3.1" />
      {/each}
      {#if fitPath}
        <path class="fit" d={fitPath} />
      {/if}
    </g>
  </svg>
  <ul class="key" aria-hidden="true">
    <li><span class="k-cum"></span>N(≥ M), cumulative</li>
    <li><span class="k-inc"></span>per 0.1 magnitude</li>
    {#if b}<li><span class="k-fit"></span>maximum-likelihood fit</li>{/if}
  </ul>
</div>

<style>
  .chart {
    width: 100%;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .grid {
    stroke: var(--rule);
    stroke-width: 1;
  }

  .axis :global(text) {
    font-family: var(--sans);
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .axis :global(path),
  .axis :global(line) {
    stroke: var(--rule-strong);
  }

  .axis-title {
    font-size: 11px;
    font-weight: 600;
    fill: var(--ink-3);
  }

  .inc {
    fill: none;
    stroke: var(--ink-3);
    stroke-width: 1.1;
  }

  .cum {
    fill: var(--ink);
  }

  .fit {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
  }

  .mc {
    stroke: var(--accent);
    stroke-dasharray: 3 3;
    stroke-width: 1;
  }

  .mc-label {
    font-family: var(--serif);
    font-style: italic;
    font-size: 12px;
    fill: var(--accent);
  }

  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 6px 0 0;
    padding: 0 0 0 52px;
    list-style: none;
    font-size: 0.78rem;
    color: var(--ink-3);
  }

  .key li {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .k-cum {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
  }

  .k-inc {
    width: 7px;
    height: 7px;
    border: 1.2px solid var(--ink-3);
  }

  .k-fit {
    width: 16px;
    border-top: 2.2px solid var(--accent);
  }
</style>
