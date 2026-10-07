<script lang="ts">
  import { LIMITS } from '../lib/filters';
  import { formatDate, formatDepth, formatInt, formatSigma } from '../lib/format';
  import { depthColorHex } from '../lib/ramp';
  import { MIN_EVENTS_FOR_B } from '../lib/stats';
  import { completeEvent, describeIndex, fetchDetails } from '../state/actions';
  import { app, data } from '../state/app.svelte';
  import DepthChart from './DepthChart.svelte';
  import GrChart from './GrChart.svelte';
  import YearsChart from './YearsChart.svelte';

  const s = $derived(app.stats);
  const f = $derived(app.filter);

  const scope = $derived.by(() => {
    const parts: string[] = [];
    parts.push(
      f.magMin <= LIMITS.mag[0] && f.magMax >= LIMITS.mag[1]
        ? 'M 5.0 and up'
        : f.magMax >= LIMITS.mag[1]
          ? `M ${f.magMin.toFixed(1)} and up`
          : `M ${f.magMin.toFixed(1)}–${f.magMax.toFixed(1)}`,
    );
    parts.push(
      f.depthMin <= LIMITS.depth[0] && f.depthMax >= LIMITS.depth[1]
        ? 'all depths'
        : f.depthMax >= LIMITS.depth[1]
          ? `below ${f.depthMin} km`
          : f.depthMin <= LIMITS.depth[0]
            ? `above ${f.depthMax} km`
            : `${f.depthMin}–${f.depthMax} km deep`,
    );
    const y1 = app.playYear !== null ? Math.min(f.yearMax, Math.floor(app.playYear)) : f.yearMax;
    parts.push(f.yearMin === y1 ? String(y1) : `${f.yearMin}–${y1}`);
    return parts.join(' · ');
  });

  // Places for the largest events.
  let places = $state<Record<number, { id: string; place: string }>>({});
  $effect(() => {
    const idx = s?.largest ?? [];
    const missing = idx.filter((i) => !(i in places));
    if (missing.length === 0 || !app.detailsReady) return;
    void fetchDetails(missing).then((items) => {
      const next = { ...places };
      missing.forEach((i, k) => (next[i] = items[k]));
      places = next;
    });
  });

  function pick(i: number) {
    const info = describeIndex('catalog', i);
    if (!info) return;
    const known = places[i];
    app.selected = known ? { ...info, id: known.id || null, place: known.place } : info;
    if (!known) void completeEvent(info, 'selected');
    if (matchMedia('(max-width: 699px)').matches) {
      document
        .querySelector('.stage')
        ?.scrollIntoView({ behavior: app.reducedMotion ? 'auto' : 'smooth' });
    }
  }
</script>

