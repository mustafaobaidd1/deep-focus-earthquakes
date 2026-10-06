import type { Filter } from '../lib/filters';
import type {
  CatalogColumns,
  DataMeta,
  LiveData,
  PolylineColumns,
  SectionResult,
  SectionSpec,
  StatsResult,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol';

export interface DataHandlers {
  onProgress(loaded: number, total: number): void;
  onCatalog(columns: CatalogColumns, meta: DataMeta): void;
  onLayers(coast: PolylineColumns, plates: PolylineColumns | null): void;
  onDetailsReady(): void;
  onError(scope: 'catalog' | 'details' | 'layers', message: string): void;
}

type Pending = { resolve: (value: never) => void; reject: (err: Error) => void };

/** Promise-based wrapper around the data worker. */
export class DataClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private handlers: DataHandlers) {
    this.worker = new Worker(new URL('../worker/data.worker.ts', import.meta.url), {
      type: 'module',
      name: 'deep-focus-data',
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.handlers.onError('catalog', e.message || 'The data worker failed to start.');
    };
  }

  private receive(msg: WorkerResponse) {
    switch (msg.type) {
      case 'progress':
        this.handlers.onProgress(msg.loaded, msg.total);
        return;
      case 'catalog':
        this.handlers.onCatalog(msg.columns, msg.meta);
        return;
      case 'layers':
        this.handlers.onLayers(msg.coast, msg.plates);
        return;
      case 'details-ready':
        this.handlers.onDetailsReady();
        return;
      case 'error':
        if (msg.id !== undefined) {
          this.pending.get(msg.id)?.reject(new Error(msg.message));
          this.pending.delete(msg.id);
        } else if (msg.scope !== 'request') {
          this.handlers.onError(msg.scope, msg.message);
        }
        return;
      default: {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        const value =
          msg.type === 'stats'
            ? msg.result
            : msg.type === 'section'
              ? msg.result
              : msg.type === 'details'
                ? msg.items
                : msg.result;
        (p.resolve as (v: unknown) => void)(value);
      }
    }
  }

  private request<T>(build: (id: number) => WorkerRequest): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage(build(id));
    });
  }

  init(dataUrl: string) {
    this.worker.postMessage({ type: 'init', dataUrl } satisfies WorkerRequest);
  }

  stats(filter: Filter): Promise<StatsResult> {
    return this.request((id) => ({ type: 'stats', id, filter: { ...filter } }));
  }

  section(filter: Filter, spec: SectionSpec): Promise<SectionResult> {
    return this.request((id) => ({
      type: 'section',
      id,
      filter: { ...filter },
      spec: { ...spec, a: [...spec.a], b: [...spec.b] },
    }));
  }

  details(indices: number[]): Promise<{ id: string; place: string }[]> {
    return this.request((id) => ({ type: 'details', id, indices }));
  }

  parseLive(text: string): Promise<LiveData> {
    return this.request((id) => ({ type: 'parse-live', id, text }));
  }

  terminate() {
    this.worker.terminate();
  }
}
