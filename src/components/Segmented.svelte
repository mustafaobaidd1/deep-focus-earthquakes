<script lang="ts" generics="T extends string | number">
  interface Props {
    label: string;
    options: { value: T; label: string; title?: string }[];
    value: T;
    disabled?: boolean;
    title?: string;
    onchange?: (value: T) => void;
  }
  let { label, options, value = $bindable(), disabled = false, title, onchange }: Props = $props();

  let group = $state<HTMLDivElement>();

  function choose(v: T, focus = false) {
    if (disabled) return;
    value = v;
    onchange?.(v);
    if (focus) {
      const i = options.findIndex((o) => o.value === v);
      group?.querySelectorAll<HTMLButtonElement>('button')[i]?.focus();
    }
  }

  function onKey(e: KeyboardEvent) {
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (i - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    choose(options[next].value, true);
  }
</script>

<div
  class="segmented"
  role="radiogroup"
  aria-label={label}
  aria-disabled={disabled}
  {title}
  bind:this={group}
  tabindex="-1"
  onkeydown={onKey}
>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      title={o.title}
      {disabled}
      onclick={() => choose(o.value)}>{o.label}</button
    >
  {/each}
</div>

<style>
  .segmented:focus {
    outline: none;
  }
</style>
