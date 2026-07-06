import { Interval, generateRequiredDates, findMissingRanges } from './dateUtils.js';

describe('Date Utilities', () => {
  describe('generateRequiredDates', () => {
    it('generates daily dates correctly', () => {
      const dates = generateRequiredDates('2023-01-01', '2023-01-03', Interval.DAILY);
      expect(dates.length).toBe(3);
      expect(dates[0].getFullYear()).toBe(2023);
      expect(dates[0].getMonth()).toBe(0); // Jan is 0
      expect(dates[0].getDate()).toBe(1);
      expect(dates[2].getFullYear()).toBe(2023);
      expect(dates[2].getMonth()).toBe(0);
      expect(dates[2].getDate()).toBe(3);
    });

    it('generates weekly dates correctly', () => {
      const dates = generateRequiredDates('2023-01-01', '2023-01-15', Interval.WEEKLY);
      expect(dates.length).toBe(3); // 1st, 8th, 15th
    });
  });

  describe('findMissingRanges', () => {
    it('finds full missing range when no dates exist', () => {
      const required = generateRequiredDates('2023-01-01', '2023-01-05', Interval.DAILY);
      const ranges = findMissingRanges(required, []);
      expect(ranges.length).toBe(1);
      expect(ranges[0].from).toEqual(required[0]);
      expect(ranges[0].to).toEqual(required[required.length - 1]);
    });

    it('returns empty array when all dates exist', () => {
      const required = generateRequiredDates('2023-01-01', '2023-01-05', Interval.DAILY);
      const ranges = findMissingRanges(required, required);
      expect(ranges.length).toBe(0);
    });
    
    it('returns a range that spans all missing dates', () => {
      const required = generateRequiredDates('2023-01-01', '2023-01-05', Interval.DAILY);
      const existing = [required[1], required[3]]; // Has 2nd and 4th
      const ranges = findMissingRanges(required, existing);
      expect(ranges.length).toBe(1);
      expect(ranges[0].from).toEqual(required[0]); // 1st is missing
      expect(ranges[0].to).toEqual(required[4]); // 5th is missing
    });
  });
});
