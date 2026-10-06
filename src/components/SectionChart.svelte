<script lang="ts">
  import { scaleLinear } from 'd3-scale';
  import { formatDepth, formatInt, formatUtc } from '../lib/format';
  import { depthColorHex } from '../lib/ramp';
  import { completeEvent, describeIndex } from '../state/actions';
  import { app, data } from '../state/app.svelte';
  import type { SectionResult } from '../worker/protocol';

  interface Props {
    result: SectionResult;
    trueAspect: boolean;
  }
  let { result, trueAspect }: Props = $props();

  let width = $state(420);
  const M = { top: 34, right: 14, bottom: 12, left: 48 };
  const DEPTH_STEPS = [200, 300, 400, 500, 600, 750];
  const MAX_TRUE_H = 520;

  const maxDepth = $derived.by(() => {
    let m = 0;
    for (const d of result.depth) if (d > m) m = d;
    return m;
  });
  const depthMax = $derived(DEPTH_STEPS.find((s) => s >= maxDepth + 15) ?? 750);

  const geom = $derived.by(() => {
    const avail = Math.max(120, width - M.left - M.right);
    let plotW = avail;
    let plotH: number;
    if (trueAspect) {
      plotH = (plotW * depthMax) / result.lengthKm;
      if (plotH > MAX_TRUE_H) {
        plotH = MAX_TRUE_H;
        plotW = (plotH * result.lengthKm) / depthMax;
      }
      plotH = Math.max(plotH, 60);
    } else {
      plotH = Math.min(360, Math.max(220, avail * 0.66));
    }
    const offset = M.left + (avail - plotW) / 2;
    const ve = plotH / depthMax / (plotW / result.lengthKm);
    return { plotW, plotH, offset, ve, height: M.top + plotH + M.bottom + 26 };
  });

  const x = $derived(scaleLinear().domain([0, result.lengthKm]).range([0, geom.plotW]));
  const y = $derived(scaleLinear().domain([0, depthMax]).range([0, geom.plotH]));
  const xTicks = $derived(x.ticks(Math.max(3, Math.round(geom.plotW / 90))));
  const yTicks = $derived(y.ticks(Math.max(3, Math.round(geom.plotH / 55))));

  const sizeFor = (m: number) => {
    const k = Math.max(0, m - 5);
    return 2.1 + 1.55 * k + 0.6 * k * k;
  };

  /** Draw order: small first, so large events stay visible. */
  const points = $derived.by(() => {
    const n = result.index.length;
    const order = Array.from({ length: n }, (_, k) => k).sort(
      (p, q) => result.mag[p] - result.mag[q],
    );
    return order.map((k) => ({
      k,
      cx: x(result.along[k]),
      cy: y(Math.max(0, result.depth[k])),
      r: Math.max(1.7, sizeFor(result.mag[k]) * 0.5),
      fill: depthColorHex(result.depth[k]),
    }));
  });

  const fit = $derived(result.fit.ok ? result.fit.fit : null);
  /** The dip label sits in the bottom corner away from the slab, where sections are empty. */
  const fitLabel = $derived.by(() => {
    if (!fit) return null;
    const right = fit.deepensTowards === -1;
    return { x: right ? geom.plotW - 12 : 12, y: geom.plotH - 14, right };
  });

  let hover = $state<number | null>(null);
  let svgEl = $state<SVGSVGElement>();

  function onMove(e: PointerEvent) {
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const px = e.clientX - rect.left - geom.offset;
    const py = e.clientY - rect.top - M.top;
    let best = -1;
    let bestD = 14 * 14;
    for (const p of points) {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d <= Math.max(bestD, p.r * p.r)) {
        if (d < bestD || best < 0) {
          bestD = d;
          best = p.k;
        }
      }
    }
    hover = best >= 0 ? best : null;
  }

  function onClick() {
    if (hover === null) return;
    const info = describeIndex('catalog', result.index[hover]);
    if (!info) return;
    app.selected = info;
    void completeEvent(info, 'selected');
  }

  const hoverInfo = $derived.by(() => {
    if (hover === null || !data.catalog) return null;
    const i = result.index[hover];
    return {
      mag: result.mag[hover],
      depth: result.depth[hover],
      along: result.along[hover],
      time: data.catalog.time[i],
      cx: x(result.along[hover]),
      cy: y(Math.max(0, result.depth[hover])),
    };
  });

  const minDepth = $derived.by(() => {
    let m = Infinity;
    for (const d of result.depth) if (d < m) m = d;
    return Number.isFinite(m) ? m : 0;
  });
  const summary = $derived(
    result.index.length === 0
      ? `Cross-section from A to A′, ${formatInt(result.lengthKm)} km long, with no earthquakes matching the filters.`
      : `Cross-section from A to A′, ${formatInt(result.lengthKm)} km long, with ${formatInt(result.index.length)} earthquakes from ${formatInt(Math.max(0, minDepth))} to ${formatInt(maxDepth)} km deep` +
          (fit ? `. Fitted slab dip ${fit.dipDeg.toFixed(1)} degrees.` : '.'),
  );

  // Keyboard: the plot is a slider over the earthquakes ordered from A to A′.
  const byAlong = $derived(
    Array.from({ length: result.index.length }, (_, k) => k).sort(
      (p, q) => result.along[p] - result.along[q],
    ),
  );
  function onKey(e: KeyboardEvent) {
    const n = byAlong.length;
    if (n === 0) return;
    const pos = hover === null ? -1 : byAlong.indexOf(hover);
    let next = pos;
    const big = Math.max(1, Math.round(n / 20));
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(n - 1, pos + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
      next = Math.max(0, pos < 0 ? 0 : pos - 1);
    else if (e.key === 'PageUp') next = Math.min(n - 1, pos + big);
    else if (e.key === 'PageDown') next = Math.max(0, pos - big);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
      return;
    } else return;
    e.preventDefault();
    hover = byAlong[next];
  }
  const valueText = $derived.by(() => {
    if (hover === null || !data.catalog) return 'No earthquake highlighted';
    return `M ${result.mag[hover].toFixed(1)}, ${formatDepth(result.depth[hover])} deep, ${formatInt(result.along[hover])} km from A, ${formatUtc(data.catalog.time[result.index[hover]], false)}`;
  });
  const selectedK = $derived.by(() => {
    const s = app.selected;
    if (!s || s.kind !== 'catalog') return -1;
    return result.index.indexOf(s.index);
  });
