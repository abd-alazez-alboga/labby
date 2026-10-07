export interface FilterChipOption<T extends string | number> {
  value: T;
  label: string;
  count?: number;
}

/**
 * Pill filters (38 px): selected = near-black fill + white label,
 * unselected = white with a strong outline. Selection state is exposed
 * through aria-pressed; the owner page decides what toggling means.
 */
export function FilterChips<T extends string | number>({
  label,
  options,
  isSelected,
  isDisabled,
  onSelect,
}: {
  /** Accessible name of the group. */
  label: string;
  options: readonly FilterChipOption<T>[];
  isSelected: (value: T) => boolean;
  isDisabled?: (value: T) => boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="filter-chips" role="group" aria-label={label}>
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            className={selected ? 'filter-chip filter-chip--active' : 'filter-chip'}
            aria-pressed={selected}
            disabled={isDisabled?.(option.value) ?? false}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
            {option.count !== undefined ? ` · ${option.count}` : null}
          </button>
        );
      })}
    </div>
  );
}
