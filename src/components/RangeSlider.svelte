<script lang="ts">
  interface Props {
    label: string;
    min: number;
    max: number;
    step: number;
    low: number;
    high: number;
    /** Formats a value for display and for screen readers. */
    format: (v: number) => string;
    /** Text for the whole range when both handles rest on the extents. */
    allLabel: string;
    unit?: string;
    variant?: 'dark' | 'paper';
    id: string;
    disabled?: boolean;
    onchange?: (low: number, high: number) => void;
  }
  let {
    label,
    min,
    max,
    step,
    low = $bindable(),
    high = $bindable(),
    format,
    allLabel,
    unit = '',
    variant = 'paper',
    id,
    disabled = false,
    onchange,
  }: Props = $props();

  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const isAll = $derived(low <= min && high >= max);
  const summary = $derived(
    isAll
      ? allLabel
      : low <= min
        ? `up to ${format(high)}${unit}`
        : high >= max
          ? `${format(low)}${unit} and above`
          : `${format(low)}–${format(high)}${unit}`,
  );

  // The thumbs may not cross: clamp, and snap the native input back when clamped.
  function setLow(input: HTMLInputElement) {
    low = Math.min(Number(input.value), high);
    input.value = String(low);
    onchange?.(low, high);
  }
  function setHigh(input: HTMLInputElement) {
    high = Math.max(Number(input.value), low);
    input.value = String(high);
    onchange?.(low, high);
  }
</script>

<div class="range {variant}" class:disabled>
  <div class="head">
    <span class="label" id={`${id}-label`}>{label}</span>
    <span class="value num" aria-hidden="true">{summary}</span>
  </div>
  <div class="track-wrap" style:--lo={`${pct(low)}%`} style:--hi={`${pct(high)}%`}>
    <div class="track" aria-hidden="true"><div class="fill"></div></div>
    <input
      type="range"
      {min}
      {max}
      {step}
      value={low}
      {disabled}
      aria-label={`${label}: lower limit`}
      aria-valuetext={low <= min
        ? `no lower limit (${format(min)}${unit})`
        : `${format(low)}${unit}`}
      oninput={(e) => setLow(e.currentTarget)}
      class:on-top={low >= max - (max - min) * 0.02}
    />
    <input
      type="range"
      {min}
      {max}
      {step}
      value={high}
      {disabled}
      aria-label={`${label}: upper limit`}
      aria-valuetext={high >= max
        ? `no upper limit (${format(max)}${unit})`
        : `${format(high)}${unit}`}
      oninput={(e) => setHigh(e.currentTarget)}
    />
  </div>
</div>

<style>
  .range {
    --thumb: 20px;
    --track-bg: var(--rule);
    --fill: var(--ink);
    --thumb-bg: var(--paper-raised);
    --thumb-border: var(--ink);
    min-width: 0;
  }

  .range.dark {
    --track-bg: rgba(236, 231, 220, 0.2);
    --fill: var(--on-dark);
    --thumb-bg: var(--basalt-solid);
    --thumb-border: var(--on-dark);
  }

  @media (pointer: coarse) {
    .range {
      --thumb: 26px;
    }
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }

  .label {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  .dark .label {
    color: var(--on-dark-3);
  }

  .value {
    font-size: 0.92rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .track-wrap {
    position: relative;
    height: max(var(--thumb), 28px);
  }

  .track {
    position: absolute;
    left: calc(var(--thumb) / 2);
    right: calc(var(--thumb) / 2);
    top: 50%;
    height: 4px;
    margin-top: -2px;
    border-radius: 2px;
    background: var(--track-bg);
  }

  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--lo);
    right: calc(100% - var(--hi));
    border-radius: 2px;
    background: var(--fill);
  }

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    background: none;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
  }

  input.on-top {
    z-index: 2;
  }

  input::-webkit-slider-runnable-track {
    background: none;
    border: 0;
  }

  input::-moz-range-track {
    background: none;
    border: 0;
  }

  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    pointer-events: auto;
    width: var(--thumb);
    height: var(--thumb);
    border-radius: 50%;
    background: var(--thumb-bg);
    border: 2px solid var(--thumb-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    cursor: grab;
  }

  input::-moz-range-thumb {
    pointer-events: auto;
    width: var(--thumb);
    height: var(--thumb);
    border-radius: 50%;
    background: var(--thumb-bg);
    border: 2px solid var(--thumb-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    cursor: grab;
  }

  input:active::-webkit-slider-thumb {
    cursor: grabbing;
  }

  input:focus-visible {
    outline: none;
  }

  input:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  input:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .disabled {
    opacity: 0.5;
  }
</style>
