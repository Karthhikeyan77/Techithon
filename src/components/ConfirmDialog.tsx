import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmCls =
    variant === 'danger'
      ? 'bg-[#FF6B78] text-[#08111F] hover:opacity-90'
      : 'bg-[#FFC857] text-[#08111F] hover:opacity-90';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${variant === 'danger' ? 'bg-[#FF6B78]/15 text-[#FF6B78]' : 'bg-[#FFC857]/15 text-[#FFC857]'}`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-[#EEF5FF]">
              {title}
            </h3>
            <p className="text-sm text-[#9BB0CA] leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl border border-white/10 text-sm font-medium text-[#EEF5FF] hover:bg-white/5 transition-colors whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50 whitespace-nowrap ${confirmCls}`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
