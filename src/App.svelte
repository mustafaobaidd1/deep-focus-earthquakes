<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import FilterBar from './components/FilterBar.svelte';
  import GlobeStage from './components/GlobeStage.svelte';
  import HowItWorks from './components/HowItWorks.svelte';
  import SectionPanel from './components/SectionPanel.svelte';
  import StatsPanel from './components/StatsPanel.svelte';
  import Tabs from './components/Tabs.svelte';
  import { prefersReducedMotion, webglAvailable } from './lib/webgl';
  import { refreshSection, refreshStats, startData } from './state/actions';
  import { app, type PanelTab } from './state/app.svelte';

  let wide = $state(true);
  // Only whole-year steps of the playback head refresh the numbers (the head moves every frame).
  const playYearFloor = $derived(app.playYear === null ? null : Math.floor(app.playYear));

  onMount(() => {
    const params = new URLSearchParams(location.search);
    app.webgl = webglAvailable();
    app.view = !app.webgl || params.get('view') === 'map' ? 'map' : 'globe';
    app.reducedMotion = prefersReducedMotion();
    if (app.reducedMotion) app.autoRotate = false;

    const mqWide = matchMedia('(min-width: 700px)');
    const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const onWide = () => {
      wide = mqWide.matches;
      if (wide && app.tab === 'filters') app.tab = 'section';
    };
    const onMotion = () => {
      app.reducedMotion = mqMotion.matches;
      if (app.reducedMotion) app.autoRotate = false;
    };
    onWide();
    mqWide.addEventListener('change', onWide);
    mqMotion.addEventListener('change', onMotion);
    startData();
    return () => {
      mqWide.removeEventListener('change', onWide);
      mqMotion.removeEventListener('change', onMotion);
    };
  });

  // Statistics follow the filters (and the playback head, one year at a time).
  let statsTimer = 0;
  $effect(() => {
    const deps = [
      app.status,
      app.catalogVersion,
      app.filter.magMin,
      app.filter.magMax,
      app.filter.depthMin,
      app.filter.depthMax,
      app.filter.yearMin,
      app.filter.yearMax,
      playYearFloor,
    ];
    void deps;
    clearTimeout(statsTimer);
    statsTimer = window.setTimeout(() => untrack(refreshStats), 60);
  });

  let sectionTimer = 0;
  $effect(() => {
    const deps = [
      app.status,
      app.catalogVersion,
      app.section,
      app.fitMinDepth,
      app.filter.magMin,
      app.filter.magMax,
      app.filter.depthMin,
      app.filter.depthMax,
      app.filter.yearMin,
      app.filter.yearMax,
      playYearFloor,
    ];
    void deps;
    clearTimeout(sectionTimer);
    sectionTimer = window.setTimeout(() => untrack(refreshSection), 60);
  });

  const tabs = $derived<{ id: PanelTab; label: string }[]>(
    wide
      ? [
          { id: 'section', label: 'Cross-section' },
          { id: 'stats', label: 'Statistics' },
        ]
      : [
          { id: 'section', label: 'Section' },
          { id: 'stats', label: 'Statistics' },
          { id: 'filters', label: 'Filters' },
        ],
  );
</script>

<div class="app">
  <section class="stage dark" aria-label="Earthquake map">
    <GlobeStage />
    {#if wide}
      <FilterBar variant="dark" />
    {/if}
  </section>

  <aside class="panel" aria-label="Cross-section and statistics">
    <div class="panel-head">
      <nav class="topnav" aria-label="Project links">
        <a class="home" href="https://mustafaobaidd1.github.io/">
          <span aria-hidden="true">←</span> Mustafa Obaid · Portfolio
        </a>
        <span class="spacer"></span>
        <a class="btn quiet" href="https://github.com/mustafaobaidd1/deep-focus-earthquakes">
          Source code
        </a>
      </nav>

      <div class="tabrow">
        <Tabs {tabs} bind:active={app.tab} />
        {#if wide}
          <button class="btn quiet how" type="button" onclick={() => (app.howOpen = true)}>
            How it works
          </button>
        {/if}
      </div>
    </div>

    <div class="panel-body">
      <div
        id="panel-section"
        role="tabpanel"
        aria-labelledby="tab-section"
        hidden={app.tab !== 'section'}
      >
        <SectionPanel />
      </div>
      <div
        id="panel-stats"
        role="tabpanel"
        aria-labelledby="tab-stats"
        hidden={app.tab !== 'stats'}
      >
        <StatsPanel />
      </div>
      {#if !wide}
        <div
          id="panel-filters"
          role="tabpanel"
          aria-labelledby="tab-filters"
          hidden={app.tab !== 'filters'}
        >
          <FilterBar variant="paper" />
        </div>
      {/if}
    </div>

    <footer class="colophon">
      <p>
        Earthquakes: <a href="https://earthquake.usgs.gov/data/comcat/">USGS ComCat</a> (public
        domain). Coastlines: Natural Earth. Plate boundaries: Bird (2003), PB2002.
        <button
          class="link"
          type="button"
          onclick={() => ((app.howSection = 'credits'), (app.howOpen = true))}
        >
          Credits &amp; method
        </button>
      </p>
      <p>
        <a href="https://mustafaobaidd1.github.io/">Mustafa Obaid · Portfolio</a> ·
        <a href="https://github.com/mustafaobaidd1/deep-focus-earthquakes">Source code</a> · MIT licence
      </p>
    </footer>
  </aside>
</div>

<HowItWorks />

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 100dvh;
  }

  .stage {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--basalt);
    height: clamp(420px, 62svh, 720px);
    min-width: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--paper);
  }

  .topnav {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px 6px 16px;
    border-bottom: 1px solid var(--rule);
  }

  .topnav .home {
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    min-height: var(--hit);
    font-family: var(--serif);
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink);
  }

  .topnav .home:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .topnav .spacer {
    flex: 1;
  }

  .topnav .btn {
    padding: 0 0.55rem;
    text-decoration: none;
    font-size: 0.84rem;
  }

  .tabrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 10px;
    border-bottom: 1px solid var(--rule);
  }

  .tabrow :global(.tabs) {
    flex: 1;
    border-bottom: 0;
  }

  .tabrow .how {
    flex: none;
    padding: 0 0.6rem;
    font-size: 0.84rem;
    color: var(--accent);
  }

  .panel-body {
    flex: 1 0 auto;
  }

  .colophon {
    padding: 14px 16px 20px;
    border-top: 1px solid var(--rule);
    font-size: 0.8rem;
    color: var(--ink-3);
  }

  .colophon p {
    margin: 0 0 6px;
    line-height: 1.5;
  }

  .colophon a,
  .colophon .link {
    color: var(--ink-2);
    text-underline-offset: 2px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    text-decoration: underline;
    font-weight: 600;
  }

  @media (min-width: 700px) and (max-width: 1099px) {
    .stage {
      height: clamp(560px, 74svh, 940px);
    }
  }

  @media (min-width: 1100px) {
    .app {
      grid-template-columns: minmax(0, 1fr) var(--panel-w);
      height: 100dvh;
      overflow: hidden;
    }

    .stage {
      height: 100dvh;
    }

    .panel {
      height: 100dvh;
      overflow-y: auto;
      border-left: 1px solid #000;
      scrollbar-gutter: stable;
    }

    .panel-head {
      position: sticky;
      top: 0;
      z-index: 3;
      background: var(--paper);
    }
  }

  @media (max-width: 520px) {
    .topnav {
      padding: 4px 8px 4px 12px;
    }

    .topnav .home {
      font-size: 0.875rem;
    }
  }
</style>