</script>

<div class="chart" bind:clientWidth={width}>
  <p class="visually-hidden" id={`section-summary-${result.spec.a.join()}`}>{summary}</p>
  <div
    class="slider"
    role="slider"
    tabindex="0"
    aria-label="Earthquakes in the section, from A to A′. Arrow keys step through them; Enter shows details."
    aria-describedby={`section-summary-${result.spec.a.join()}`}
    aria-valuemin={result.index.length ? 1 : 0}
    aria-valuemax={result.index.length}
    aria-valuenow={hover === null ? 0 : byAlong.indexOf(hover) + 1}
    aria-valuetext={valueText}
    onkeydown={onKey}
    onpointermove={onMove}
    onpointerleave={() => (hover = null)}
    onclick={onClick}
  >
    <svg bind:this={svgEl} {width} height={geom.height} aria-hidden="true">
      <g transform={`translate(${geom.offset},${M.top})`}>
        <!-- Axis titles and end labels -->
        <text class="end" x={0} y={-20}>A</text>
        <text class="end" x={geom.plotW} y={-20} text-anchor="end">A′</text>
        <text class="axis-title" x={geom.plotW / 2} y={-22} text-anchor="middle"
          >Distance along the section (km)</text
        >

        <rect class="plot" width={geom.plotW} height={geom.plotH} rx="2" />
        {#each yTicks as t (t)}
          <line class="grid" x1="0" x2={geom.plotW} y1={y(t)} y2={y(t)} />
          <text class="tick" x={-7} y={y(t)} dy="0.32em" text-anchor="end">{t}</text>
        {/each}
        {#each xTicks as t (t)}
          <line class="grid" x1={x(t)} x2={x(t)} y1="0" y2={geom.plotH} />
          <text class="tick" x={x(t)} y={-6} text-anchor="middle">{formatInt(t)}</text>
        {/each}
        {#each [410, 660] as d (d)}
          {#if d < depthMax}
            <line class="disc" x1="0" x2={geom.plotW} y1={y(d)} y2={y(d)} />
            <text class="disc-label" x={geom.plotW - 6} y={y(d) - 5} text-anchor="end">{d} km</text>
          {/if}
        {/each}
        <line class="surface" x1="0" x2={geom.plotW} y1="0" y2="0" />

        {#each points as p (p.k)}
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} />
        {/each}

        {#if fit}
          <line class="fit-halo" x1={x(fit.x1)} y1={y(fit.z1)} x2={x(fit.x2)} y2={y(fit.z2)} />
          <line class="fit" x1={x(fit.x1)} y1={y(fit.z1)} x2={x(fit.x2)} y2={y(fit.z2)} />
          {#if fitLabel}
            <g transform={`translate(${fitLabel.x},${fitLabel.y})`}>
              <line
                class="fit"
                x1={fitLabel.right ? -118 : 0}
                x2={fitLabel.right ? -96 : 22}
                y1="-4"
                y2="-4"
              />
              <text
                class="fit-label"
                x={fitLabel.right ? 0 : 28}
                y="0"
                text-anchor={fitLabel.right ? 'end' : 'start'}
              >
                fitted dip {fit.dipDeg.toFixed(0)}°
              </text>
            </g>
          {/if}
        {/if}

        {#if selectedK >= 0}
          <circle
            class="sel"
            cx={x(result.along[selectedK])}
            cy={y(Math.max(0, result.depth[selectedK]))}
            r={Math.max(6, sizeFor(result.mag[selectedK]) * 0.5 + 4)}
          />
        {/if}
        {#if hoverInfo}
          <circle class="hov" cx={hoverInfo.cx} cy={hoverInfo.cy} r="7" />
        {/if}

        {#if result.index.length === 0}
          <text class="empty" x={geom.plotW / 2} y={geom.plotH / 2} text-anchor="middle">
            No earthquakes match these filters in this corridor.
          </text>
        {/if}

        <text
          class="axis-title"
          transform={`translate(${-36},${geom.plotH / 2}) rotate(-90)`}
          text-anchor="middle">Depth (km)</text
        >
        <text class="ve" x={0} y={geom.plotH + 18}>
          {#if trueAspect || Math.abs(geom.ve - 1) < 0.05}
            True scale: 1 km across = 1 km down
          {:else}
            Vertical exaggeration ×{geom.ve.toFixed(geom.ve < 10 ? 1 : 0)}
          {/if}
        </text>
      </g>
    </svg>
  </div>
  {#if hoverInfo}
    <div
      class="tip num"
      style:left={`${Math.min(width - 190, Math.max(4, geom.offset + hoverInfo.cx + 10))}px`}
      style:top={`${M.top + hoverInfo.cy + 12}px`}
    >
      <strong>M {hoverInfo.mag.toFixed(1)}</strong> · {formatDepth(hoverInfo.depth)}<br />
      {formatUtc(hoverInfo.time, false)}<br />
      <span class="muted">{formatInt(hoverInfo.along)} km from A · click for details</span>
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }

  .slider {
    border-radius: 2px;
  }

  .slider:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
  }

  svg {
    display: block;
    overflow: visible;
    cursor: crosshair;
    font-family: var(--sans);
  }

  .plot {
    fill: var(--basalt);
  }

  .grid {
    stroke: rgba(236, 231, 220, 0.08);
    stroke-width: 1;
  }

  .tick {
    font-size: 11px;
    fill: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }

  .axis-title {
    font-size: 11px;
    font-weight: 600;
    fill: var(--ink-3);
    letter-spacing: 0.02em;
  }

  .end {
    font-family: var(--serif);
    font-size: 15px;
    font-weight: 700;
    fill: var(--ink);
  }

  .surface {
    stroke: rgba(236, 231, 220, 0.6);
    stroke-width: 1;
  }

  .disc {
    stroke: rgba(236, 231, 220, 0.28);
    stroke-dasharray: 3 4;
  }

  .disc-label {
    font-size: 10px;
    fill: rgba(236, 231, 220, 0.62);
    font-style: italic;
    font-family: var(--serif);
  }

  circle {
    fill-opacity: 0.88;
  }

  .fit-halo {
    stroke: rgba(14, 17, 22, 0.85);
    stroke-width: 5;
    stroke-linecap: round;
  }

  .fit {
    stroke: #f6f2e9;
    stroke-width: 2;
    stroke-dasharray: 7 4;
    stroke-linecap: round;
  }

  .fit-label {
    font-family: var(--serif);
    font-size: 13px;
    font-weight: 700;
    fill: #f6f2e9;
    paint-order: stroke;
    stroke: rgba(14, 17, 22, 0.9);
    stroke-width: 4px;
  }

  .sel {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
  }

  .hov {
    fill: none;
    stroke: #fff;
    stroke-width: 1.5;
    stroke-opacity: 0.85;
  }

  .empty {
    font-family: var(--serif);
    font-style: italic;
    font-size: 13px;
    fill: var(--on-dark-2);
  }

  .ve {
    font-size: 11px;
    font-style: italic;
    font-family: var(--serif);
    fill: var(--ink-3);
  }

  .tip {
    position: absolute;
    z-index: 2;
    width: 186px;
    padding: 7px 9px;
    border-radius: var(--radius-sm);
    background: var(--paper-raised);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
    font-size: 0.8rem;
    line-height: 1.4;
    pointer-events: none;
  }

  .muted {
    color: var(--ink-3);
  }
</style>
