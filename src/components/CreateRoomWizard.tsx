import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Coins,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { QuestionBankItem, RoomSnapshotHost } from '../types/auction.ts';
import { apiHostCreateRoom } from '../lib/api.ts';
import { syncRoomToFirestore } from '../lib/firestoreSync.ts';
import { ItemFormModal, type ItemDraft } from './ItemFormModal.tsx';
import { TechImage } from './TechImage.tsx';

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const STEPS = [
  { num: 1, label: 'Room Details' },
  { num: 2, label: 'Coin Settings' },
  { num: 3, label: 'Auction Settings' },
  { num: 4, label: 'Question Settings' },
  { num: 5, label: 'Auction Items' },
  { num: 6, label: 'Review & Create' },
];

interface CreateRoomWizardProps {
  idToken: string;
  questionBank: QuestionBankItem[];
  onCreated: (snap: RoomSnapshotHost) => void;
}

export function CreateRoomWizard({ idToken, questionBank, onCreated }: CreateRoomWizardProps) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [name, setName] = useState('TECHITHON Round 1 Arena');
  const [eventName, setEventName] = useState('TECHITHON – THE ULTIMATE TECH CHALLENGE');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState(() => randomCode());
  const [maxTeams, setMaxTeams] = useState(30);
  const [pin, setPin] = useState('');

  // Step 2
  const [startingCoins, setStartingCoins] = useState(100);
  const [minBid, setMinBid] = useState(5);
  const [minBidIncrement, setMinBidIncrement] = useState(5);
  const [deductWinningBid, setDeductWinningBid] = useState(false);
  const [allowManualCoinAdjust, setAllowManualCoinAdjust] = useState(true);

  // Step 3
  const [auctionDurationSec, setAuctionDurationSec] = useState(30);
  const [maxAuctionDurationSec, setMaxAuctionDurationSec] = useState(120);
  const [startingBidDefault, setStartingBidDefault] = useState(10);
  const [allowMultipleBids, setAllowMultipleBids] = useState(true);
  const [allowRebidAfterOutbid, setAllowRebidAfterOutbid] = useState(true);
  const [autoCloseOnExpire, setAutoCloseOnExpire] = useState(true);

  // Step 4
  const [answerDurationSec, setAnswerDurationSec] = useState(20);
  const [correctPoints, setCorrectPoints] = useState(10);
  const [incorrectDeduction, setIncorrectDeduction] = useState(10);
  const [unansweredCountsIncorrect, setUnansweredCountsIncorrect] = useState(true);
  const [allowHostOverride, setAllowHostOverride] = useState(true);

  // Step 5
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);

  const handleSaveItem = (draft: ItemDraft) => {
    if (editingIdx !== null) {
      setItems((prev) => prev.map((it, idx) => (idx === editingIdx ? draft : it)));
    } else {
      setItems((prev) => [...prev, draft]);
    }
    setEditingIdx(null);
  };

  const addFromBank = (bankItem: QuestionBankItem) => {
    setItems((prev) => [
      ...prev,
      {
        bankItemId: bankItem.id,
        name: bankItem.name,
        imageUrl: bankItem.imageUrl,
        emoji: bankItem.emoji,
        category: bankItem.category,
        description: bankItem.description,
        startingBid: bankItem.startingBid,
        difficulty: bankItem.difficulty,
        question: bankItem.question,
        correctAnswer: bankItem.correctAnswer,
        explanation: bankItem.explanation,
        timeLimitOverrideSec: bankItem.timeLimitOverrideSec,
        hostNotes: bankItem.hostNotes,
      },
    ]);
  };

  const handleCreate = async (status: 'DRAFT' | 'READY') => {
    if (!name.trim()) {
      setStep(1);
      setError('Room name is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const snap = await apiHostCreateRoom(idToken, {
        name: name.trim(),
        eventName: eventName.trim() || 'TECHITHON – THE ULTIMATE TECH CHALLENGE',
        description: description.trim(),
        code: code.trim().toUpperCase(),
        pin: pin.trim(),
        maxTeams,
        startingCoins,
        minBid,
        minBidIncrement,
        deductWinningBid,
        allowManualCoinAdjust,
        auctionDurationSec,
        maxAuctionDurationSec,
        startingBidDefault,
        allowMultipleBids,
        allowRebidAfterOutbid,
        autoCloseOnExpire,
        answerDurationSec,
        correctPoints,
        incorrectDeduction,
        unansweredCountsIncorrect,
        allowHostOverride,
        status,
        items,
      });
      void syncRoomToFirestore(snap.room);
      onCreated(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-[#EEF5FF]">Create New Auction Room</h2>
          <p className="text-sm text-[#9BB0CA]">
            Guided 6-step setup with sensible defaults. Skip optional fields anytime.
          </p>
        </div>
        <span className="text-xs font-mono-num text-[#51D6E8]">
          Step {step} of {STEPS.length}
        </span>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {STEPS.map((s) => {
          const active = step === s.num;
          const done = step > s.num;
          return (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num)}
              className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                active
                  ? 'bg-[#172740] border-[#51D6E8] text-[#EEF5FF]'
                  : done
                    ? 'bg-[#111E31] border-[#B9F36B]/30 text-[#B9F36B]'
                    : 'bg-[#111E31] border-white/10 text-[#9BB0CA] hover:text-[#EEF5FF]'
              }`}
            >
              <div className="text-xs font-mono-num opacity-80">0{s.num}</div>
              <div className="text-xs font-semibold truncate mt-0.5">{s.label}</div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-sm text-[#FF6B78]">
          {error}
        </div>
      )}

      {/* Main Step Card */}
      <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-6">
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 1: Room Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Room Name <span className="text-[#FF6B78]">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Main Auditorium Finals"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Event Name</label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                Room Description (Optional)
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief instructions or round overview for your event..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-sm focus:outline-none focus:border-[#51D6E8]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Unique Room Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                    maxLength={16}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-sm focus:outline-none focus:border-[#51D6E8]"
                  />
                  <button
                    type="button"
                    onClick={() => setCode(randomCode())}
                    title="Generate new code"
                    className="px-3 rounded-xl bg-[#172740] border border-white/10 text-[#9BB0CA] hover:text-[#EEF5FF]"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Maximum Team Capacity</label>
                <input
                  type="number"
                  min={2}
                  max={200}
                  value={maxTeams}
                  onChange={(e) => setMaxTeams(Math.max(2, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Access PIN (Optional)
                </label>
                <input
                  type="text"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Leave blank for open join"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 2: Coin Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Starting Coins per Team
                </label>
                <input
                  type="number"
                  min={10}
                  max={100000}
                  value={startingCoins}
                  onChange={(e) => setStartingCoins(Math.max(10, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-sm focus:outline-none focus:border-[#51D6E8]"
                />
                <p className="text-xs text-[#9BB0CA] mt-1">Default: 100 coins</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Minimum Bid</label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={minBid}
                  onChange={(e) => setMinBid(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Minimum Bid Increment
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={minBidIncrement}
                  onChange={(e) => setMinBidIncrement(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deductWinningBid}
                  onChange={(e) => setDeductWinningBid(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Deduct Winning Bid from Coins</span>
                  <span className="text-xs text-[#9BB0CA]">
                    Default is OFF (coins are only deducted for wrong answers).
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowManualCoinAdjust}
                  onChange={(e) => setAllowManualCoinAdjust(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Allow Manual Coin Adjustment</span>
                  <span className="text-xs text-[#9BB0CA]">
                    Lets the host grant bonus coins or adjust balances during the event.
                  </span>
                </div>
              </label>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 3: Auction Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Auction Duration (Seconds)
                </label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={auctionDurationSec}
                  onChange={(e) => setAuctionDurationSec(Math.max(5, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-sm focus:outline-none focus:border-[#51D6E8]"
                />
                <p className="text-xs text-[#9BB0CA] mt-1">Default: 30 seconds</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Max Auction Duration (Seconds)
                </label>
                <input
                  type="number"
                  min={10}
                  max={900}
                  value={maxAuctionDurationSec}
                  onChange={(e) => setMaxAuctionDurationSec(Math.max(10, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Default Starting Bid</label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={startingBidDefault}
                  onChange={(e) => setStartingBidDefault(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-sm focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowMultipleBids}
                  onChange={(e) => setAllowMultipleBids(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Allow Multiple Bids</span>
                  <span className="text-xs text-[#9BB0CA]">Teams can participate in multiple rounds per item.</span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowRebidAfterOutbid}
                  onChange={(e) => setAllowRebidAfterOutbid(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Rebid After Outbid</span>
                  <span className="text-xs text-[#9BB0CA]">Allow a team to bid again if another team outbids them.</span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCloseOnExpire}
                  onChange={(e) => setAutoCloseOnExpire(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Auto-Close on Expiry</span>
                  <span className="text-xs text-[#9BB0CA]">Automatically lock bidding when the countdown hits 0s.</span>
                </div>
              </label>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 4: Question & Scoring Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Answering Duration (Seconds)
                </label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={answerDurationSec}
                  onChange={(e) => setAnswerDurationSec(Math.max(5, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-sm focus:outline-none focus:border-[#51D6E8]"
                />
                <p className="text-xs text-[#9BB0CA] mt-1">Default: 20 seconds</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Correct Answer Points
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={correctPoints}
                  onChange={(e) => setCorrectPoints(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#B9F36B] font-mono-num font-bold text-sm focus:outline-none focus:border-[#B9F36B]"
                />
                <p className="text-xs text-[#9BB0CA] mt-1">Default: +10 points</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Incorrect Answer Deduction (Coins)
                </label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={incorrectDeduction}
                  onChange={(e) => setIncorrectDeduction(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-[#FF6B78] font-mono-num font-bold text-sm focus:outline-none focus:border-[#FF6B78]"
                />
                <p className="text-xs text-[#9BB0CA] mt-1">Default: -10 coins</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={unansweredCountsIncorrect}
                  onChange={(e) => setUnansweredCountsIncorrect(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">
                    Unanswered Counts as Incorrect
                  </span>
                  <span className="text-xs text-[#9BB0CA]">
                    Deducts penalty coins if a winning team runs out of time without answering.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowHostOverride}
                  onChange={(e) => setAllowHostOverride(e.target.checked)}
                  className="mt-1 accent-[#51D6E8]"
                />
                <div>
                  <span className="text-sm font-medium text-[#EEF5FF] block">Allow Host Judgment Override</span>
                  <span className="text-xs text-[#9BB0CA]">
                    Host always has final authority to mark correct or incorrect after timeout.
                  </span>
                </div>
              </label>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 5: Add Auction Items</h3>
                <p className="text-xs text-[#9BB0CA]">
                  Create your own custom technology objects and questions, or pull from your Question Bank.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setBankPickerOpen(!bankPickerOpen)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#172740] border border-white/15 text-sm font-medium text-[#EEF5FF] hover:border-[#51D6E8]/60 whitespace-nowrap"
                >
                  <BookOpen className="w-4 h-4 text-[#51D6E8]" />
                  From Question Bank
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingIdx(null);
                    setItemModalOpen(true);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm hover:opacity-90 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />+ ADD NEW ITEM
                </button>
              </div>
            </div>

            {bankPickerOpen && (
              <div className="p-4 rounded-xl bg-[#08111F] border border-[#51D6E8]/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#51D6E8]">
                    Select items from Question Bank ({questionBank.length} available)
                  </span>
                  <button
                    type="button"
                    onClick={() => setBankPickerOpen(false)}
                    className="text-xs text-[#9BB0CA] hover:text-[#EEF5FF]"
                  >
                    Done
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                  {questionBank.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => addFromBank(b)}
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#111E31] border border-white/10 hover:border-[#51D6E8]/50 text-left"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[#EEF5FF] truncate">
                          {b.emoji} {b.name}
                        </div>
                        <div className="text-xs text-[#9BB0CA] truncate">
                          {b.category} · {b.difficulty} · {b.startingBid} coins
                        </div>
                      </div>
                      <Plus className="w-4 h-4 text-[#B9F36B] shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 bg-[#08111F]/60 text-center space-y-3">
                <Sparkles className="w-8 h-8 text-[#51D6E8] mx-auto opacity-80" />
                <p className="text-sm font-medium text-[#EEF5FF]">No items added to this room yet</p>
                <p className="text-xs text-[#9BB0CA]">
                  Click <strong>+ ADD NEW ITEM</strong> to create a custom tech object & question, or add from your bank. You can also add more items later.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((it, idx) => (
                  <div
                    key={`${it.name}-${idx}`}
                    className="flex items-center gap-4 p-3.5 rounded-xl bg-[#08111F] border border-white/10"
                  >
                    <TechImage
                      imageUrl={it.imageUrl}
                      emoji={it.emoji}
                      name={it.name}
                      className="w-16 h-12 rounded-lg shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono-num text-[#51D6E8]">#{idx + 1}</span>
                        <h4 className="text-sm font-semibold text-[#EEF5FF] truncate">{it.name}</h4>
                      </div>
                      <p className="text-xs text-[#9BB0CA] truncate">
                        {it.category} · {it.difficulty} · Start {it.startingBid} coins
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIdx(idx);
                          setItemModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#172740] text-xs font-medium text-[#EEF5FF] hover:text-[#51D6E8]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg text-[#9BB0CA] hover:text-[#FF6B78]"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold text-[#EEF5FF]">Step 6: Review & Create</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Room Name</p>
                <p className="text-sm font-semibold text-[#EEF5FF] mt-1 truncate">{name}</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Room Code</p>
                <p className="text-sm font-bold font-mono-num text-[#51D6E8] mt-1">{code}</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Starting Coins</p>
                <p className="text-sm font-bold font-mono-num text-[#EEF5FF] mt-1">{startingCoins} coins</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Team Capacity</p>
                <p className="text-sm font-bold font-mono-num text-[#EEF5FF] mt-1">{maxTeams} teams</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Auction Timer</p>
                <p className="text-sm font-bold font-mono-num text-[#EEF5FF] mt-1">{auctionDurationSec}s</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Answer Timer</p>
                <p className="text-sm font-bold font-mono-num text-[#EEF5FF] mt-1">{answerDurationSec}s</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Correct Points</p>
                <p className="text-sm font-bold font-mono-num text-[#B9F36B] mt-1">+{correctPoints} pts</p>
              </div>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10">
                <p className="text-xs text-[#9BB0CA]">Wrong Penalty</p>
                <p className="text-sm font-bold font-mono-num text-[#FF6B78] mt-1">-{incorrectDeduction} coins</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#172740]/50 border border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-[#EEF5FF]">
                <Coins className="w-4 h-4 text-[#51D6E8]" />
                <span>
                  <strong>{items.length}</strong> auction item{items.length === 1 ? '' : 's'} queued ·{' '}
                  {pin.trim() ? 'PIN protected' : 'Open join with room code'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="text-xs font-medium text-[#51D6E8] hover:underline"
              >
                Edit Items
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreate('DRAFT')}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-white/15 bg-[#172740] text-sm font-semibold text-[#EEF5FF] hover:bg-white/10 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                SAVE AS DRAFT
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleCreate('READY')}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#B9F36B] text-[#08111F] text-sm font-bold hover:opacity-90 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                {submitting ? 'Creating Room...' : 'CREATE ROOM'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-[#9BB0CA] hover:text-[#EEF5FF] disabled:opacity-40"
        >
          <ArrowLeft className="w-4 h-4" />
          Previous
        </button>
        {step < 6 && (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(6, s + 1))}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] text-sm font-semibold hover:opacity-90"
          >
            Next Step
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <ItemFormModal
        open={itemModalOpen}
        initialItem={editingIdx !== null ? items[editingIdx] : null}
        defaultStartingBid={startingBidDefault}
        title={editingIdx !== null ? 'Edit Auction Item' : 'Add Custom Auction Item'}
        onSave={handleSaveItem}
        onClose={() => {
          setItemModalOpen(false);
          setEditingIdx(null);
        }}
      />
    </div>
  );
}
