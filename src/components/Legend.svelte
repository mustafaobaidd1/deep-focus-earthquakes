<script lang="ts">
  import { depthToT, rampGradientCss } from '../lib/ramp';
  import { app } from '../state/app.svelte';

  interface Props {
    /** full: desktop corner card · medium: tablets · inline: one line under the phone masthead. */
    size?: 'full' | 'medium' | 'inline';
  }
  let { size = 'full' }: Props = $props();

  const gradient = rampGradientCss('to right', 16);
  const ticks = [0, 70, 300, 700];
  const mags = [5, 6, 7, 8, 9];
  /** Same size law as the point shader, at the default zoom. */
  const dot = (m: number) => {
    const x = m - 5;
    return 2.1 + 1.55 * x + 0.6 * x * x;
  };
</script>

{#if size === 'inline'}
  <div class="inline" role="group" aria-label="Legend">
    <span class="title">Depth</span>
    <span class="bar" style:background={gradient} aria-hidden="true"></span>
    <span class="num range" aria-hidden="true">0–700 km</span>
    <span class="visually-hidden">
      Colour shows depth, from yellow at the surface through orange and magenta to indigo near 700
      km. Circle size shows magnitude.
    </span>
  </div>
{:else}
  <div class="legend {size}" role="group" aria-label="Legend">
    <div class="depth">
      <p class="title">Depth <span class="unit">km</span></p>
      <div class="bar" style:background={gradient} aria-hidden="true"></div>
      <div class="ticks num" aria-hidden="true">
        {#each ticks as t (t)}
          <span style:left={`${depthToT(t) * 100}%`}>{t}</span>
        {/each}
      </div>
      {#if size === 'full'}
        <div class="classes" aria-hidden="true">
          <span style:left="0" style:width={`${depthToT(70) * 100}%`}>shallow</span>
          <span
            style:left={`${depthToT(70) * 100}%`}
            style:width={`${(depthToT(300) - depthToT(70)) * 100}%`}>intermediate</span
          >
          <span style:left={`${depthToT(300) * 100}%`} style:width={`${(1 - depthToT(300)) * 100}%`}
            >deep</span
          >
        </div>
      {/if}
      <p class="visually-hidden">
        Colour shows depth: yellow for shallow earthquakes near the surface, through orange and
        magenta, to indigo for the deepest, near 700 km. Shallow means above 70 km, intermediate 70
        to 300 km, deep below 300 km.
      </p>
    </div>
    <div class="mags">
      <p class="title">Magnitude</p>
      <div class="dots" aria-hidden="true">
        {#each mags as m (m)}
          <span class="dot-wrap">
            <span class="dot" style:width={`${dot(m)}px`} style:height={`${dot(m)}px`}></span>
            <span class="num">{m}</span>
          </span>
        {/each}
      </div>
      <p class="visually-hidden">Circle size grows with magnitude, from M 5 to M 9.</p>
    </div>
    {#if size === 'full' && (app.showPlates || app.liveEnabled)}
      <ul class="keys">
        {#if app.showPlates}
          <li><span class="line subduction" aria-hidden="true"></span>Subduction zone</li>
          <li><span class="line" aria-hidden="true"></span>Other plate boundary</li>
        {/if}
        {#if app.liveEnabled}
          <li><span class="ring" aria-hidden="true"></span>Past 30 days, M 2.5+</li>
        {/if}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .legend {
    display: grid;
    gap: 10px;
    width: 236px;
    padding: 10px 12px 10px;
    border: 1px solid var(--basalt-line);
    border-radius: var(--radius);
    background: rgba(14, 17, 22, 0.78);
    backdrop-filter: blur(6px);
    color: var(--on-dark);
  }

  .legend.medium {
    width: 180px;
    gap: 6px;
    padding: 8px 10px 8px;
  }

  .title {
    margin: 0 0 5px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--on-dark-2);
  }

  .medium .title {
    margin-bottom: 3px;
  }

  .unit {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    color: var(--on-dark-3);
  }

  .bar {
    height: 9px;
    border-radius: 2px;
  }

  .ticks,
  .classes {
    position: relative;
    height: 15px;
    margin-top: 2px;
    font-size: 0.72rem;
    color: var(--on-dark-2);
  }

  .ticks span {
    position: absolute;
    transform: translateX(-50%);
  }

  .ticks span:first-child {
    transform: none;
  }

  .ticks span:last-child {
    transform: translateX(-100%);
  }

  .classes {
    height: 14px;
    margin-top: 0;
  }

  .classes span {
    position: absolute;
    text-align: center;
    font-family: var(--serif);
    font-style: italic;
    font-size: 0.72rem;
    color: var(--on-dark-3);
    border-top: 1px solid rgba(236, 231, 220, 0.22);
    padding-top: 1px;
    white-space: nowrap;
  }

  .dots {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 2px;
  }

  .dot-wrap {
    display: grid;
    justify-items: center;
    gap: 3px;
    font-size: 0.72rem;
    color: var(--on-dark-2);
  }

  .dot {
    border-radius: 50%;
    background: var(--on-dark);
    box-shadow: 0 0 0 3px rgba(236, 231, 220, 0.12);
  }

  .keys {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.78rem;
    color: var(--on-dark-2);
  }

  .keys li {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .line {
    width: 18px;
    height: 0;
    border-top: 1.5px solid rgba(224, 145, 95, 0.75);
  }

  .line.subduction {
    border-top: 2px solid #f0a36f;
  }

  .ring {
    width: 11px;
    height: 11px;
    margin: 0 3.5px;
    border-radius: 50%;
    border: 1.5px solid var(--on-dark);
  }

  /* On a narrow stage the corner card sheds its secondary rows to stay clear of the globe. */
  @container stage (max-width: 820px) {
    .legend.full {
      width: 196px;
      gap: 6px;
      padding: 8px 10px;
    }

    .legend.full .classes,
    .legend.full .keys {
      display: none;
    }
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 0.72rem;
    color: var(--on-dark-2);
  }

  .inline .title {
    margin: 0;
    font-size: 0.66rem;
  }

  .inline .bar {
    display: inline-block;
    width: 96px;
    height: 7px;
  }

  .range {
    white-space: nowrap;
  }
</style>
