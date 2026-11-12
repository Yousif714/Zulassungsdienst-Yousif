'use client';

type Option<T extends string> = { value: T; label: string };

/** Segment-Umschalter (iOS) als echte Radiogruppe: per Tastatur bedienbar, jede Option mindestens 44px hoch. */
export function Segmented<T extends string>({ name, legend, options, value, onChange }: {
  name: string;
  legend: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="segmented-option" data-checked={o.value === value}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
