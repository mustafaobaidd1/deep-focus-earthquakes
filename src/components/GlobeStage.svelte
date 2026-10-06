<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { toBounds } from '../lib/filters';
  import { formatAge, formatInt } from '../lib/format';
  import { completeEvent, describeHit, loadLive, startData } from '../state/actions';
  import { app, data } from '../state/app.svelte';
  import type { EngineCallbacks, MapEngine, PickHit } from '../state/engine';
  import EventCard from './EventCard.svelte';
  import Icon from './Icon.svelte';
  import Legend from './Legend.svelte';
  import Toolbar from './Toolbar.svelte';

  let globeCanvas = $state<HTMLCanvasElement>();
  let mapCanvas = $state<HTMLCanvasElement>();
  let mapOverlay = $state<HTMLCanvasElement>();
  let labelA = $state<HTMLSpanElement>();
  let labelB = $state<HTMLSpanElement>();

  let engine = $state.raw<MapEngine | null>(null);
  let engineFailed = $state<string | null>(null);
  let hasCatalog = $state(false);
  let compact = $state(false);
  let midWidth = $state(false);
  let noticeDismissed = $state(false);
  let sectionToast = $state(false);
  let viewportW = $state(0);
  let masthead = $state<HTMLElement>();
  let tools = $state<HTMLElement>();
  let insetTop = $state(0);
  let insetBottom = $state(0);
  let viewportH = $state(0);

  const callbacks: EngineCallbacks = {
    onHover(hit: PickHit | null) {
      const info = describeHit(hit);
      app.hover = info;
      if (info) void completeEvent(info, 'hover');
    },
    onSelect(hit: PickHit | null) {
      const info = describeHit(hit);
      app.selected = info;
      app.hover = null;
      if (info) void completeEvent(info, 'selected');
    },
    onSectionDrawn(a, b) {
      app.section = {
        a,
        b,
        halfWidthKm: app.section?.halfWidthKm ?? 150,
        presetId: null,
      };
      app.drawMode = false;
      app.tab = 'section';
      if (compact) {
        sectionToast = true;
        setTimeout(() => (sectionToast = false), 6000);
      }
    },
    onDrawStateChange(drawing) {
      app.drawing = drawing;
    },
    onInteract(kind) {
      app.interacted = true;
      if (kind !== 'draw') app.autoRotate = false;
    },
  };

  let building = 0;
  async function buildEngine(kind: 'globe' | 'map') {
    const token = ++building;
    engine?.dispose();
    engine = null;
    hasCatalog = false;
    await tick();
    try {
      if (kind === 'globe') {
        const { GlobeView } = await import('../globe/GlobeView');
        if (token !== building || !globeCanvas) return;
        const g = new GlobeView(globeCanvas, callbacks, { reducedMotion: app.reducedMotion });
        if (labelA && labelB) g.setLabelElements(labelA, labelB);
        engine = g;
      } else {
        const { FlatMap } = await import('../map2d/FlatMap');
        if (token !== building || !mapCanvas || !mapOverlay) return;
        engine = new FlatMap(mapCanvas, mapOverlay, callbacks);
      }
      engineFailed = null;
    } catch (err) {
      if (kind === 'globe') {
        // WebGL context creation can still fail after detection (blocklisted GPU, lost context).
        app.webgl = false;
        app.view = 'map';
      } else {
        engineFailed = (err as Error).message;
      }
    }
  }

  function measureInsets() {
    const stageTop = masthead?.parentElement?.getBoundingClientRect().top ?? 0;
    const m = masthead?.getBoundingClientRect();
    const t = tools?.getBoundingClientRect();
    if (!m || !t) return;
    if (compact) {
      // Fixed: the toolbar row is 44 px plus margins; its pop-up panel must not move the globe.
      insetTop = Math.round(m.bottom - stageTop + 4);
      insetBottom = 66;
    } else {
      insetTop = Math.round(Math.max(m.bottom, t.bottom) - stageTop + 6);
      insetBottom = 8;
    }
  }

  onMount(() => {
    const mq = matchMedia('(max-width: 699px)');
    const mqMid = matchMedia('(max-width: 1099px)');
    const onMq = () => {
      compact = mq.matches;
      midWidth = mqMid.matches;
      requestAnimationFrame(measureInsets);
    };
    onMq();
    mq.addEventListener('change', onMq);
    mqMid.addEventListener('change', onMq);
    const ro = new ResizeObserver(() => measureInsets());
    if (masthead) ro.observe(masthead);
    if (tools) ro.observe(tools);
    if (masthead?.parentElement) ro.observe(masthead.parentElement);
    return () => {
      mq.removeEventListener('change', onMq);
      mqMid.removeEventListener('change', onMq);
      ro.disconnect();
      engine?.dispose();
    };
  });

  $effect(() => {
    engine?.setInsets?.(insetTop, insetBottom);
  });

  $effect(() => {
    const kind = app.view;
    untrack(() => void buildEngine(kind));
  });

  // ---- push state into the renderer
  $effect(() => {
    void app.catalogVersion;
    const e = engine;
    if (e && data.catalog) {
      e.setCatalog(data.catalog);
      hasCatalog = true;
    }
  });
  $effect(() => {
    void app.layersVersion;
    if (engine && data.coast) engine.setLayers(data.coast, data.plates);
  });
  $effect(() => {
    const b = toBounds({ ...app.filter });
    engine?.setFilter(b);
  });
  $effect(() => {
    engine?.setPlayback(app.playDay, 365);
  });
  $effect(() => {
    void app.liveVersion;
    engine?.setLive(app.liveEnabled ? data.live : null);
  });
  let lastFly = 0;
  $effect(() => {
    const s = app.section;
    const fly = app.flyRequest;
    const e = engine;
    if (!e) return;
    const doFly = fly !== lastFly;
    lastFly = fly;
    e.setSection(s ? { a: s.a, b: s.b, halfWidthKm: s.halfWidthKm } : null, doFly);
  });
  $effect(() => {
    engine?.setDrawMode(app.drawMode);
  });
  $effect(() => {
    engine?.setDepthMode?.(app.depthMode, true);
  });
  $effect(() => {
    engine?.setExaggeration?.(app.exaggeration);
  });
  $effect(() => {
    engine?.setReducedMotion?.(app.reducedMotion);
  });
  $effect(() => {
    // Hold still while the reader looks at an event.
    engine?.setAutoRotate?.(app.autoRotate && !app.hover && !app.selected && !app.drawing);
  });
  $effect(() => {
    engine?.setShowPlates(app.showPlates);
  });
  $effect(() => {
    const s = app.selected;
    engine?.setHighlight(s ? { kind: s.kind, index: s.index, x: 0, y: 0 } : null);
  });
  // Fly to events picked from lists (they carry no screen position).
  $effect(() => {
    const s = app.selected;
    if (s && s.x === null && engine?.flyTo) {
      untrack(() => engine?.flyTo?.(s.lat, s.lon, 2.1));
    }
  });

  // Ready for tests and screenshots once the map, the numbers and the section are in.
  $effect(() => {
    if (hasCatalog && app.stats && (app.section === null || app.sectionResult)) {
      document.documentElement.dataset.ready = 'true';
    }
  });

  function reset() {
    engine?.resetView?.();
  }

  const loadingPct = $derived(
    app.progress.total > 0 ? Math.min(100, (app.progress.loaded / app.progress.total) * 100) : 0,
  );

  // Hover card placement: beside the point, kept inside the viewport.
  const hoverPos = $derived.by(() => {
    const h = app.hover;
    if (!h || h.x === null || h.y === null) return null;
    const w = 280;
    const est = 150;
    let x = h.x + 16;
    let y = h.y + 16;
    if (x + w > viewportW - 8) x = h.x - w - 16;
    if (y + est > viewportH - 8) y = h.y - est - 12;
    return { x: Math.max(8, x), y: Math.max(8, y) };
  });

  const hint = $derived(
    app.view === 'globe'
      ? compact
        ? 'Drag to turn · tap Section to draw a cross-section'
        : 'Drag to turn · draw a line to cut a cross-section'
      : 'Point at an earthquake for details · draw a line to cut a cross-section',
  );

  const liveText = $derived.by(() => {
    switch (app.liveStatus) {
      case 'loading':
        return app.liveFetchedAt ? 'Refreshing the live feed…' : 'Loading the live feed…';
      case 'fresh':
        return `Live: ${formatInt(app.liveCount)} earthquakes in the past 30 days · updated ${formatAge(Date.now() - (app.liveFetchedAt ?? Date.now()))}`;
      case 'stale':
        return `Live feed out of date: showing the copy from ${formatAge(Date.now() - (app.liveFetchedAt ?? Date.now()))}. ${app.liveError ?? ''}`;
      case 'error':
        return `Live feed unavailable. ${app.liveError ?? ''} The 1973–2025 catalogue is still complete.`;
      default:
        return '';
    }
  });
