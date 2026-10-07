const intFmt = new Intl.NumberFormat('en-US');

export function formatInt(n: number): string {
  return intFmt.format(Math.round(n));
}

export function formatFixed(n: number, digits: number): string {
  return n.toFixed(digits);
}

/** "2011-03-11 05:46:24 UTC" from seconds since 1970. */
export function formatUtc(timeSeconds: number, withSeconds = true): string {
  const iso = new Date(timeSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, withSeconds ? 19 : 16)} UTC`;
}

export function formatDate(timeSeconds: number): string {
  return new Date(timeSeconds * 1000).toISOString().slice(0, 10);
}

export function formatDepth(km: number): string {
  if (km < 0) return `${Math.abs(km).toFixed(1)} km above sea level`;
  return km >= 100 ? `${formatInt(km)} km` : `${km.toFixed(km % 1 === 0 ? 0 : 1)} km`;
}

export function formatMag(mag: number, type?: string): string {
  return `M ${mag.toFixed(1)}${type ? ` ${type}` : ''}`;
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}° ${ns}, ${Math.abs(lon).toFixed(2)}° ${ew}`;
}

/** "3 min ago", "2 h ago", "4 days ago" — for the live layer's freshness label. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function usgsEventUrl(id: string): string {
  return `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

/** An uncertainty with enough decimals to be non-zero: 0.004 stays 0.004, 0.0312 becomes 0.03. */
export function formatSigma(sigma: number): string {
  if (!(sigma > 0)) return '0';
  return sigma < 0.01 ? sigma.toFixed(3) : sigma.toFixed(2);
}
