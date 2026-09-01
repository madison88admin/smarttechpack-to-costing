"use client";

import { useMemo, useState } from "react";

export function SearchableFilter({
  name,
  label,
  value,
  options
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const listboxId = `${name}-filter-options`;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options.filter((option) => !needle || option.toLowerCase().includes(needle)).slice(0, 30);
  }, [options, query]);

  return (
    <div className="searchable-filter">
      <input
        className="input"
        name={name}
        value={query}
        placeholder={label}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && filtered.length ? (
        <div id={listboxId} className="searchable-filter-menu" role="listbox" aria-label={`${label} options`}>
          {filtered.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option === query}
              className="searchable-filter-option"
              key={option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
