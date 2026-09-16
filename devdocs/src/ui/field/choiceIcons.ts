/** "fishing_spot" reads "Fishing spot"; a label someone already wrote is kept. */
export function choiceLabel(value: string, label: string): string {
  if (label !== value || !/^[a-z][a-z0-9_]*$/.test(value)) return label;
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
