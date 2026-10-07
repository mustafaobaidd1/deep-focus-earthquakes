<script lang="ts">
  import { setLiveEnabled } from '../state/actions';
  import { app, type ViewKind } from '../state/app.svelte';
  import Icon from './Icon.svelte';
  import Segmented from './Segmented.svelte';

  interface Props {
    compact: boolean;
    onreset: () => void;
  }
  let { compact, onreset }: Props = $props();

  let moreOpen = $state(false);
  const isGlobe = $derived(app.view === 'globe');

  const depthOptions = [
    {
      value: 'surface',
      label: 'Surface',
      title: 'Every earthquake at its epicentre on the surface',
    },
    {
      value: 'depth',
      label: 'True depth',
      title: 'Drop every earthquake to its depth inside the Earth',
    },
  ] as const;
  const exagOptions = [
    { value: 1, label: '×1', title: 'True scale' },
    { value: 2, label: '×2', title: 'Depths exaggerated two times' },
    { value: 4, label: '×4', title: 'Depths exaggerated four times' },
  ];

  let depthValue = $derived(app.depthMode ? 'depth' : 'surface');

  function setDepth(v: string) {
    app.depthMode = v === 'depth';
  }

  function setView(v: ViewKind) {
    app.view = v;
    moreOpen = false;
  }

  function toggleDraw() {
    app.drawMode = !app.drawMode;
    app.interacted = true;
  }
</script>

{#snippet secondary()}
  <button
    class="btn"
    type="button"
    aria-pressed={app.liveEnabled}
    onclick={() => setLiveEnabled(!app.liveEnabled)}
    title="Overlay the USGS feed of the past 30 days (M 2.5+)"
  >
    <Icon name="live" />
    <span>Live feed</span>
  </button>
  <button
    class="btn"
    type="button"
    aria-pressed={app.showPlates}
    onclick={() => (app.showPlates = !app.showPlates)}
    title="Show plate boundaries (PB2002)"
  >
    <Icon name="plates" />
    <span>Plates</span>
  </button>
  {#if isGlobe}
    <button
      class="btn"
      type="button"
      aria-pressed={app.autoRotate}
      onclick={() => (app.autoRotate = !app.autoRotate)}
      disabled={app.reducedMotion}
      title={app.reducedMotion
        ? 'Off because your system asks for reduced motion'
        : 'Slowly turn the globe'}
    >
      <Icon name="rotate" />
      <span>Rotate</span>
    </button>
  {/if}
  {#if isGlobe}
    <button
      class="btn"
      type="button"
      onclick={() => setView('map')}
      title="Switch to a flat world map"
    >
      <Icon name="map" />
      <span>Flat map</span>
    </button>
  {:else}
    <button
      class="btn"
      type="button"
      onclick={() => setView('globe')}
      disabled={!app.webgl}
      title={app.webgl
        ? 'Switch back to the 3D globe'
        : 'The 3D globe needs WebGL, which is unavailable here'}
    >
      <Icon name="globe" />
      <span>3D globe</span>
    </button>
  {/if}
  {#if isGlobe}
    <button class="btn" type="button" onclick={onreset} title="Back to the starting view">
      <Icon name="reset" />
      <span>Reset</span>
    </button>
  {/if}
{/snippet}

{#if !compact}
  <div class="toolbar wide" role="group" aria-label="Map controls">
    <div class="row">
      <Segmented
        label="Where to draw earthquakes"
        options={[...depthOptions]}
        value={depthValue}
        onchange={setDepth}
        disabled={!isGlobe}
        title={isGlobe ? undefined : 'True depth needs the 3D globe'}
      />
      <!-- Always present (disabled in surface mode) so switching modes never shifts the toolbar. -->
      <Segmented
        label="Vertical exaggeration"
        options={exagOptions}
        bind:value={app.exaggeration}
        disabled={!app.depthMode || !isGlobe}
        title={app.depthMode && isGlobe
          ? undefined
          : 'Vertical exaggeration applies in true-depth mode'}
      />
      <button
        class="btn draw"
        type="button"
        aria-pressed={app.drawMode}
        onclick={toggleDraw}
        title="Drag across the map to cut a cross-section (or hold Shift while dragging)"
      >
        <Icon name="pencil" />
        <span class="lbl-long">{app.drawMode ? 'Drawing… drag on the map' : 'Draw section'}</span>
        <span class="lbl-short" aria-hidden="true">{app.drawMode ? 'Drag…' : 'Section'}</span>
      </button>
    </div>
    <div class="row secondary">
      {@render secondary()}
    </div>
  </div>
{:else}
  <div class="toolbar compact" role="group" aria-label="Map controls">
    {#if moreOpen}
      <div class="more-panel" id="more-panel">
        {#if app.depthMode && isGlobe}
          <div class="exag">
            <span class="eyebrow">Exaggeration</span>
            <Segmented
              label="Vertical exaggeration"
              options={exagOptions}
              bind:value={app.exaggeration}
            />
          </div>
        {/if}
        <div class="grid">
          {@render secondary()}
        </div>
      </div>
    {/if}
    <div class="row">
      <Segmented
        label="Where to draw earthquakes"
        options={[
          { value: 'surface', label: 'Surface' },
          { value: 'depth', label: 'Depth' },
        ]}
        value={depthValue}
        onchange={setDepth}
        disabled={!isGlobe}
      />
      <button
        class="btn draw"
        type="button"
        aria-pressed={app.drawMode}
        onclick={toggleDraw}
        aria-label={app.drawMode ? 'Drawing a section: drag on the map' : 'Draw a cross-section'}
      >
        <Icon name="pencil" />
        <span>{app.drawMode ? 'Drag…' : 'Section'}</span>
      </button>
      <button
        class="btn icon-btn"
        type="button"
        aria-expanded={moreOpen}
        aria-controls="more-panel"
        aria-label="More map options"
        onclick={() => (moreOpen = !moreOpen)}
      >
        <Icon name={moreOpen ? 'close' : 'more'} />
      </button>
    </div>
  </div>
{/if}

<style>
  .toolbar.wide {
    display: grid;
    justify-items: end;
    gap: 8px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
  }

  .secondary :global(.btn) {
    min-height: 34px;
    padding: 0 0.62rem;
    font-size: 0.8rem;
  }

  .draw {
    min-width: 9.5rem;
  }

  .lbl-short {
    display: none;
  }

  /* On a narrow stage the secondary toggles become icon buttons; their text stays as the
     accessible name, and each keeps its tooltip. */
  @container stage (max-width: 820px) {
    .wide .draw {
      min-width: 0;
    }

    .wide .lbl-long {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .wide .lbl-short {
      display: inline;
    }

    .wide .secondary :global(.btn) {
      width: 38px;
      padding: 0;
    }

    .wide .secondary :global(.btn span) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }

  .compact {
    display: grid;
    gap: 8px;
  }

  .compact .row {
    justify-content: space-between;
    flex-wrap: nowrap;
  }

  .compact .draw {
    flex: 1;
    min-width: 0;
  }

  .more-panel {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--basalt-line-strong);
    border-radius: var(--radius);
    background: rgba(14, 17, 22, 0.94);
  }

  .more-panel .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .more-panel .grid :global(.btn) {
    justify-content: flex-start;
    font-size: 0.82rem;
  }

  .exag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
</style>
