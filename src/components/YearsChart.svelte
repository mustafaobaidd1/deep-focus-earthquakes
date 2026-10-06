<script lang="ts">
  import { scaleBand, scaleLinear } from 'd3-scale';
  import { formatInt } from '../lib/format';
  import { axis } from './axis';

  interface Props {
    perYear: number[];
    firstYear: number;
    yearMin: number;
    yearMax: number;
    playYear: number | null;
  }
  let { perYear, firstYear, yearMin, yearMax, playYear }: Props = $props();

  let width = $state(420);
  const height = 170;
  const M = { top: 14, right: 10, bottom: 26, left: 46 };
  const plotW = $derived(Math.max(120, width - M.left - M.right));
  const plotH = height - M.top - M.bottom;

  const years = $derived(perYear.map((_, i) => firstYear + i));
  const x = $derived(scaleBand<number>().domain(years).range([0, plotW]).paddingInner(0.18));
  const maxN = $derived(Math.max(10, ...perYear));
  const y = $derived(scaleLinear().domain([0, maxN]).nice(4).range([plotH, 0]));
  const decadeTicks = $derived(years.filter((yr) => yr % 10 === 0));

  const peak = $derived.by(() => {
    let best = 0;
    perYear.forEach((n, i) => {
      if (n > perYear[best]) best = i;
    });
    return { year: firstYear + best, n: perYear[best] };
  });

  const playX = $derived.by(() => {
    if (playYear === null) return null;
    const yr = Math.floor(playYear);
    const bx = x(yr);
    return bx === undefined ? null : bx + x.bandwidth() * (playYear - yr);
  });

  const inRange = (yr: number) => yr >= yearMin && yr <= yearMax;
  const summary = $derived(
    `Earthquakes per year from ${firstYear} to ${firstYear + perYear.length - 1}. The busiest year is ${peak.year} with ${formatInt(peak.n)}.`,
  );
</script>

<div class="chart" bind:clientWidth={width}>
  <svg {width} {height} role="img" aria-label={summary}>
    <g transform={`translate(${M.left},${M.top})`}>
      {#each y.ticks(4) as t (t)}
        <line class="grid" x1="0" x2={plotW} y1={y(t)} y2={y(t)} />
      {/each}
      <g
        class="axis"
        use:axis={{
          scale: y,
          orient: 'left',
          ticks: 4,
          format: (d) => formatInt(Number(d)),
          tickSize: 3,
        }}
      ></g>
      <g
        class="axis"
        transform={`translate(0,${plotH})`}
        use:axis={{
          scale: x,
          orient: 'bottom',
          tickValues: decadeTicks,
          format: (d) => String(d),
          tickSize: 3,
        }}
      ></g>
      {#each perYear as n, i (i)}
        {@const yr = firstYear + i}
        <rect
          class="bar"
          class:out={!inRange(yr) || (playYear !== null && yr > playYear)}
          x={x(yr)}
          y={y(n)}
          width={x.bandwidth()}
          height={Math.max(0, plotH - y(n))}
        />
      {/each}
      {#if peak.n > 0}
        <text
          class="peak num"
          x={(x(peak.year) ?? 0) + x.bandwidth() / 2}
          y={y(peak.n) - 4}
          text-anchor="middle">{formatInt(peak.n)}</text
        >
      {/if}
      {#if playX !== null}
        <line class="play" x1={playX} x2={playX} y1="-6" y2={plotH} />
      {/if}
    </g>
  </svg>
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

  .bar {
    fill: var(--ink);
  }

  .bar.out {
    fill: var(--rule-strong);
  }

  .peak {
    font-size: 10.5px;
    font-weight: 650;
    fill: var(--ink-2);
  }

  .play {
    stroke: var(--accent);
    stroke-width: 2;
  }
</style>
