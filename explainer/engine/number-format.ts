/** How a chart value reads on screen: "$22,200", "4,215ms", "98%". Currency symbols go in front; thousands get commas. */
export function formatValue(value: number, unit = '', decimals = Number.isInteger(value) ? 0 : 1): string {
  const n = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return /^[$€£¥₦₹]$/.test(unit.trim()) ? `${unit.trim()}${n}` : `${n}${unit}`;
}
