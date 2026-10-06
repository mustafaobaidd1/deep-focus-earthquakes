<script lang="ts">
  import { LIMITS, defaultFilter, isDefault } from '../lib/filters';
  import { formatInt } from '../lib/format';
  import { app, pausePlayback, startPlayback, stopPlayback } from '../state/app.svelte';
  import RangeSlider from './RangeSlider.svelte';

  interface Props {
    variant: 'dark' | 'paper';
  }
  let { variant }: Props = $props();

  const count = $derived(app.stats?.count ?? null);
  const total = $derived(app.stats?.total ?? null);
  const playYearLabel = $derived(app.playYear === null ? null : Math.floor(app.playYear));

  // Announce counts politely, after the sliders settle, and not on every playback frame.
  let announced = $state('');
  let announceTimer = 0;
  $effect(() => {
    const c = count;
    const t = total;
    const playing = app.playing;
    clearTimeout(announceTimer);
    if (c === null || t === null || playing) return;
    announceTimer = window.setTimeout(() => {
      announced =
        c === 0
          ? 'No earthquakes match these filters.'
          : `${formatInt(c)} of ${formatInt(t)} earthquakes match the filters.`;
    }, 700);
  });

  const depthQuick: { label: string; title: string; range: [number, number] }[] = [
    { label: 'All', title: 'All depths', range: [0, 700] },
    { label: '< 70', title: 'Shallow: above 70 km', range: [0, 70] },
    { label: '70–300', title: 'Intermediate: 70 to 300 km', range: [70, 300] },
    { label: '300 +', title: 'Deep: 300 km and below', range: [300, 700] },
  ];

  function setDepth([lo, hi]: [number, number]) {
    app.filter = { ...app.filter, depthMin: lo, depthMax: hi };
  }

  function reset() {
    stopPlayback();
    app.filter = defaultFilter();
  }

  function togglePlay() {
    if (app.playing) pausePlayback();
    else startPlayback();
  }

  const fmtMag = (v: number) => v.toFixed(1);
  const fmtInt = (v: number) => String(Math.round(v));
</script>

