/**
 * A small RFC 4180 CSV reader. USGS ComCat CSV quotes the `place` column whenever it contains a
 * comma ("55 km NNW of Reyes, Bolivia"), and escapes embedded quotes by doubling them.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34 /* " */) {
        if (text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += text[i];
      i++;
      continue;
    }
    if (c === 34) {
      inQuotes = true;
      i++;
    } else if (c === 44 /* , */) {
      row.push(field);
      field = '';
      i++;
    } else if (c === 10 /* \n */ || c === 13 /* \r */) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      // Treat \r\n as one line break.
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    } else {
      field += text[i];
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (a trailing newline produces one row with a single empty field).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** One earthquake as published in ComCat CSV, with only the columns this project uses. */
export interface QuakeRow {
  /** Origin time, milliseconds since 1970-01-01T00:00:00Z. */
  timeMs: number;
  lat: number;
  lon: number;
  /** Depth below sea level in km (USGS reports negative values for events above sea level). */
  depth: number;
  mag: number;
  magType: string;
  id: string;
  place: string;
  type: string;
}

/**
 * Turns ComCat CSV text into typed rows, using the header to locate columns so that the reader
 * keeps working if USGS appends columns. Rows without a usable time, location or magnitude are
 * skipped and counted, never silently invented.
 */
export function parseComcatCsv(text: string): { rows: QuakeRow[]; skipped: number } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], skipped: 0 };
  const header = table[0].map((h) => h.trim());
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx < 0) throw new Error(`ComCat CSV is missing the "${name}" column`);
    return idx;
  };
  const iTime = col('time');
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDepth = col('depth');
  const iMag = col('mag');
  const iMagType = col('magType');
  const iId = col('id');
  const iPlace = col('place');
  const iType = col('type');

  const rows: QuakeRow[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const f = table[r];
    const timeMs = Date.parse(f[iTime]);
    const lat = Number.parseFloat(f[iLat]);
    const lon = Number.parseFloat(f[iLon]);
    const depth = Number.parseFloat(f[iDepth]);
    const mag = Number.parseFloat(f[iMag]);
    if (
      !Number.isFinite(timeMs) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(depth) ||
      !Number.isFinite(mag)
    ) {
      skipped++;
      continue;
    }
    rows.push({
      timeMs,
      lat,
      lon,
      depth,
      mag,
      magType: (f[iMagType] ?? '').trim().toLowerCase(),
      id: (f[iId] ?? '').trim(),
      place: (f[iPlace] ?? '').trim(),
      type: (f[iType] ?? '').trim(),
    });
  }
  return { rows, skipped };
}
