import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  accepts,
  dayNumber,
  dayOfYearStart,
  defaultFilter,
  isDefault,
  toBounds,
} from './filters';

describe('filter bounds', () => {
  it('leaves both ends open when the sliders rest on their extents', () => {
    const b = toBounds(defaultFilter());
    expect(b.mag100).toEqual([-1e9, 1e9]);
    expect(b.depth10).toEqual([-1e9, 1e9]);
    expect(b.day).toEqual([-1e9, 1e9]);
    // So events above sea level (negative depth) and the deepest ones are never dropped.
    expect(accepts(b, 500, -30, 0)).toBe(true);
    expect(accepts(b, 910, 7000, 20000)).toBe(true);
  });

  it('is inclusive at both ends and compares integers exactly', () => {
    const b = toBounds({
      ...defaultFilter(),
      magMin: 6.1,
      magMax: 7.3,
      depthMin: 70,
      depthMax: 300,
    });
    expect(b.mag100).toEqual([610, 730]);
    expect(b.depth10).toEqual([700, 3000]);
    expect(accepts(b, 610, 700, 0)).toBe(true);
    expect(accepts(b, 730, 3000, 0)).toBe(true);
    expect(accepts(b, 609, 700, 0)).toBe(false);
    expect(accepts(b, 731, 700, 0)).toBe(false);
    expect(accepts(b, 650, 699, 0)).toBe(false);
    expect(accepts(b, 650, 3001, 0)).toBe(false);
  });

  it('turns a year range into whole UTC days', () => {
    const b = toBounds({ ...defaultFilter(), yearMin: 1994, yearMax: 1994 });
    const bolivia = Math.floor(Date.parse('1994-06-09T00:33:16Z') / 1000);
    expect(accepts(b, 820, 6313, dayNumber(bolivia))).toBe(true);
    expect(b.day[0]).toBe(dayOfYearStart(1994));
    expect(b.day[1]).toBe(dayOfYearStart(1995) - 1);
    // First and last seconds of the year are in; the next second is out.
    expect(accepts(b, 500, 100, dayNumber(Date.UTC(1994, 0, 1) / 1000))).toBe(true);
    expect(accepts(b, 500, 100, dayNumber(Date.UTC(1994, 11, 31, 23, 59, 59) / 1000))).toBe(true);
    expect(accepts(b, 500, 100, dayNumber(Date.UTC(1995, 0, 1) / 1000))).toBe(false);
  });

  it('knows when the filter is the default one', () => {
    expect(isDefault(defaultFilter())).toBe(true);
    expect(isDefault({ ...defaultFilter(), depthMin: 10 })).toBe(false);
    expect(LIMITS.year).toEqual([1973, 2025]);
  });
});
