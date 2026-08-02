"use client";

import React, { useEffect, useRef } from "react";

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  autoComplete?: string;
}

export function TextField({
  id,
  name,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  hint,
  error,
  autoComplete,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`form-group ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" className="material-required"> *</span>}
      </label>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-required={required}
        aria-describedby={describedBy || undefined}
        autoComplete={autoComplete}
      />
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </div>
  );
}

interface TextAreaProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  error?: string;
  rows?: number;
}

export function TextArea({
  id,
  name,
  label,
  value,
  onChange,
  required = false,
  hint,
  error,
  rows = 5,
}: TextAreaProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`form-group ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" className="material-required"> *</span>}
      </label>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        rows={rows}
        aria-invalid={error ? "true" : undefined}
        aria-required={required}
        aria-describedby={describedBy || undefined}
      />
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  id: string;
  name: string;
  label: string;
  value: T | "";
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  required?: boolean;
  hint?: string;
  error?: string;
  placeholder?: string;
}

export function SelectField<T extends string>({
  id,
  name,
  label,
  value,
  onChange,
  options,
  required = false,
  hint,
  error,
  placeholder = "请选择...",
}: SelectFieldProps<T>) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`form-group ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" className="material-required"> *</span>}
      </label>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-required={required}
        aria-describedby={describedBy || undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </div>
  );
}

interface CheckboxGroupProps<T extends string> {
  id: string;
  name: string;
  legend: string;
  value: T[];
  onChange: (value: T[]) => void;
  options: { value: T; label: string; description?: string }[];
  hint?: string;
  error?: string;
}

export function CheckboxGroup<T extends string>({
  id,
  name,
  legend,
  value,
  onChange,
  options,
  hint,
  error,
}: CheckboxGroupProps<T>) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  const toggle = (val: T) => {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  };

  return (
    <fieldset>
      <legend>{legend}</legend>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <div
        className="checkbox-group"
        role="group"
        aria-describedby={describedBy || undefined}
        id={id}
      >
        {options.map((opt) => {
          const checked = value.includes(opt.value);
          return (
            <div className="checkbox-item" key={opt.value}>
              <input
                type="checkbox"
                id={`${id}-${opt.value}`}
                name={name}
                value={opt.value}
                checked={checked}
                onChange={() => toggle(opt.value)}
                aria-invalid={error ? "true" : undefined}
              />
              <label htmlFor={`${id}-${opt.value}`}>
                {opt.label}
                {opt.description && (
                  <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
                    {opt.description}
                  </span>
                )}
              </label>
            </div>
          );
        })}
      </div>
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </fieldset>
  );
}

interface RadioGroupProps<T extends string> {
  id: string;
  name: string;
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; description?: string }[];
  required?: boolean;
  hint?: string;
  error?: string;
}

export function RadioGroup<T extends string>({
  id,
  name,
  legend,
  value,
  onChange,
  options,
  required = false,
  hint,
  error,
}: RadioGroupProps<T>) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset>
      <legend>
        {legend}
        {required && <span aria-hidden="true" className="material-required"> *</span>}
      </legend>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <div
        className="checkbox-group"
        role="radiogroup"
        aria-required={required}
        aria-describedby={describedBy || undefined}
        id={id}
      >
        {options.map((opt) => (
          <div className="checkbox-item" key={opt.value}>
            <input
              type="radio"
              id={`${id}-${opt.value}`}
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              aria-invalid={error ? "true" : undefined}
            />
            <label htmlFor={`${id}-${opt.value}`}>
              {opt.label}
              {opt.description && (
                <span style={{ display: "block", color: "var(--color-text-muted)", fontSize: "0.875rem" }}
                >
                  {opt.description}
                </span>
              )}
            </label>
          </div>
        ))}
      </div>
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </fieldset>
  );
}

interface MaterialUploadProps {
  id: string;
  name: string;
  label: string;
  value: MaterialMeta | null;
  onChange: (meta: MaterialMeta | null) => void;
  required?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
}

export interface MaterialMeta {
  materialId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: "UPLOADED" | "PENDING" | "REJECTED";
}

export function MaterialUpload({
  id,
  name,
  label,
  value,
  onChange,
  required = false,
  hint,
  error,
  disabled = false,
}: MaterialUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const meta: MaterialMeta = {
      materialId: `MAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      status: "UPLOADED",
    };
    onChange(meta);
  };

  return (
    <div className={`form-group ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? (
          <span className="material-required" aria-hidden="true"> *（必填）</span>
        ) : (
          <span className="material-optional">（可选）</span>
        )}
      </label>
      {hint && <div id={hintId} className="hint">{hint}</div>}
      <div
        className={`material-upload ${value ? "has-file" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={value ? `已上传 ${value.fileName}，点击重新上传` : `点击上传 ${label}`}
        aria-describedby={describedBy || undefined}
      >
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          onChange={(e) => handleFile(e.target.files?.[0])}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
        {value ? (
          <div>
            <div style={{ fontWeight: 600 }}>
              <span aria-hidden="true">📄</span> {value.fileName}
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {(value.sizeBytes / 1024).toFixed(1)} KB · {value.mimeType}
            </div>
            {!disabled && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: "8px", padding: "4px 12px", fontSize: "0.875rem" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                移除文件
              </button>
            )}
          </div>
        ) : (
          <div style={{ color: "var(--color-text-muted)" }}>
            <span aria-hidden="true" style={{ fontSize: "2rem" }}>📁</span>
            <div>点击或拖拽文件到此处上传</div>
            <div style={{ fontSize: "0.8125rem" }}>支持 PDF, JPG, PNG, DOC</div>
          </div>
        )}
      </div>
      {error && (
        <div id={errorId} className="error-message" role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}
    </div>
  );
}

export function LiveRegion({ message, politeness = "polite" }: { message: string; politeness?: "polite" | "assertive" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && message) {
      ref.current.textContent = "";
      requestAnimationFrame(() => {
        if (ref.current) ref.current.textContent = message;
      });
    }
  }, [message]);
  return (
    <div
      ref={ref}
      aria-live={politeness}
      aria-atomic="true"
      className="live-region"
      role="status"
    />
  );
}

export function StatusBadge({ state }: { state: string }) {
  const labels: Record<string, { text: string; icon: string }> = {
    DRAFT: { text: "草稿", icon: "📝" },
    SUBMITTED: { text: "已提交", icon: "📤" },
    NEEDS_CORRECTION: { text: "需要补正", icon: "🔄" },
    RESUBMITTED: { text: "已重新提交", icon: "📤" },
    ACCEPTED: { text: "已受理", icon: "✅" },
    DECLINED: { text: "已拒绝", icon: "❌" },
  };
  const info = labels[state] || { text: state, icon: "•" };
  return (
    <span className={`status-badge status-${state}`}>
      <span className="status-icon" aria-hidden="true">{info.icon}</span>
      <span>{info.text}</span>
    </span>
  );
}
