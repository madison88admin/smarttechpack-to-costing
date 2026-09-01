"use client";

import { useId } from "react";

export function SelectAllCheckbox() {
  const id = useId();

  const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      'input[name="selectedIds"]:not(:disabled)'
    );
    checkboxes.forEach((cb) => {
      cb.checked = e.target.checked;
    });
  };

  return (
    <input
      type="checkbox"
      id={id}
      aria-label="Select all rows"
      onChange={toggleAll}
    />
  );
}
