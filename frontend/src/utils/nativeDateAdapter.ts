import { _adapters } from "chart.js";

type Unit =
  | "millisecond"
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

const UNIT_SIZE: Record<Exclude<Unit, "month" | "quarter" | "year">, number> = {
  millisecond: 1,
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

const clampTime = (time: number | string | Date | null | undefined) => {
  if (time == null) return null;
  if (typeof time === "number") return Number.isFinite(time) ? time : null;
  if (time instanceof Date) return Number.isFinite(time.getTime()) ? time.getTime() : null;
  const parsed = Date.parse(time);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDate = (time: number, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(time));

const addTime = (time: number, amount: number, unit: Unit) => {
  const date = new Date(time);
  switch (unit) {
    case "millisecond":
      date.setMilliseconds(date.getMilliseconds() + amount);
      break;
    case "second":
      date.setSeconds(date.getSeconds() + amount);
      break;
    case "minute":
      date.setMinutes(date.getMinutes() + amount);
      break;
    case "hour":
      date.setHours(date.getHours() + amount);
      break;
    case "day":
      date.setDate(date.getDate() + amount);
      break;
    case "week":
      date.setDate(date.getDate() + amount * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() + amount);
      break;
    case "quarter":
      date.setMonth(date.getMonth() + amount * 3);
      break;
    case "year":
      date.setFullYear(date.getFullYear() + amount);
      break;
    default:
      break;
  }
  return date.getTime();
};

const diffTime = (max: number, min: number, unit: Unit) => {
  if (unit === "month" || unit === "quarter" || unit === "year") {
    const start = new Date(min);
    const end = new Date(max);
    let months = (end.getFullYear() - start.getFullYear()) * 12;
    months += end.getMonth() - start.getMonth();
    const monthDiff = months + (end.getDate() - start.getDate()) / 30;
    if (unit === "month") return monthDiff;
    if (unit === "quarter") return monthDiff / 3;
    return monthDiff / 12;
  }
  const size = UNIT_SIZE[unit as keyof typeof UNIT_SIZE] ?? 1;
  return (max - min) / size;
};

const startOf = (time: number, unit: Unit, weekday = 0) => {
  const date = new Date(time);
  switch (unit) {
    case "millisecond":
      return date.getTime();
    case "second":
      date.setMilliseconds(0);
      break;
    case "minute":
      date.setSeconds(0, 0);
      break;
    case "hour":
      date.setMinutes(0, 0, 0);
      break;
    case "day":
      date.setHours(0, 0, 0, 0);
      break;
    case "week": {
      const day = date.getDay();
      const diff = (day < weekday ? 7 : 0) + day - weekday;
      date.setDate(date.getDate() - diff);
      date.setHours(0, 0, 0, 0);
      break;
    }
    case "month":
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      break;
    case "quarter": {
      const currentMonth = date.getMonth();
      const quarterStart = currentMonth - (currentMonth % 3);
      date.setMonth(quarterStart, 1);
      date.setHours(0, 0, 0, 0);
      break;
    }
    case "year":
      date.setMonth(0, 1);
      date.setHours(0, 0, 0, 0);
      break;
    default:
      break;
  }
  return date.getTime();
};

const endOf = (time: number, unit: Unit) => {
  const start = startOf(time, unit);
  const end = addTime(start, 1, unit);
  return end - 1;
};

if (_adapters._date) {
  _adapters._date.override({
    formats: () => ({
      datetime: "MMM d, yyyy, HH:mm",
      millisecond: "HH:mm:ss.SSS",
      second: "HH:mm:ss",
      minute: "HH:mm",
      hour: "HH:mm",
      day: "MMM d",
      week: "MMM d",
      month: "MMM yyyy",
      quarter: "QQQ yyyy",
      year: "yyyy",
    }),
    parse: (value: unknown) => clampTime(value as number | string | Date | null | undefined),
    format: (time: number, format?: string) => {
      switch (format) {
        case "day":
          return formatDate(time, { month: "short", day: "numeric" });
        case "month":
          return formatDate(time, { month: "short", year: "numeric" });
        case "year":
          return formatDate(time, { year: "numeric" });
        default:
          return formatDate(time, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
      }
    },
    add: (time: number, amount: number, unit: Unit) => addTime(time, amount, unit),
    diff: (max: number, min: number, unit: Unit) => diffTime(max, min, unit),
    startOf: (time: number, unit: Unit, weekday?: number) => startOf(time, unit, weekday),
    endOf: (time: number, unit: Unit) => endOf(time, unit),
  });
}

