import React, { useEffect, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { ItemDifficulty } from '../types/auction.ts';
import { TechImage } from './TechImage.tsx';

export interface ItemDraft {
  id?: string;
  bankItemId?: string | null;
  name: string;
  imageUrl: string;
  emoji: string;
  category: string;
  description: string;
  startingBid: number;
  difficulty: ItemDifficulty;
  question: string;
  correctAnswer: string;
  explanation: string;
  timeLimitOverrideSec: number | null;
  hostNotes: string;
}

const PRESET_IMAGES = [
  { label: 'Raspberry Pi', url: '/src/assets/images/tech_raspberry_pi_1795603755543.jpg' },
  { label: 'Arduino Uno', url: '/src/assets/images/tech_arduino_uno_1795603756456.jpg' },
  { label: 'GPU Card', url: '/src/assets/images/tech_gpu_graphics_1795603756319.jpg' },
  { label: 'CPU Chip', url: '/src/assets/images/tech_cpu_processor_1795603757284.jpg' },
  { label: 'Cloud & IoT', url: '/src/assets/images/tech_cloud_iot_1795603756726.jpg' },
];

const EMOJI_CHOICES = ['⚡', '🍓', '🔌', '🧠', '🎮', '📡', '📱', '⌨️', '💾', '📶', '🎧', '💿', '🤖', '☁️', '🔬', '🛰️'];

interface ItemFormModalProps {
  open: boolean;
  initialItem?: Partial<ItemDraft> | null;
  defaultStartingBid?: number;
  title?: string;
  onSave: (item: ItemDraft) => Promise<void> | void;
  onClose: () => void;
}

export function ItemFormModal({
  open,
  initialItem,
  defaultStartingBid = 10,
  title = 'Add Auction Item & Question',
  onSave,
  onClose,
}: ItemFormModalProps) {
  const [form, setForm] = useState<ItemDraft>({
    name: '',
    imageUrl: '',
    emoji: '⚡',
    category: 'Embedded Systems',
    description: '',
    startingBid: defaultStartingBid,
    difficulty: 'Medium',
    question: '',
    correctAnswer: '',
    explanation: '',
    timeLimitOverrideSec: null,
    hostNotes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      id: initialItem?.id,
      bankItemId: initialItem?.bankItemId ?? null,
      name: initialItem?.name || '',
      imageUrl: initialItem?.imageUrl || '',
      emoji: initialItem?.emoji || '⚡',
      category: initialItem?.category || 'Embedded Systems',
      description: initialItem?.description || '',
      startingBid: initialItem?.startingBid ?? defaultStartingBid,
      difficulty: initialItem?.difficulty || 'Medium',
      question: initialItem?.question || '',
      correctAnswer: initialItem?.correctAnswer || '',
      explanation: initialItem?.explanation || '',
      timeLimitOverrideSec: initialItem?.timeLimitOverrideSec ?? null,
      hostNotes: initialItem?.hostNotes || '',
    });
  }, [open, initialItem, defaultStartingBid]);

  if (!open) return null;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 800;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.8);
        setForm((prev) => ({ ...prev, imageUrl: compressed }));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.description.trim() || !form.question.trim() || !form.correctAnswer.trim()) {
      setError('Please fill in Item Name, Description, Technical Question, and Correct Answer.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        category: form.category.trim() || 'Technology',
        description: form.description.trim(),
        question: form.question.trim(),
        correctAnswer: form.correctAnswer.trim(),
        explanation: form.explanation.trim(),
        hostNotes: form.hostNotes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl bg-[#111E31] border border-white/10 rounded-2xl shadow-2xl my-8 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#172740]/60">
          <h3 className="text-lg font-semibold text-[#EEF5FF]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9BB0CA] hover:text-[#EEF5FF] hover:bg-white/5"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-sm text-[#FF6B78]">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="md:col-span-2 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Item Name <span className="text-[#FF6B78]">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Raspberry Pi 5"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Category</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Embedded Systems"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Difficulty</label>
                  <select
                    value={form.difficulty}
                    onChange={(e) => setForm({ ...form, difficulty: e.target.value as ItemDifficulty })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Starting Bid (Coins)</label>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={form.startingBid}
                    onChange={(e) => setForm({ ...form, startingBid: Math.max(0, Number(e.target.value)) })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm font-mono-num focus:outline-none focus:border-[#51D6E8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                    Answer Timer Override (sec, optional)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={form.timeLimitOverrideSec ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        timeLimitOverrideSec: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="Use room default"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm font-mono-num focus:outline-none focus:border-[#51D6E8]"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-medium text-[#9BB0CA]">Visual Preview</label>
              <TechImage
                imageUrl={form.imageUrl}
                emoji={form.emoji}
                name={form.name || 'Tech Object'}
                category={form.category}
                className="w-full aspect-[4/3] rounded-xl border border-white/10"
              />
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#172740] border border-white/10 text-xs font-medium text-[#EEF5FF] hover:border-[#51D6E8]/50 transition-colors">
                  <Upload className="w-3.5 h-3.5 text-[#51D6E8]" />
                  Upload Photo
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                {form.imageUrl && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, imageUrl: '' })}
                    className="px-2.5 py-2 rounded-xl border border-white/10 text-xs text-[#9BB0CA] hover:text-[#FF6B78]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Image URL or Hardware Preset</label>
              <input
                type="text"
                value={form.imageUrl.startsWith('data:') ? '' : form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://... or choose preset below"
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-xs focus:outline-none focus:border-[#51D6E8]"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {PRESET_IMAGES.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setForm({ ...form, imageUrl: p.url })}
                    className={`px-2 py-1 rounded-lg text-xs border transition-colors ${
                      form.imageUrl === p.url
                        ? 'bg-[#51D6E8]/20 border-[#51D6E8] text-[#51D6E8]'
                        : 'bg-[#08111F] border-white/10 text-[#9BB0CA] hover:text-[#EEF5FF]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Icon / Emoji</label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_CHOICES.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setForm({ ...form, emoji: em })}
                    className={`w-9 h-9 rounded-lg border text-base flex items-center justify-center transition-colors ${
                      form.emoji === em
                        ? 'bg-[#51D6E8]/20 border-[#51D6E8]'
                        : 'bg-[#08111F] border-white/10 hover:border-white/25'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
              Short Description <span className="text-[#FF6B78]">*</span>
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="A small single-board computer used for programming and electronics projects."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
            />
          </div>

          <div className="border-t border-white/10 pt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#51D6E8] mb-1.5">
                Related Technical Question <span className="text-[#FF6B78]">*</span>
              </label>
              <textarea
                rows={2}
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="Do the standard Raspberry Pi GPIO pins provide native analog input?"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#B9F36B] mb-1.5">
                Correct Answer Key (Visible Only to Host) <span className="text-[#FF6B78]">*</span>
              </label>
              <textarea
                rows={2}
                value={form.correctAnswer}
                onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                placeholder="No. An external ADC is required for analog input."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#B9F36B]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Answer Explanation (Shown After Scoring)
                </label>
                <textarea
                  rows={2}
                  value={form.explanation}
                  onChange={(e) => setForm({ ...form, explanation: e.target.value })}
                  placeholder="Standard GPIO pins are digital; an external ADC converts analog signals."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Optional Host Notes (Private)
                </label>
                <textarea
                  rows={2}
                  value={form.hostNotes}
                  onChange={(e) => setForm({ ...form, hostNotes: e.target.value })}
                  placeholder="Judging hints or acceptable partial answers..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-[#9BB0CA] hover:text-[#EEF5FF]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-semibold text-sm hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
