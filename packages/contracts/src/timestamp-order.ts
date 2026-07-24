function submillisecondDigits(timestamp: string): string {
  return /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp)?.[1]?.slice(3) ?? "";
}

export function isTimestampAtOrAfter(timestamp: string, minimum: string): boolean {
  const timestampMilliseconds = Date.parse(timestamp);
  const minimumMilliseconds = Date.parse(minimum);
  if (timestampMilliseconds !== minimumMilliseconds) {
    return timestampMilliseconds > minimumMilliseconds;
  }

  const timestampRemainder = submillisecondDigits(timestamp);
  const minimumRemainder = submillisecondDigits(minimum);
  const precision = Math.max(timestampRemainder.length, minimumRemainder.length);
  return (
    timestampRemainder.padEnd(precision, "0") >= minimumRemainder.padEnd(precision, "0")
  );
}
