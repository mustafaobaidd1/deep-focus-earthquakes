<script lang="ts">
  import { scaleLinear, scaleLog } from 'd3-scale';
  import { formatInt } from '../lib/format';
  import { depthColorHex } from '../lib/ramp';
  import { DEPTH_BIN_KM } from '../lib/selection';
  import { axis } from './axis';

  interface Props {
    hist: number[];
    classes: { shallow: number; intermediate: number; deep: number };
    count: number;
  }
  let { hist, classes, count }: Props = $props();

  let width = $state(420);
  const height = 300;
  const M = { top: 22, right: 104, bottom: 10, left: 58 };
  const plotW = $derived(Math.max(100, width - M.left - M.right));
  const plotH = height - M.top - M.bottom;
  const maxDepth = $derived(hist.length * DEPTH_BIN_KM);

  const maxCount = $derived(Math.max(10, ...hist));
  const x = $derived(
    scaleLog()
      .domain([1, maxCount * 1.2])
      .range([0, plotW])
      .clamp(true),
  );
  const y = $derived(scaleLinear().domain([0, maxDepth]).range([0, plotH]));
  const yTicks: number[] = [0, 100, 200, 300, 400, 500, 600, 700];
  const xTicks = $derived.by(() => {
    const out: number[] = [];
    for (let v = 1; v <= maxCount * 1.2; v *= 10) out.push(v);
    return out;
  });
  const barH = $derived(plotH / hist.length);

  const pct = (n: number) => (count > 0 ? (100 * n) / count : 0);
  const bands = $derived([
    { label: 'shallow', from: 0, to: 70, n: classes.shallow },
    { label: 'intermediate', from: 70, to: 300, n: classes.intermediate },
    { label: 'deep', from: 300, to: 700, n: classes.deep },
  ]);

  const summary = $derived(
    `Depth histogram of ${formatInt(count)} earthquakes: ${pct(classes.shallow).toFixed(0)} percent shallow (above 70 km), ${pct(classes.intermediate).toFixed(0)} percent intermediate, ${pct(classes.deep).toFixed(1)} percent deep (below 300 km).`,
  );
</script>

<div class="chart" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label={summary}>
    <g transform={`translate(${M.left},${M.top})`}>
      {#each xTicks as t (t)}
        <line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={plotH} />
      {/each}
      <g
        class="axis"
        use:axis={{
          scale: x,
          orient: 'top',
          tickValues: xTicks,
          format: (d) => formatInt(Number(d)),
          tickSize: 3,
        }}
      ></g>
      <g
        class="axis"
        use:axis={{ scale: y, orient: 'left', tickValues: yTicks, tickSize: 0, tickPadding: 15 }}
      ></g>
      <!-- Depth colour key along the axis -->
      {#each hist as _, k (k)}
        <rect
          x={-10}
          y={y(k * DEPTH_BIN_KM)}
          width="6"
          height={barH + 0.5}
          fill={depthColorHex((k + 0.5) * DEPTH_BIN_KM)}
        />
      {/each}
      {#each hist as n, k (k)}
        {#if n > 0}
          <rect
            class="bar"
            x="0"
            y={y(k * DEPTH_BIN_KM) + 0.4}
            width={Math.max(1, x(Math.max(n, 1)))}
            height={Math.max(0.8, barH - 0.8)}
          />
        {/if}
      {/each}
      <text
        class="axis-title"
        transform={`translate(${-44},${plotH / 2}) rotate(-90)`}
        text-anchor="middle">Depth (km)</text
      >
      {#each bands as band (band.label)}
        <g class="band" transform={`translate(${plotW + 10},0)`}>
          <line x1="0" x2="0" y1={y(band.from) + 1.5} y2={y(band.to) - 1.5} />
          <text x="7" y={(y(band.from) + y(band.to)) / 2 - 3}>{band.label}</text>
          <text class="pct num" x="7" y={(y(band.from) + y(band.to)) / 2 + 12}
            >{pct(band.n) < 10 ? pct(band.n).toFixed(1) : pct(band.n).toFixed(0)}%</text
          >
        </g>
      {/each}
    </g>
  </svg>
  <p class="note">Bars on a logarithmic scale: number of earthquakes per 10 km of depth.</p>
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

  .bar {
    fill: var(--ink);
  }

  .band line {
    stroke: var(--ink-3);
    stroke-width: 1.2;
  }

  .band text {
    font-family: var(--serif);
    font-style: italic;
    font-size: 12px;
    fill: var(--ink-2);
  }

  .band .pct {
    font-family: var(--sans);
    font-style: normal;
    font-weight: 650;
    font-size: 12px;
    fill: var(--ink);
  }

  .note {
    margin: 6px 0 0 58px;
    font-size: 0.78rem;
    color: var(--ink-3);
  }
</style>