<section class="plate" aria-labelledby="stats-title">
  <p class="eyebrow">Plate III · Statistics of the selection</p>
  <h2 class="fig-title" id="stats-title">
    {#if s}{formatInt(s.count)} earthquakes{:else}Counting…{/if}
  </h2>
  <p class="meta">{scope}</p>

  {#if s && s.count === 0}
    <div class="empty" role="status">
      <p class="fig-title">No earthquakes match these filters</p>
      <p class="caption">Widen the magnitude, depth or year range — or reset the filters.</p>
    </div>
  {:else if s}
    <figure>
      <div class="readout" aria-live="polite">
        {#if s.b}
          <p class="big num">
            b = {s.b.b.toFixed(2)} <span class="pm">± {formatSigma(s.b.sigma)}</span>
          </p>
          <p class="small num">
            Magnitude of completeness M<sub>c</sub> = {s.b.mc.toFixed(1)} (maximum curvature) · {formatInt(
              s.b.n,
            )}
            earthquakes at or above M<sub>c</sub>
          </p>
          {#if s.fmd.mags.length > 0 && s.b.mc <= s.fmd.mags[0] + 1e-9}
            <p class="small caveat">
              M<sub>c</sub> sits at the lowest magnitude in the selection, so completeness below it cannot
              be checked; if the catalogue is incomplete there, b is underestimated. Raise the magnitude
              floor to test the estimate.
            </p>
          {/if}
        {:else}
          <p class="big muted">b-value unavailable</p>
          <p class="small">
            Fewer than {MIN_EVENTS_FOR_B} earthquakes at or above the completeness magnitude — too few
            for a meaningful estimate.
          </p>
        {/if}
      </div>
      <GrChart fmd={s.fmd} mc={s.mc} b={s.b} />
      <figcaption class="caption">
        <span class="fig-label">Fig. 3.</span> Gutenberg–Richter magnitude–frequency plot. The b-value
        is the maximum-likelihood slope (Aki 1965, with Utsu's correction for magnitudes rounded to 0.1);
        its uncertainty follows Shi &amp; Bolt (1982). A b near 1 means each step of one magnitude unit
        brings about ten times fewer earthquakes.
      </figcaption>
    </figure>

    <figure>
      <DepthChart hist={s.depthHist} classes={s.classes} count={s.count} />
      <figcaption class="caption">
        <span class="fig-label">Fig. 4.</span> How deep are they? Most earthquakes are shallow — the tall
        bars at 10 and 33 km are partly default depths assigned when a depth could not be measured. Activity
        dies away by 300 km, then returns in a separate cluster between 500 and 700 km: the deep-focus
        earthquakes inside sinking slabs.
      </figcaption>
    </figure>

    <figure>
      <YearsChart
        perYear={s.perYear}
        firstYear={s.firstYear}
        yearMin={f.yearMin}
        yearMax={f.yearMax}
        playYear={app.playYear}
      />
      <figcaption class="caption">
        <span class="fig-label">Fig. 5.</span> Earthquakes per year for the magnitude and depth filters;
        years outside the time filter are greyed. Peaks follow great earthquakes and their aftershocks
        (2004 Sumatra, 2011 Tōhoku).
      </figcaption>
    </figure>

    {#if s.largest.length > 0}
      <div class="largest">
        <h3 class="eyebrow">Largest in the selection</h3>
        <ol>
          {#each s.largest as i (i)}
            {@const c = data.catalog}
            {#if c}
              <li>
                <button
                  type="button"
                  aria-pressed={app.selected?.kind === 'catalog' && app.selected.index === i}
                  onclick={() => pick(i)}
                >
                  <span class="m num">M {(c.mag100[i] / 100).toFixed(1)}</span>
                  <span class="where">
                    {places[i]?.place || (app.detailsError ? 'Place name unavailable' : '…')}
                    <span class="when num">
                      {formatDate(c.time[i])} ·
                      <span
                        class="sw"
                        style:background={depthColorHex(c.depth10[i] / 10)}
                        aria-hidden="true"
                      ></span>
                      {formatDepth(c.depth10[i] / 10)}
                    </span>
                  </span>
                </button>
              </li>
            {/if}
          {/each}
        </ol>
      </div>
    {/if}
  {:else}
    <div class="skeleton" aria-busy="true" aria-label="Computing statistics"></div>
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
    font-size: 0.85rem;
    color: var(--ink-3);
  }

  figure {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    margin: 6px 0 4px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
  }

  .readout {
    display: grid;
    gap: 2px;
  }

  .big {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.6rem;
    font-weight: 650;
    line-height: 1.15;
  }

  .big.muted {
    font-size: 1.15rem;
    color: var(--ink-2);
  }

  .pm {
    font-size: 1rem;
    font-weight: 500;
    color: var(--ink-2);
  }

  .small {
    margin: 0;
    font-size: 0.84rem;
    color: var(--ink-2);
  }

  .caveat {
    margin-top: 4px;
    font-style: italic;
    font-family: var(--serif);
    color: var(--ink-3);
  }

  .largest {
    padding-top: 12px;
    border-top: 1px solid var(--rule);
  }

  .largest h3 {
    margin-bottom: 6px;
  }

  ol {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: grid;
    grid-template-columns: 4.2rem 1fr;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
  }

  li button:hover {
    background: var(--paper-raised);
  }

  li button[aria-pressed='true'] {
    background: var(--paper-sunk);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .m {
    font-family: var(--serif);
    font-weight: 700;
    font-size: 1.02rem;
  }

  .where {
    display: grid;
    font-family: var(--serif);
    font-size: 0.92rem;
    line-height: 1.3;
  }

  .when {
    font-family: var(--sans);
    font-size: 0.78rem;
    color: var(--ink-3);
  }

  .sw {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin: 0 2px 0 2px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
  }

  .empty {
    display: grid;
    gap: 6px;
    padding: 18px;
    border: 1px dashed var(--rule-strong);
    border-radius: var(--radius);
  }

  .skeleton {
    height: 420px;
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
</style>
