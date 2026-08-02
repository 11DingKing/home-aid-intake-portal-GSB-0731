"use client";

import type { ReactNode } from "react";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: "text" | "tel";
  multiline?: boolean;
  required?: boolean;
}

/**
 * 可访问文本控件：label 关联、aria-describedby 同时挂提示与错误、
 * 错误以 role=alert 播报，供程序与读屏器识别。
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  multiline = false,
  required = false,
}: TextFieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  const control = multiline ? (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
    />
  ) : (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
    />
  );

  return (
    <div className="field" data-field={id}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true">（必填）</span> : null}
      </label>
      {control}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FieldsetProps {
  legend: string;
  children: ReactNode;
  error?: string;
  id: string;
  hint?: string;
}

export function Fieldset({ legend, children, error, id, hint }: FieldsetProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <fieldset
      className="field"
      id={id}
      aria-describedby={describedBy}
      data-field={id}
    >
      <legend>{legend}</legend>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
