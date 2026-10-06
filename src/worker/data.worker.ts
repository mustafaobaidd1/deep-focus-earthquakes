/**
 * Data worker: downloads and decodes the bundled catalogue and map layers, then answers
 * statistics, cross-section, place-name and live-feed parsing requests off the main thread.
 */
import { decodeCatalog, decodeDetails, isGzip, type Catalog } from '../lib/codec';
import { parseComcatCsv } from '../lib/csv';
import { decodePolylines, type PolylineSet } from '../lib/polyline';
import { computeSection, computeStats } from '../lib/selection';
import type {
  CatalogColumns,
  LiveData,
  PolylineColumns,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer);

let catalog: Catalog | null = null;
let details: { ids: string[]; places: string[] } | null = null;
let detailsFailed: string | null = null;
const detailWaiters: (() => void)[] = [];

async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  // Static hosts serve .gz files either as-is (application/gzip) or with
  // Content-Encoding: gzip (already decoded by the browser): handle both.
  if (!isGzip(bytes)) return bytes;
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fetchBytes(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body || !onProgress) return gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const all = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return gunzipIfNeeded(all);
}

function columnsOf(set: PolylineSet): PolylineColumns {
  let points = 0;
  for (const l of set.lines) points += l.length / 2;
  const coords = new Float32Array(points * 2);
  const offsets = new Uint32Array(set.lines.length + 1);
  let p = 0;
  set.lines.forEach((l, i) => {
    offsets[i] = p;
    coords.set(l, p * 2);
    p += l.length / 2;
  });
  offsets[set.lines.length] = p;
  return { coords, offsets, kinds: set.kinds, kindNames: set.kindNames };
}

async function init(dataUrl: string) {
  try {
    const [bytes, logText] = await Promise.all([
      fetchBytes(`${dataUrl}catalog.bin.gz`, (loaded, total) =>
        post({ type: 'progress', loaded, total }),
      ),
      fetch(`${dataUrl}fetch-log.json`).then((r) => (r.ok ? r.text() : '{}')),
    ]);
    catalog = decodeCatalog(bytes);
    const log = JSON.parse(logText) as {
      fetchedAt?: string;
      query?: { firstYear: number; lastYear: number };
    };
    const day = new Float32Array(catalog.count);
    for (let i = 0; i < catalog.count; i++) day[i] = Math.floor(catalog.time[i] / 86400);
    const columns: CatalogColumns = {
      count: catalog.count,
      time: catalog.time.slice(),
      day,
      lat: catalog.lat.slice(),
      lon: catalog.lon.slice(),
      depth10: catalog.depth10.slice(),
      mag100: catalog.mag100.slice(),
      magType: catalog.magType.slice(),
      magTypes: catalog.magTypes,
    };
    post(
      {
        type: 'catalog',
        columns,
        meta: {
          fetchedAt: log.fetchedAt ?? '',
          total: catalog.count,
          firstYear: log.query?.firstYear ?? 1973,
          lastYear: log.query?.lastYear ?? 2025,
        },
      },
      [
        columns.time.buffer,
        columns.day.buffer,
        columns.lat.buffer,
        columns.lon.buffer,
        columns.depth10.buffer,
        columns.mag100.buffer,
        columns.magType.buffer,
      ],
    );
  } catch (err) {
    post({ type: 'error', scope: 'catalog', message: (err as Error).message });
    return;
  }

  // Map layers, then place names: neither blocks the globe.
  try {
    const [coastBytes, plateBytes] = await Promise.all([
      fetchBytes(`${dataUrl}coast.bin.gz`),
      fetchBytes(`${dataUrl}plates.bin.gz`).catch(() => null),
    ]);
    const coast = columnsOf(decodePolylines(coastBytes));
    const plates = plateBytes ? columnsOf(decodePolylines(plateBytes)) : null;
    const transfer: Transferable[] = [coast.coords.buffer, coast.offsets.buffer];
    if (plates) transfer.push(plates.coords.buffer, plates.offsets.buffer);
    post({ type: 'layers', coast, plates }, transfer);
  } catch (err) {
    post({ type: 'error', scope: 'layers', message: (err as Error).message });
  }

  try {
    const text = new TextDecoder().decode(await fetchBytes(`${dataUrl}details.tsv.gz`));
    details = decodeDetails(text, catalog.count);
    post({ type: 'details-ready' });
  } catch (err) {
    detailsFailed = (err as Error).message;
    post({ type: 'error', scope: 'details', message: detailsFailed });
  }
  detailWaiters.splice(0).forEach((resolve) => resolve());
}

function parseLive(text: string): LiveData {
  const { rows } = parseComcatCsv(text);
  const quakes = rows.filter((r) => r.type === 'earthquake').sort((a, b) => a.timeMs - b.timeMs);
  const n = quakes.length;
  const out: LiveData = {
    count: n,
    time: new Float64Array(n),
    lat: new Float32Array(n),
    lon: new Float32Array(n),
    depthKm: new Float32Array(n),
    mag: new Float32Array(n),
    magTypes: new Array<string>(n),
    ids: new Array<string>(n),
    places: new Array<string>(n),
  };
  quakes.forEach((q, i) => {
    out.time[i] = Math.floor(q.timeMs / 1000);
    out.lat[i] = q.lat;
    out.lon[i] = q.lon;
    out.depthKm[i] = q.depth;
    out.mag[i] = q.mag;
    out.magTypes[i] = q.magType;
    out.ids[i] = q.id;
    out.places[i] = q.place;
  });
  return out;
}

scope.onmessage = async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        await init(msg.dataUrl);
        break;
      case 'stats':
        if (!catalog) throw new Error('Catalogue not loaded');
        post({ type: 'stats', id: msg.id, result: computeStats(catalog, msg.filter) });
        break;
      case 'section': {
        if (!catalog) throw new Error('Catalogue not loaded');
        const result = computeSection(catalog, msg.filter, msg.spec);
        post({ type: 'section', id: msg.id, result }, [
          result.index.buffer,
          result.along.buffer,
          result.cross.buffer,
          result.depth.buffer,
          result.mag.buffer,
        ]);
        break;
      }
      case 'details': {
        if (!details && !detailsFailed) await new Promise<void>((r) => detailWaiters.push(r));
        const items = msg.indices.map((i) => ({
          id: details?.ids[i] ?? '',
          place: details?.places[i] ?? '',
        }));
        post({ type: 'details', id: msg.id, items });
        break;
      }
      case 'parse-live':
        post({ type: 'live', id: msg.id, result: parseLive(msg.text) });
        break;
    }
  } catch (err) {
    post({
      type: 'error',
      id: 'id' in msg ? msg.id : undefined,
      scope: 'request',
      message: (err as Error).message,
    });
  }
};
