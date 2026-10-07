import { describe, expect, it } from 'vitest';
import {
  formatAge,
  formatDepth,
  formatLatLon,
  formatSigma,
  formatUtc,
  plural,
  usgsEventUrl,
} from './format';

describe('formatting', () => {
  it('formats UTC times from seconds', () => {
    const t = Math.floor(Date.parse('2011-03-11T05:46:24.120Z') / 1000);
    expect(formatUtc(t)).toBe('2011-03-11 05:46:24 UTC');
    expect(formatUtc(t, false)).toBe('2011-03-11 05:46 UTC');
  });

  it('formats depths, including events above sea level', () => {
    expect(formatDepth(10)).toBe('10 km');
    expect(formatDepth(22.9)).toBe('22.9 km');
    expect(formatDepth(631.3)).toBe('631 km');
    expect(formatDepth(-1.5)).toBe('1.5 km above sea level');
  });

  it('keeps tiny uncertainties visible', () => {
    expect(formatSigma(0.004)).toBe('0.004');
    expect(formatSigma(0.0312)).toBe('0.03');
    expect(formatSigma(0)).toBe('0');
  });

  it('formats coordinates, ages, plurals and USGS links', () => {
    expect(formatLatLon(-13.841, -67.553)).toBe('13.84° S, 67.55° W');
    expect(formatAge(30_000)).toBe('just now');
    expect(formatAge(5 * 60_000)).toBe('5 min ago');
    expect(formatAge(3 * 3600_000)).toBe('3 h ago');
    expect(formatAge(5 * 86400_000)).toBe('5 days ago');
    expect(plural(1, 'earthquake')).toBe('1 earthquake');
    expect(plural(1568, 'earthquake')).toBe('1,568 earthquakes');
    expect(usgsEventUrl('usb000h4jh')).toBe(
      'https://earthquake.usgs.gov/earthquakes/eventpage/usb000h4jh',
    );
  });
});
