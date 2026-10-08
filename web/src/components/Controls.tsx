import { useState } from "react";
import type { KeyboardEvent } from "react";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? "on" : ""}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

/** Saisie de mots sous forme de pastilles (Entrée, virgule ou espace pour valider). */
export function ChipsInput({ value, onChange, placeholder }: { value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const words = raw
      .split(/[\s,]+/)
      .map((word) => word.replace(/^-+/, "").trim().toLowerCase())
      .filter((word) => word && !value.includes(word));
    if (words.length > 0) onChange([...value, ...new Set(words)]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="chips-input">
      {value.map((word) => (
        <span key={word} className="chip">
          {word}
          <button type="button" aria-label={`Retirer ${word}`} onClick={() => onChange(value.filter((w) => w !== word))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && commit(draft)}
        placeholder={value.length === 0 ? placeholder : ""}
        aria-label={placeholder}
      />
    </div>
  );
}

export function QuotaBar({ used, budget }: { used: number; budget: number }) {
  const ratio = Math.min(used / budget, 1);
  return (
    <div className="quota">
      <div className="quota-track">
        <div className={`quota-fill ${ratio > 0.85 ? "warn" : ""}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span>
        {used.toLocaleString("fr-FR")} / {budget.toLocaleString("fr-FR")} appels eBay aujourd'hui
      </span>
    </div>
  );
}
