<script lang="ts">
  import { compassPoint, initialBearing } from '../lib/geo';
  import { formatInt, plural } from '../lib/format';
  import { MIN_SLAB_EVENTS } from '../lib/section';
  import { PRESETS, presetById } from '../lib/presets';
  import { app, sectionFromPreset } from '../state/app.svelte';
  import SectionChart from './SectionChart.svelte';

  const preset = $derived(app.section?.presetId ? presetById(app.section.presetId) : undefined);
  const result = $derived(app.sectionResult);

  const COMPASS: Record<string, string> = {
    N: 'north',
    NNE: 'north-northeast',
    NE: 'northeast',
    ENE: 'east-northeast',
    E: 'east',
    ESE: 'east-southeast',
    SE: 'southeast',
    SSE: 'south-southeast',
    S: 'south',
    SSW: 'south-southwest',
    SW: 'southwest',
    WSW: 'west-southwest',
    W: 'west',
    WNW: 'west-northwest',
    NW: 'northwest',
    NNW: 'north-northwest',
  };

  const bearing = $derived(
    app.section
      ? initialBearing(app.section.a[0], app.section.a[1], app.section.b[0], app.section.b[1])
      : 0,
  );
  const backBearing = $derived(
    app.section
      ? initialBearing(app.section.b[0], app.section.b[1], app.section.a[0], app.section.a[1])
      : 0,
  );

  function choosePreset(id: string) {
    const p = presetById(id);
    if (!p) return;
    app.section = sectionFromPreset(p);
    app.selected = null;
    app.flyRequest++;
  }

  // Corridor half-width: applied when the slider is released (keeps the worker quiet mid-drag).
  let widthDraft = $state(150);
  $effect(() => {
    widthDraft = app.section?.halfWidthKm ?? 150;
  });
  function commitWidth() {
    if (!app.section || widthDraft === app.section.halfWidthKm) return;
    app.section = { ...app.section, halfWidthKm: widthDraft };
  }

  // Endpoint editor (the keyboard way to cut any section).
  let editOpen = $state(false);
  let ed = $state({ latA: 0, lonA: 0, latB: 0, lonB: 0 });
  let edError = $state<string | null>(null);
  $effect(() => {
    const s = app.section;
    if (s) ed = { latA: s.a[0], lonA: s.a[1], latB: s.b[0], lonB: s.b[1] };
  });
  function applyEndpoints(e: SubmitEvent) {
    e.preventDefault();
    const vals = [ed.latA, ed.lonA, ed.latB, ed.lonB].map(Number);
    if (vals.some((v) => !Number.isFinite(v))) {
      edError = 'Enter numbers for all four coordinates.';
      return;
    }
    const [la, lo, lb, lob] = vals;
    if (Math.abs(la) > 90 || Math.abs(lb) > 90 || Math.abs(lo) > 180 || Math.abs(lob) > 180) {
      edError = 'Latitudes run from −90 to 90 and longitudes from −180 to 180.';
      return;
    }
    if (Math.abs(la - lb) < 0.05 && Math.abs(lo - lob) < 0.05) {
      edError = 'A and A′ must be different points.';
      return;
    }
    edError = null;
    app.section = {
      a: [la, lo],
      b: [lb, lob],
      halfWidthKm: app.section?.halfWidthKm ?? 150,
      presetId: null,
    };
    app.flyRequest++;
  }

  function startDrawing() {
    app.drawMode = true;
    app.interacted = true;
    document.querySelector<HTMLElement>('.stage')?.scrollIntoView({ block: 'nearest' });
  }

  const fitText = $derived.by(() => {
    if (!result) return null;
    const f = result.fit;
    if (f.ok) {
      const dir =
        f.fit.deepensTowards === 1
          ? `A′ (${COMPASS[compassPoint(bearing)]})`
          : `A (${COMPASS[compassPoint(backBearing)]})`;
      return {
        ok: true as const,
        headline: `${f.fit.dipDeg.toFixed(1)}°`,
        sigma: f.fit.dipSigma,
        detail: `Fitted to ${plural(f.fit.n, 'earthquake')} deeper than ${app.fitMinDepth} km${f.fit.candidates > f.fit.n ? ` (${formatInt(f.fit.candidates - f.fit.n)} outliers set aside)` : ''}. The slab deepens towards ${dir}; earthquakes scatter ${formatInt(f.fit.rmsKm)} km (rms) about the line.`,
      };
    }
    if (f.reason === 'few-events') {
      return {
        ok: false as const,
        headline: 'No slab to fit',
        detail:
          f.candidates === 0
            ? `Not a single earthquake deeper than ${app.fitMinDepth} km in this corridor — what you would expect where plates slide past each other rather than one sinking beneath the other.`
            : `Only ${plural(f.candidates, 'earthquake')} deeper than ${app.fitMinDepth} km here; at least ${MIN_SLAB_EVENTS} are needed for a dip.`,
      };
    }
    return {
      ok: false as const,
      headline: 'No clear dip',
      detail: `The ${formatInt(f.candidates)} deeper earthquakes form a cluster without a dominant dipping trend, so no dip is reported.`,
    };
  });
