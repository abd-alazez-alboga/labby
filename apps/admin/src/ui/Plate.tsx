/**
 * A licence plate: always Arabic type (IBM Plex Sans Arabic) and RTL, even
 * inside an English layout, inside a thin plate outline.
 */
export function Plate({ value }: { value: string }) {
  return (
    <span className="plate" dir="rtl" lang="ar">
      {value}
    </span>
  );
}
