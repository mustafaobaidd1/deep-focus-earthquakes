<script lang="ts">
  type Name =
    | 'pencil'
    | 'live'
    | 'plates'
    | 'rotate'
    | 'map'
    | 'globe'
    | 'reset'
    | 'more'
    | 'close'
    | 'refresh'
    | 'info'
    | 'chevron'
    | 'target';
  interface Props {
    name: Name;
    size?: number;
  }
  let { name, size = 16 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'pencil'}
    <path d="M10.8 2.6l2.6 2.6-7.9 7.9-3.3.7.7-3.3 7.9-7.9z" />
    <path d="M9.4 4l2.6 2.6" />
  {:else if name === 'live'}
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    <path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8" />
    <path d="M2.4 2.4a7.9 7.9 0 0 0 0 11.2M13.6 2.4a7.9 7.9 0 0 1 0 11.2" opacity="0.6" />
  {:else if name === 'plates'}
    <path d="M1.5 10.5c2.2-1 3.4-3.8 6-4.2 2.4-.4 4 1.3 7-.8" />
    <path d="M5.5 7.2l-.8-1.8M8.6 6.4l-.2-2M11.6 6.6l.4-1.9" />
  {:else if name === 'rotate'}
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13.2 2.2v3h-3" />
  {:else if name === 'map'}
    <path d="M1.8 3.8l4-1.6 4.4 1.6 4-1.6v10l-4 1.6-4.4-1.6-4 1.6z" />
    <path d="M5.8 2.2v10M10.2 3.8v10" />
  {:else if name === 'globe'}
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c2 2.2 2 10.2 0 12.4M8 1.8c-2 2.2-2 10.2 0 12.4" />
  {:else if name === 'reset'}
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <path d="M8 .9v2.2M8 12.9v2.2M.9 8h2.2M12.9 8h2.2" />
  {:else if name === 'more'}
    <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
  {:else if name === 'close'}
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  {:else if name === 'refresh'}
    <path d="M13.2 6.6A5.4 5.4 0 0 0 3.3 5M2.8 9.4A5.4 5.4 0 0 0 12.7 11" />
    <path d="M3 2.2V5h2.8M13 13.8V11h-2.8" />
  {:else if name === 'info'}
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.2v4M8 4.8v.2" />
  {:else if name === 'chevron'}
    <path d="M4 6l4 4 4-4" />
  {:else if name === 'target'}
    <circle cx="8" cy="8" r="5" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
  {/if}
</svg>
