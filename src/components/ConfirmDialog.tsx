import React from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-md border border-[#E3D2B4] bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 id="confirm-dialog-title" className="text-base font-semibold text-[#165B33]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-[#6B5A4C] hover:bg-[#FAF3E3] hover:text-[#241710]"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2.5 text-sm text-[#241710] leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded border border-[#E3D2B4] bg-white px-4 py-2 text-sm font-medium text-[#241710] hover:bg-[#FAF3E3] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 whitespace-nowrap shrink-0 ${
              variant === 'danger'
                ? 'bg-[#B42318] hover:bg-[#911b12]'
                : 'bg-[#165B33] hover:bg-[#104526]'
            }`}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