</script>

<div class="stage-inner" class:compact class:drawing={app.drawMode}>
  <header class="masthead" bind:this={masthead}>
    <h1>Deep Focus</h1>
    <p class="sub">An atlas of earthquake depths</p>
    <p class="scope">USGS catalogue · every M 5+ earthquake, 1973–2025</p>
    {#if compact && app.status === 'ready'}
      <Legend size="inline" />
    {/if}
  </header>

  {#if compact}
    <button
      class="btn icon-btn how-btn"
      type="button"
      aria-label="How it works"
      onclick={() => (app.howOpen = true)}
    >
      <Icon name="info" size={18} />
    </button>
  {/if}

  <div class="viewport" bind:clientWidth={viewportW} bind:clientHeight={viewportH}>
    {#if app.view === 'globe'}
      <canvas
        bind:this={globeCanvas}
        class="globe-canvas"
        tabindex="0"
        aria-label="Interactive globe of earthquakes. Drag or use the arrow keys to turn it, plus and minus to zoom, 0 to reset. Choose a section preset or event in the side panel for keyboard access to details."
        aria-describedby="globe-help"
      ></canvas>
    {:else}
      <canvas bind:this={mapCanvas} class="map-canvas" aria-hidden="true"></canvas>
      <canvas
        bind:this={mapOverlay}
        class="map-canvas overlay"
        tabindex="0"
        aria-label="Flat world map of earthquakes. Point at an earthquake for details, or use the side panel for keyboard access."
      ></canvas>
    {/if}
    <span class="end-label" bind:this={labelA} aria-hidden="true">A</span>
    <span class="end-label" bind:this={labelB} aria-hidden="true">A′</span>
    <p id="globe-help" class="visually-hidden">
      Earthquakes are coloured by depth and sized by magnitude. The Ring of Fire around the Pacific
      is where most of them happen.
    </p>
  </div>

  <div class="tools">
    <div bind:this={tools}><Toolbar {compact} onreset={reset} /></div>
    {#if app.liveEnabled && app.liveStatus !== 'off'}
      <div class="live-status {app.liveStatus}" role="status">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">{liveText}</span>
        {#if app.liveStatus === 'error' || app.liveStatus === 'stale' || app.liveStatus === 'fresh'}
          <button class="retry" type="button" onclick={() => loadLive(true)}>
            <Icon name="refresh" size={14} />
            {app.liveStatus === 'fresh' ? 'Refresh' : 'Retry'}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if app.status === 'ready' && !compact}
    <div class="legend-slot">
      <Legend size={midWidth ? 'medium' : 'full'} />
    </div>
  {/if}

  {#if app.status === 'ready' && !app.interacted && !compact}
    <p class="hint" aria-hidden="true">{hint}</p>
  {:else if app.drawMode}
    <p class="hint drawing-hint" role="status">
      {app.drawing ? 'Release to cut the section' : 'Drag from A to A′ across the map'}
      <button class="hint-cancel" type="button" onclick={() => (app.drawMode = false)}
        >Cancel</button
      >
    </p>
  {:else if app.status === 'ready' && !app.interacted && compact}
    <p class="hint" aria-hidden="true">{hint}</p>
  {/if}

  {#if sectionToast}
    <button
      class="toast"
      type="button"
      onclick={() => {
        sectionToast = false;
        document
          .getElementById('panel-section')
          ?.scrollIntoView({ behavior: app.reducedMotion ? 'auto' : 'smooth' });
      }}>Section ready — view it below ↓</button
    >
  {/if}

  {#if !app.webgl && !noticeDismissed}
    <div class="notice" role="note">
      <p>
        <strong>Flat-map edition.</strong> WebGL isn't available in this browser, so the 3D globe is replaced
        by a world map. Filters, cross-sections and statistics work the same.
      </p>
      <button
        class="btn icon-btn"
        type="button"
        aria-label="Dismiss"
        onclick={() => (noticeDismissed = true)}
      >
        <Icon name="close" />
      </button>
    </div>
  {/if}

  {#if app.status === 'loading'}
    <div class="overlay" role="status" aria-live="polite">
      <div class="skeleton-globe" aria-hidden="true"></div>
      <div class="loading-card">
        <p class="eyebrow">Loading the USGS catalogue</p>
        <div class="bar" aria-hidden="true"><span style:width={`${loadingPct}%`}></span></div>
        <p class="num small">
          {#if app.progress.total > 0}
            {Math.round(app.progress.loaded / 1024)} of {Math.round(app.progress.total / 1024)} kB · every
            M 5+ earthquake, 1973–2025
          {:else}
            Fetching every M 5+ earthquake, 1973–2025…
          {/if}
        </p>
      </div>
    </div>
  {:else if app.status === 'error'}
    <div class="overlay" role="alert">
      <div class="loading-card error">
        <p class="eyebrow">The catalogue could not be loaded</p>
        <p class="small">{app.error}</p>
        <button class="btn primary" type="button" onclick={() => startData()}>Try again</button>
      </div>
    </div>
  {:else if engineFailed}
    <div class="overlay" role="alert">
      <div class="loading-card error">
        <p class="eyebrow">The map could not be drawn</p>
        <p class="small">
          {engineFailed}. The statistics and cross-sections in the panel still work.
        </p>
      </div>
    </div>
  {/if}

  {#if app.hover && hoverPos && !app.drawMode && (!app.selected || app.selected.index !== app.hover.index)}
    <div class="hover-card" style:transform={`translate(${hoverPos.x}px, ${hoverPos.y}px)`}>
      <EventCard event={app.hover} mode="hover" />
    </div>
  {/if}

  {#if app.selected}
    <div class="pinned-card">
      <EventCard event={app.selected} mode="pinned" onclose={() => (app.selected = null)} />
    </div>
  {/if}
</div>

<style>
  .stage-inner {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background:
      radial-gradient(ellipse at 50% 45%, rgba(58, 70, 86, 0.18), transparent 62%), var(--basalt);
  }

  .viewport {
    position: absolute;
    inset: 0;
  }

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
    cursor: grab;
  }

  canvas:active {
    cursor: grabbing;
  }

  .drawing canvas {
    cursor: crosshair;
  }

  .map-canvas.overlay {
    z-index: 1;
  }

  canvas:focus-visible {
    outline: 2px solid var(--focus-dark);
    outline-offset: -4px;
  }

  .end-label {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 2;
    visibility: hidden;
    margin: -24px 0 0 -11px;
    min-width: 22px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--serif);
    font-weight: 700;
    font-size: 0.85rem;
    text-align: center;
    pointer-events: none;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }

  .masthead {
    position: absolute;
    top: 18px;
    left: 22px;
    z-index: 3;
    max-width: min(46%, 440px);
    pointer-events: none;
  }

  h1 {
    margin: 0;
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(1.6rem, 1.1rem + 1.4vw, 2.35rem);
    line-height: 1.02;
    letter-spacing: -0.015em;
    color: var(--on-dark);
  }

  .scope {
    margin: 8px 0 0;
    font-size: 0.7rem;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-dark-3);
  }

  .sub {
    margin: 6px 0 0;
    font-family: var(--serif);
    font-style: italic;
    font-size: 1rem;
    line-height: 1.35;
    color: var(--on-dark-2);
  }

  .tools {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 4;
    display: grid;
    justify-items: end;
    gap: 8px;
    max-width: calc(54% - 16px);
  }

  .live-status {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 360px;
    padding: 6px 8px 6px 10px;
    border: 1px solid var(--basalt-line);
    border-radius: var(--radius);
    background: rgba(14, 17, 22, 0.85);
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--on-dark-2);
  }

  .live-status .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--on-dark-3);
  }

  .live-status.fresh .dot {
    background: #7fd99a;
    box-shadow: 0 0 0 3px rgba(127, 217, 154, 0.2);
  }

  .live-status.stale .dot {
    background: #f2c14e;
  }

  .live-status.error .dot {
    background: var(--accent-on-dark);
  }

  .live-status.loading .dot {
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.25;
    }
  }

  .retry {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 0 8px;
    border: 1px solid var(--basalt-line-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--on-dark);
    font-size: 0.78rem;
    font-weight: 650;
  }

  .retry:hover {
    background: var(--basalt-high);
  }

  .legend-slot {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 3;
  }

  .hint {
    position: absolute;
    left: 50%;
    bottom: 18px;
    z-index: 3;
    transform: translateX(-50%);
    margin: 0;
    padding: 8px 14px;
    border-radius: 999px;
    background: rgba(239, 235, 227, 0.94);
    color: var(--ink);
    font-size: 0.86rem;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .drawing-hint {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 4px 4px 14px;
    pointer-events: auto;
  }

  .hint-cancel {
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid var(--rule-strong);
    border-radius: 999px;
    background: var(--paper-raised);
    font-size: 0.8rem;
    font-weight: 650;
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 72px;
    z-index: 5;
    transform: translateX(-50%);
    min-height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-weight: 650;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }

  .notice {
    position: absolute;
    left: 16px;
    right: 16px;
    top: 96px;
    z-index: 5;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 560px;
    padding: 10px 8px 10px 14px;
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
    font-size: 0.88rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .notice p {
    margin: 0;
    line-height: 1.45;
  }

  .notice .btn {
    flex: none;
    background: transparent;
    border-color: transparent;
    color: var(--ink);
    backdrop-filter: none;
  }

  .notice .btn:hover {
    background: var(--paper-sunk);
  }

  .overlay {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .skeleton-globe {
    position: absolute;
    left: 50%;
    top: 50%;
    width: min(62vmin, 70%);
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle at 38% 34%, #1c232c, #12171e 70%);
    box-shadow: 0 0 0 1px rgba(91, 111, 134, 0.25);
  }

  .loading-card {
    position: relative;
    display: grid;
    gap: 8px;
    width: min(340px, 100%);
    padding: 14px 16px;
    border: 1px solid var(--basalt-line);
    border-radius: var(--radius);
    background: rgba(14, 17, 22, 0.88);
    color: var(--on-dark);
  }

  .loading-card.error {
    background: var(--paper);
    color: var(--ink);
    border-color: transparent;
  }

  .loading-card.error .eyebrow {
    color: var(--accent);
  }

  .loading-card .bar {
    height: 4px;
    border-radius: 2px;
    background: rgba(236, 231, 220, 0.16);
    overflow: hidden;
  }

  .loading-card .bar span {
    display: block;
    height: 100%;
    background: var(--on-dark);
    transition: width 120ms linear;
  }

  .small {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.45;
  }

  .hover-card {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 7;
    pointer-events: none;
  }

  .pinned-card {
    position: absolute;
    right: 16px;
    top: 150px;
    z-index: 7;
  }

  .how-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 4;
  }

  /* ---------------------------------------------------------------- phones */
  .compact .masthead {
    top: 12px;
    left: 14px;
    max-width: calc(100% - 80px);
  }

  .compact h1 {
    font-size: 1.5rem;
  }

  .compact .sub {
    margin-top: 2px;
    font-size: 0.86rem;
  }

  .compact .scope {
    display: none;
  }

  .compact .tools {
    top: auto;
    bottom: 12px;
    left: 12px;
    right: 12px;
    max-width: none;
    justify-items: stretch;
  }

  .compact .live-status {
    max-width: none;
    order: -1;
  }

  .compact .hint {
    bottom: 72px;
    font-size: 0.8rem;
    white-space: normal;
    width: max-content;
    max-width: calc(100% - 24px);
    text-align: center;
  }

  .compact .pinned-card {
    left: 12px;
    right: 12px;
    top: auto;
    bottom: 68px;
  }

  .compact .pinned-card :global(.card) {
    width: 100%;
    max-width: none;
  }

  .compact .notice {
    top: 64px;
  }

  @media (min-width: 700px) and (max-width: 1099px) {
    .pinned-card {
      top: 120px;
    }

    .tools {
      max-width: calc(60% - 16px);
    }
  }
</style>
