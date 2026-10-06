<script lang="ts" generics="T extends string">
  interface Props {
    tabs: { id: T; label: string }[];
    active: T;
  }
  let { tabs, active = $bindable() }: Props = $props();

  let list = $state<HTMLDivElement>();

  function onKey(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === active);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    active = tabs[next].id;
    list?.querySelector<HTMLButtonElement>(`#tab-${tabs[next].id}`)?.focus();
  }
</script>

<div
  class="tabs"
  role="tablist"
  aria-label="Panels"
  bind:this={list}
  tabindex="-1"
  onkeydown={onKey}
>
  {#each tabs as tab (tab.id)}
    <button
      id={`tab-${tab.id}`}
      type="button"
      role="tab"
      aria-selected={active === tab.id}
      aria-controls={`panel-${tab.id}`}
      tabindex={active === tab.id ? 0 : -1}
      onclick={() => (active = tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 12px;
    border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }

  .tabs:focus {
    outline: none;
  }

  button {
    position: relative;
    flex: 0 1 auto;
    min-height: 46px;
    padding: 0 14px;
    border: 0;
    background: none;
    font-family: var(--sans);
    font-size: 0.92rem;
    font-weight: 650;
    color: var(--ink-3);
  }

  button:hover {
    color: var(--ink);
  }

  button[aria-selected='true'] {
    color: var(--ink);
  }

  button[aria-selected='true']::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -1px;
    height: 3px;
    border-radius: 2px 2px 0 0;
    background: var(--accent);
  }

  button:focus-visible {
    outline-offset: -4px;
  }

  @media (max-width: 699px) {
    .tabs {
      padding: 0 4px;
    }

    button {
      flex: 1 1 0;
      padding: 0 6px;
    }
  }
</style>