<div class="filters {variant}" class:dark={variant === 'dark'} role="group" aria-label="Filters">
  <div class="count">
    <p class="num">
      {#if count === null}
        <span class="muted">Counting…</span>
      {:else if count === total}
        <strong>{formatInt(count)}</strong>
        <span class="muted">earthquakes, all shown</span>
      {:else}
        <strong>{formatInt(count)}</strong>
        <span class="muted">of {formatInt(total ?? 0)} earthquakes</span>
      {/if}
    </p>
    <button
      class="btn quiet reset"
      type="button"
      onclick={reset}
      disabled={isDefault(app.filter) && app.playYear === null}
    >
      Reset filters
    </button>
  </div>

  <div class="time">
    <button
      class="btn play"
      class:primary={app.playing}
      type="button"
      onclick={togglePlay}
      aria-label={app.playing ? 'Pause playback' : 'Play through the years'}
      disabled={app.status !== 'ready'}
    >
      {#if app.playing}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
          ><rect x="2" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" /><rect
            x="8.5"
            y="1.5"
            width="3.5"
            height="11"
            rx="1"
            fill="currentColor"
          /></svg
        >
        <span>Pause</span>
      {:else}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
          ><path
            d="M3 1.6v10.8a.6.6 0 0 0 .9.5l8.6-5.4a.6.6 0 0 0 0-1L3.9 1.1a.6.6 0 0 0-.9.5z"
            fill="currentColor"
          /></svg
        >
        <span>{app.playYear === null ? 'Play years' : 'Resume'}</span>
      {/if}
    </button>
    <div class="slider-with-head">
      <RangeSlider
        id={`years-${variant}`}
        label="Years"
        min={LIMITS.year[0]}
        max={LIMITS.year[1]}
        step={1}
        bind:low={app.filter.yearMin}
        bind:high={app.filter.yearMax}
        format={fmtInt}
        allLabel={`${LIMITS.year[0]}–${LIMITS.year[1]}`}
        {variant}
        disabled={app.playing}
      />
      {#if playYearLabel !== null}
        <div class="playhead num" aria-live="off">
          <span>Through {playYearLabel}</span>
          <button
            class="btn quiet stop"
            type="button"
            onclick={stopPlayback}
            aria-label="Stop playback and show all years"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
              ><path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              /></svg
            >
          </button>
        </div>
      {/if}
    </div>
  </div>

  <RangeSlider
    id={`mag-${variant}`}
    label="Magnitude"
    min={LIMITS.mag[0]}
    max={LIMITS.mag[1]}
    step={0.1}
    bind:low={app.filter.magMin}
    bind:high={app.filter.magMax}
    format={fmtMag}
    allLabel="all, 5.0 and up"
    {variant}
  />

  <div class="depth">
    <RangeSlider
      id={`depth-${variant}`}
      label="Depth"
      min={LIMITS.depth[0]}
      max={LIMITS.depth[1]}
      step={10}
      bind:low={app.filter.depthMin}
      bind:high={app.filter.depthMax}
      format={fmtInt}
      unit=" km"
      allLabel="all depths"
      {variant}
    />
    <div class="quick" role="group" aria-label="Depth classes">
      {#each depthQuick as q (q.label)}
        <button
          type="button"
          title={q.title}
          aria-label={q.title}
          aria-pressed={app.filter.depthMin === q.range[0] && app.filter.depthMax === q.range[1]}
          onclick={() => setDepth(q.range)}>{q.label}</button
        >
      {/each}
    </div>
  </div>

  <p class="visually-hidden" aria-live="polite">{announced}</p>
</div>

<style>
  .filters {
    display: grid;
    gap: 14px 22px;
    padding: 14px 16px 16px;
  }

  .filters.dark {
    grid-template-columns: minmax(250px, 1.35fr) minmax(170px, 1fr) minmax(200px, 1fr);
    grid-template-areas:
      'count count count'
      'time mag depth';
    align-items: start;
    gap: 6px 26px;
    padding: 8px 18px 12px;
    border-top: 1px solid var(--basalt-line);
    background: linear-gradient(to bottom, rgba(14, 17, 22, 0.94), #0e1116);
  }

  .filters.paper {
    grid-template-columns: minmax(0, 1fr);
  }

  .count {
    grid-area: count;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 30px;
  }

  .paper .count {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }

  .count p {
    margin: 0;
    font-size: 0.95rem;
  }

  .count strong {
    font-family: var(--serif);
    font-size: 1.15rem;
    font-weight: 650;
  }

  .muted {
    color: var(--ink-3);
  }

  .dark .muted {
    color: var(--on-dark-2);
  }

  .reset {
    min-height: 32px;
    padding: 0 0.6rem;
    font-size: 0.8rem;
  }

  .dark .reset {
    background: transparent;
    border-color: transparent;
    backdrop-filter: none;
  }

  .time {
    grid-area: time;
    display: flex;
    align-items: flex-end;
    align-self: start;
    gap: 12px;
    min-width: 0;
  }

  .play {
    flex: none;
    min-width: 7.2rem;
    min-height: 44px;
  }

  .slider-with-head {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .playhead {
    position: absolute;
    right: 0;
    top: -6px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 8px;
    font-weight: 700;
    font-size: 0.92rem;
    background: inherit;
  }

  .dark .playhead {
    background: #0f1217;
    color: var(--accent-on-dark);
  }

  .paper .playhead {
    background: var(--paper);
    color: var(--accent);
  }

  .stop {
    width: 28px;
    min-height: 28px;
    padding: 0;
  }

  .dark .stop {
    background: transparent;
    border-color: transparent;
  }

  .depth {
    grid-area: depth;
    min-width: 0;
  }

  .filters :global(.range) {
    grid-area: auto;
  }

  .filters.dark > :global(.range) {
    grid-area: mag;
  }

  .quick {
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .quick button {
    flex: 1 1 0;
    min-height: 26px;
    padding: 0 4px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 0.75rem;
    font-weight: 650;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .quick button:hover {
    border-color: var(--ink-3);
    color: var(--ink);
  }

  .quick button[aria-pressed='true'] {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }

  .dark .quick button {
    border-color: var(--basalt-line-strong);
    color: var(--on-dark-2);
  }

  .dark .quick button:hover {
    border-color: rgba(236, 231, 220, 0.55);
    color: var(--on-dark);
  }

  .dark .quick button[aria-pressed='true'] {
    background: var(--on-dark);
    border-color: var(--on-dark);
    color: var(--basalt);
  }

  @media (pointer: coarse) {
    .quick button {
      min-height: 36px;
    }
  }

  @media (max-width: 1099px) and (min-width: 700px) {
    .filters.dark {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas:
        'count count'
        'time time'
        'mag depth';
    }
  }

  @media (max-width: 699px) {
    .paper .play {
      min-width: 8rem;
    }
  }
</style>
