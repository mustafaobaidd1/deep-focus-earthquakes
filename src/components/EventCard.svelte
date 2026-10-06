<script lang="ts">
  import { formatAge, formatDepth, formatLatLon, formatUtc, usgsEventUrl } from '../lib/format';
  import { depthColorHex } from '../lib/ramp';
  import type { EventInfo } from '../state/app.svelte';

  interface Props {
    event: EventInfo;
    mode: 'hover' | 'pinned';
    onclose?: () => void;
  }
  let { event, mode, onclose }: Props = $props();

  const depthClass = $derived(
    event.depthKm < 70 ? 'shallow' : event.depthKm < 300 ? 'intermediate' : 'deep',
  );
  const swatch = $derived(depthColorHex(event.depthKm));
  const link = $derived(event.id ? usgsEventUrl(event.id) : null);
</script>

<div
  class="card {mode}"
  role={mode === 'pinned' ? 'dialog' : 'tooltip'}
  aria-label={mode === 'pinned' ? 'Earthquake details' : undefined}
>
  <div class="top">
    <p class="mag num">
      M&nbsp;{event.mag.toFixed(1)}
      {#if event.magType}<span class="type">{event.magType}</span>{/if}
    </p>
    {#if mode === 'pinned'}
      <button class="close" type="button" onclick={onclose} aria-label="Close details">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"
          ><path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          /></svg
        >
      </button>
    {/if}
  </div>
  <p class="place">
    {#if event.place === null}
      <span class="loading">Looking up the place name…</span>
    {:else if event.place === ''}
      <span class="loading">{formatLatLon(event.lat, event.lon)}</span>
    {:else}
      {event.place}
    {/if}
  </p>
  <dl class="facts num">
    <div>
      <dt>Depth</dt>
      <dd>
        <span class="sw" style:background={swatch} aria-hidden="true"></span>{formatDepth(
          event.depthKm,
        )} · {depthClass}
      </dd>
    </div>
    <div>
      <dt>Time</dt>
      <dd>{formatUtc(event.time)}</dd>
    </div>
    {#if mode === 'pinned'}
      <div>
        <dt>Epicentre</dt>
        <dd>{formatLatLon(event.lat, event.lon)}</dd>
      </div>
      {#if event.kind === 'live'}
        <div>
          <dt>Source</dt>
          <dd>Live feed · {formatAge(Date.now() - event.time * 1000)}</dd>
        </div>
      {/if}
    {/if}
  </dl>
  {#if mode === 'pinned'}
    {#if link}
      <a class="usgs" href={link} target="_blank" rel="noopener noreferrer">
        USGS event page
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
          ><path
            d="M4.5 2.5h5v5M9.5 2.5 3 9"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
            stroke-linecap="round"
          /></svg
        >
        <span class="visually-hidden">(opens in a new tab)</span>
      </a>
    {:else}
      <p class="loading small">Fetching the USGS event id…</p>
    {/if}
  {:else}
    <p class="hint">Click for the USGS event page</p>
  {/if}
</div>

<style>
  .card {
    width: 280px;
    max-width: calc(100vw - 32px);
    padding: 12px 14px 12px;
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.4),
      0 1px 0 rgba(255, 255, 255, 0.4) inset;
  }

  .card.hover {
    pointer-events: none;
  }

  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .mag {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.35rem;
    font-weight: 650;
    line-height: 1.1;
  }

  .type {
    margin-left: 0.3em;
    font-family: var(--sans);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: -6px -8px 0 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--ink-2);
  }

  .close:hover {
    background: var(--paper-sunk);
    color: var(--ink);
  }

  .place {
    margin: 4px 0 8px;
    font-family: var(--serif);
    font-size: 0.98rem;
    line-height: 1.35;
  }

  .loading {
    color: var(--ink-3);
    font-style: italic;
  }

  .small {
    margin: 8px 0 0;
    font-size: 0.85rem;
  }

  .facts {
    display: grid;
    gap: 3px;
    margin: 0;
    font-size: 0.85rem;
  }

  .facts div {
    display: grid;
    grid-template-columns: 4.6rem 1fr;
    gap: 6px;
  }

  dt {
    color: var(--ink-3);
    font-weight: 600;
  }

  dd {
    margin: 0;
    color: var(--ink);
  }

  .sw {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 6px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    vertical-align: 0;
  }

  .usgs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    margin-top: 8px;
    font-weight: 650;
    font-size: 0.9rem;
    color: var(--accent);
    text-underline-offset: 3px;
  }

  .hint {
    margin: 8px 0 0;
    font-size: 0.78rem;
    color: var(--ink-3);
  }
</style>
