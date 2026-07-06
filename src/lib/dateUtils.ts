import { addDays, addMonths, startOfDay, isBefore, isSameDay } from 'date-fns';

export enum Interval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export function generateRequiredDates(fromStr: string, toStr: string, interval: Interval): Date[] {
  const from = startOfDay(new Date(fromStr));
  const to = startOfDay(new Date(toStr));
  
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Invalid date format');
  }

  if (isBefore(to, from)) {
    throw new Error('"to" date cannot be before "from" date');
  }

  const dates: Date[] = [];
  let current = from;

  while (isBefore(current, to) || isSameDay(current, to)) {
    dates.push(current);

    if (interval === Interval.DAILY) {
      current = addDays(current, 1);
    } else if (interval === Interval.WEEKLY) {
      current = addDays(current, 7);
    } else if (interval === Interval.MONTHLY) {
      current = addMonths(current, 1);
    }
  }

  return dates;
}

export function findMissingRanges(requiredDates: Date[], existingDates: Date[]): { from: Date; to: Date }[] {
  const existingSet = new Set(existingDates.map(d => d.getTime()));
  const missingDates = requiredDates.filter(d => !existingSet.has(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  
  if (missingDates.length === 0) return [];
  
  return [{
    from: missingDates[0],
    to: missingDates[missingDates.length - 1]
  }];
}