</script>

<section class="plate" aria-labelledby="section-title">
  <p class="eyebrow">Plate II · Cross-section</p>

  <div class="chips" role="group" aria-label="Preset sections">
    {#each PRESETS as p (p.id)}
      <button
        class="chip"
        class:contrast={p.id === 'deadsea'}
        type="button"
        aria-pressed={app.section?.presetId === p.id}
        onclick={() => choosePreset(p.id)}>{p.name}</button
      >
    {/each}
  </div>

  {#if !app.section}
    <div class="empty">
      <p class="fig-title">No cross-section yet</p>
      <p class="caption">
        Pick a preset above, or draw a line across the globe: every earthquake within the corridor
        is projected onto a vertical slice through the Earth, from A to A′.
      </p>
      <button class="btn primary" type="button" onclick={startDrawing}
        >Draw a section on the map</button
      >
    </div>
  {:else}
    <h2 class="fig-title" id="section-title">
      {preset ? preset.title : 'Your section'}
    </h2>
    <p class="meta num">
      {#if preset}{preset.region} ·
      {/if}A → A′ towards the {COMPASS[compassPoint(bearing)]} ·
      {result ? `${formatInt(result.lengthKm)} km long` : '…'} · corridor ±{app.section.halfWidthKm} km
    </p>

    {#if result}
      <figure>
        <SectionChart {result} trueAspect={app.trueAspect} />
        <figcaption class="caption small-cap">
          <span class="fig-label">Fig. 2.</span>
          {formatInt(result.index.length)} earthquakes within {app.section.halfWidthKm} km of the line
          A–A′, coloured by depth and sized by magnitude.
        </figcaption>
      </figure>

      {#if fitText}
        <div class="fit" class:none={!fitText.ok} aria-live="polite">
          <p class="eyebrow">Slab dip (Wadati–Benioff zone)</p>
          <p class="headline num">
            {fitText.headline}
            {#if fitText.ok}<span class="pm">± {fitText.sigma.toFixed(1)}°</span>{/if}
          </p>
          <p class="detail">{fitText.detail}</p>
        </div>
      {/if}
      <p class="caption story">
        {#if preset}{preset.caption}{:else}A section you drew. Compare it with the presets: does the
          seismicity dip, and how steeply?{/if}
      </p>
    {:else}
      <div class="skeleton" aria-busy="true" aria-label="Computing the section"></div>
    {/if}

    <div class="controls">
      <label class="field width">
        <span>Corridor half-width <span class="num">±{widthDraft} km</span></span>
        <input
          type="range"
          min="25"
          max="300"
          step="5"
          bind:value={widthDraft}
          onchange={commitWidth}
          onpointerup={commitWidth}
          onkeyup={commitWidth}
          aria-valuetext={`plus or minus ${widthDraft} kilometres`}
        />
      </label>
      <label class="field">
        <span>Fit dip below</span>
        <select bind:value={app.fitMinDepth}>
          <option value={40}>40 km</option>
          <option value={70}>70 km</option>
          <option value={100}>100 km</option>
          <option value={150}>150 km</option>
          <option value={300}>300 km</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={app.trueAspect} />
        True aspect ratio
      </label>
    </div>

    <div class="actions">
      <button
        class="btn"
        type="button"
        onclick={() => app.flyRequest++}
        disabled={app.view !== 'globe'}
      >
        Show on globe
      </button>
      <button class="btn" type="button" onclick={startDrawing}>Draw a new section</button>
      <button
        class="btn quiet"
        type="button"
        aria-expanded={editOpen}
        aria-controls="endpoint-editor"
        onclick={() => (editOpen = !editOpen)}
      >
        Edit endpoints
      </button>
      <button class="btn quiet" type="button" onclick={() => (app.section = null)}>Clear</button>
    </div>

    {#if editOpen}
      <form id="endpoint-editor" class="editor" onsubmit={applyEndpoints}>
        <fieldset>
          <legend>A</legend>
          <label class="field"
            ><span>Latitude °</span><input
              type="number"
              step="0.01"
              min="-90"
              max="90"
              bind:value={ed.latA}
              required
            /></label
          >
          <label class="field"
            ><span>Longitude °</span><input
              type="number"
              step="0.01"
              min="-180"
              max="180"
              bind:value={ed.lonA}
              required
            /></label
          >
        </fieldset>
        <fieldset>
          <legend>A′</legend>
          <label class="field"
            ><span>Latitude °</span><input
              type="number"
              step="0.01"
              min="-90"
              max="90"
              bind:value={ed.latB}
              required
            /></label
          >
          <label class="field"
            ><span>Longitude °</span><input
              type="number"
              step="0.01"
              min="-180"
              max="180"
              bind:value={ed.lonB}
              required
            /></label
          >
        </fieldset>
        <div class="editor-actions">
          <button class="btn primary" type="submit">Cut this section</button>
          {#if edError}<p class="error" role="alert">{edError}</p>{/if}
        </div>
      </form>
    {/if}
  {/if}
</section>

<style>
  .plate {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 16px 16px 20px;
  }

  .meta {
    margin: -6px 0 0;
    font-size: 0.82rem;
    color: var(--ink-3);
  }

  figure {
    margin: 4px 0 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .small-cap {
    font-size: 0.86rem;
    color: var(--ink-3);
  }

  .story {
    margin-top: -2px;
  }

  .fit {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border-left: 3px solid var(--accent);
    background: var(--paper-raised);
    border-radius: 0 var(--radius) var(--radius) 0;
  }

  .fit.none {
    border-left-color: var(--rule-strong);
  }

  .headline {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.75rem;
    font-weight: 650;
    line-height: 1.15;
  }

  .fit.none .headline {
    font-size: 1.25rem;
  }

  .pm {
    margin-left: 0.2em;
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--ink-2);
  }

  .detail {
    margin: 2px 0 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--ink-2);
  }

  .controls {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 12px 16px;
    align-items: end;
    padding-top: 4px;
  }

  .controls .check {
    grid-column: 1 / -1;
  }

  .width input {
    width: 100%;
    padding: 0;
    accent-color: var(--ink);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .editor {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
    padding: 12px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-raised);
  }

  fieldset {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 4px;
    font-family: var(--serif);
    font-weight: 700;
  }

  .editor .field input {
    width: 100%;
  }

  .editor-actions {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .error {
    margin: 0;
    font-size: 0.85rem;
    color: var(--accent);
  }

  .empty {
    display: grid;
    gap: 10px;
    justify-items: start;
    padding: 18px;
    border: 1px dashed var(--rule-strong);
    border-radius: var(--radius);
  }

  .skeleton {
    height: 300px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--paper-sunk), #ece7dd, var(--paper-sunk));
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  @media (max-width: 420px) {
    .controls {
      grid-template-columns: 1fr;
    }

    .editor {
      grid-template-columns: 1fr;
    }
  }
</style>
