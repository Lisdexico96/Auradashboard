"use client";

import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FilterSelectProps {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterSelect({ label, options, value, onChange, placeholder = "Search or select…" }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => (search.trim() ? options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())) : options),
    [options, search]
  );

  const displayValue = open ? search : value === "_all" ? "" : value;
  const setValue = (v: string) => {
    onChange(v);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="w-48"
        />
        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-48 overflow-auto rounded-md border border-border bg-card py-1 shadow-lg">
            <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setValue("_all")}>
              All
            </button>
            {filtered.map((opt) => (
              <button key={opt} type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => setValue(opt)}>
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
