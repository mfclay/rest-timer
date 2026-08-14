import { SignInWithGoogle, signOut, useAuth, useMutation, useQuery } from "lakebed/client";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { LiveSet, Session, TimerMode, UserSettings } from "../shared/types";
import { DEFAULT_QUICK_WEIGHTS, DEFAULT_SETTINGS, fmtTime, fmtTimeLong, parseTimeStr } from "../shared/utils";

// ─── Audio ────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
function beep(freq = 880, duration = 0.18, volume = 0.15) {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}
function chimeTarget() { beep(660, 0.15); setTimeout(() => beep(880, 0.2), 160); }
function chimeOver() { beep(440, 0.4, 0.1); }

// ─── Settings helpers ─────────────────────────────────────────────────────────

function mergeSettings(stored: string | null): UserSettings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function defaultQuickWeights(unit: "lb" | "kg"): number[] {
  return [...(DEFAULT_QUICK_WEIGHTS[unit] ?? DEFAULT_QUICK_WEIGHTS.lb)];
}

// ─── Chunk grid ───────────────────────────────────────────────────────────────

type ChunkGridProps = {
  items: (string | number)[];
  activeValue: string | number | null;
  page: number;
  onPage: (delta: number) => void;
  onSelect: (v: string | number) => void;
  onCustom: () => void;
  placeholder?: string;
};

function ChunkGrid({ items, activeValue, page, onPage, onSelect, onCustom, placeholder }: ChunkGridProps) {
  // Fixed height grid so all three zones have identical row heights regardless of content
  const gridCls = "grid grid-cols-2 grid-rows-3 gap-2.5 w-full h-[218px]";

  if (items.length === 0 && placeholder) {
    return (
      <div class={gridCls}>
        <div class="col-span-2 row-span-3 flex flex-col items-center justify-center gap-2 text-[#5DCAA5] opacity-60 text-sm font-medium text-center pointer-events-none">
          <span class="text-3xl leading-none">←</span>
          <span>SELECT EXERCISE</span>
        </div>
      </div>
    );
  }

  const needsPaging = items.length > 5;
  const pageSize = needsPaging ? 4 : 5;
  const totalPages = needsPaging ? Math.ceil(items.length / pageSize) : 1;
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const start = clampedPage * pageSize;
  const visible = items.slice(start, start + pageSize);
  const fillers = pageSize - visible.length;

  const btnBase = "rounded-xl border text-center text-[15px] font-medium flex items-center justify-center leading-snug transition-all duration-150 h-full px-2 py-1 overflow-hidden";

  return (
    <div class={gridCls}>
      {visible.map((item) => (
        <button
          key={item}
          class={`${btnBase} ${
            activeValue === item
              ? "bg-[#2b3247] text-white border-[#3a4360]"
              : "bg-white/[0.04] text-white/60 border-white/[0.08] hover:bg-white/[0.08] hover:text-white hover:border-white/[0.16]"
          }`}
          onClick={() => onSelect(item)}
        >
          {item}
        </button>
      ))}
      {Array.from({ length: fillers }).map((_, i) => (
        <div key={`filler-${i}`} class="h-full" />
      ))}
      {needsPaging ? (
        <div class="flex bg-white/[0.04] border border-white/[0.08] rounded-xl overflow-hidden h-full">
          <button
            class="flex-1 flex items-center justify-center text-white/60 hover:bg-white/[0.08] hover:text-white transition-all disabled:text-white/20 disabled:cursor-default"
            disabled={clampedPage === 0}
            onClick={() => onPage(-1)}
            aria-label="Previous"
          >
            ⌃
          </button>
          <div class="w-px bg-white/[0.08]" />
          <button
            class="flex-1 flex items-center justify-center text-white/60 hover:bg-white/[0.08] hover:text-white transition-all disabled:text-white/20 disabled:cursor-default rotate-180"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => onPage(1)}
            aria-label="Next"
          >
            ⌃
          </button>
        </div>
      ) : null}
      <button
        class="bg-transparent border border-dashed border-white/[0.16] text-white/40 text-sm rounded-xl flex items-center justify-center h-full hover:text-white/60 hover:border-white/40 transition-all"
        onClick={onCustom}
      >
        + Custom
      </button>
    </div>
  );
}

// ─── Session rail ─────────────────────────────────────────────────────────────

function SessionRail({ sets, onEdit }: { sets: LiveSet[]; onEdit: (idx: number) => void }) {
  if (sets.length === 0) return null;
  const recent = sets.slice(-5);
  const lastIdx = recent.length - 1;
  return (
    <div class="absolute left-0 bottom-3 w-[220px] max-w-[22%] flex flex-col justify-end gap-1.5 pointer-events-none z-10">
      {recent.map((s, i) => {
        const isLast = i === lastIdx;
        const dist = lastIdx - i;
        const opacity = Math.max(0.35, 1 - dist * 0.18);
        const main = [s.exercise || "—", s.weight != null ? `${s.weight}` : "—", `× ${s.reps ?? "—"}`].join(" · ");
        const realIdx = sets.length - recent.length + i;
        return (
          <button
            key={i}
            class={`pointer-events-auto text-left font-mono text-xs tracking-[0.3px] px-3 py-2 rounded-lg border transition-all duration-150 flex flex-col gap-[3px] truncate ${
              isLast
                ? "text-white border-white/[0.16] bg-[rgba(20,20,20,0.55)] backdrop-blur"
                : "text-white/40 border-white/[0.08] bg-[rgba(20,20,20,0.55)] backdrop-blur hover:text-white hover:bg-white/[0.08] hover:border-white/[0.16] hover:translate-x-0.5"
            }`}
            style={{ opacity }}
            onClick={() => onEdit(realIdx)}
            title="Click to edit"
          >
            <div class="flex items-baseline gap-2 overflow-hidden text-ellipsis">
              <span class="text-[10px] tracking-[1px] text-white/20 shrink-0">SET {s.setNum}</span>
              <span class="overflow-hidden text-ellipsis text-white/40">{main}</span>
            </div>
            {s.restAfter ? <div class="text-[10px] tracking-[0.5px] text-white/20">rest {fmtTime(s.restAfter)}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function Modal({ show, onClose, children, maxWidth = "560px" }: { show: boolean; onClose?: () => void; children: any; maxWidth?: string }) {
  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [show, onClose]);

  if (!show) return null;
  return (
    <div
      class="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[100]"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
    >
      <div class="bg-[#141414] text-white border border-white/[0.08] rounded-2xl p-8 w-[90%] max-h-[85vh] overflow-y-auto" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div class="flex justify-between items-center mb-6">
      <div class="text-[22px] font-medium">{title}</div>
      {onClose && <button class="text-white/40 text-[13px] font-mono tracking-[1px] hover:text-white" onClick={onClose}>ESC</button>}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div
      class={`w-11 h-6 rounded-full relative cursor-pointer transition-colors duration-200 ${on ? "bg-[#5DCAA5]" : "bg-white/[0.16]"}`}
      onClick={onClick}
    >
      <div class={`absolute w-[18px] h-[18px] bg-white rounded-full top-[3px] transition-all duration-200 ${on ? "left-[23px]" : "left-[3px]"}`} />
    </div>
  );
}

// ─── CustomValueModal ─────────────────────────────────────────────────────────

type CustomValueModalProps = {
  show: boolean;
  type: "weight" | "reps" | null;
  options: number[];
  onConfirm: (v: number) => void;
  onClose: () => void;
};

function CustomValueModal({ show, type, options, onConfirm, onClose }: CustomValueModalProps) {
  const [inputVal, setInputVal] = useState("");
  const [selVal, setSelVal] = useState("");

  useEffect(() => {
    if (show) { setInputVal(""); setSelVal(options[0] != null ? String(options[0]) : ""); }
  }, [show]);

  function confirm() {
    const raw = inputVal.trim() !== "" ? inputVal : selVal;
    const v = parseFloat(raw);
    if (!isNaN(v)) onConfirm(v);
  }

  return (
    <Modal show={show} onClose={onClose} maxWidth="360px">
      <ModalHeader title={type === "weight" ? "Custom weight" : "Custom reps"} onClose={onClose} />
      <select
        class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none appearance-none cursor-pointer mb-2"
        value={selVal}
        onChange={(e) => { setSelVal((e.target as HTMLSelectElement).value); setInputVal(""); }}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <div class="text-center text-white/20 text-[11px] tracking-[2px] uppercase font-mono my-0.5">or</div>
      <input
        class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none focus:border-[#5B8DEF]"
        type="number"
        placeholder="Enter new value…"
        value={inputVal}
        onInput={(e) => { setInputVal((e.target as HTMLInputElement).value); setSelVal(""); }}
        onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
      />
      <div class="flex gap-2.5 justify-end mt-6">
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={onClose}>Cancel</button>
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/85" onClick={confirm}>Use</button>
      </div>
    </Modal>
  );
}

// ─── CustomExerciseModal ───────────────────────────────────────────────────────

function CustomExerciseModal({ show, onConfirm, onClose }: { show: boolean; onConfirm: (name: string) => void; onClose: () => void }) {
  const [val, setVal] = useState("");
  useEffect(() => { if (show) setVal(""); }, [show]);
  function confirm() { if (val.trim()) onConfirm(val.trim()); }
  return (
    <Modal show={show} onClose={onClose} maxWidth="400px">
      <ModalHeader title="Custom exercise" />
      <input
        class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none focus:border-[#5B8DEF]"
        placeholder="Exercise name"
        value={val}
        onInput={(e) => setVal((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
        autoFocus
      />
      <div class="flex gap-2.5 justify-end mt-6">
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={onClose}>Cancel</button>
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/85" onClick={confirm}>Use</button>
      </div>
    </Modal>
  );
}

// ─── EditSetModal ─────────────────────────────────────────────────────────────

type EditSetModalProps = {
  show: boolean;
  set: LiveSet | null;
  settings: UserSettings;
  onSave: (patch: Pick<LiveSet, "exercise" | "weight" | "reps">) => void;
  onClose: () => void;
};

function EditSetModal({ show, set, settings, onSave, onClose }: EditSetModalProps) {
  const exercises = Object.keys(settings.targets);
  const [exercise, setExercise] = useState("");
  const [customEx, setCustomEx] = useState("");
  const [showCustomEx, setShowCustomEx] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  useEffect(() => {
    if (!set || !show) return;
    const ex = set.exercise ?? "";
    const isKnown = exercises.includes(ex);
    setExercise(isKnown ? ex : "__custom__");
    setCustomEx(isKnown ? "" : ex);
    setShowCustomEx(!isKnown);
    setWeight(set.weight != null ? String(set.weight) : "");
    setReps(set.reps != null ? String(set.reps) : "");
  }, [show, set]);

  function onExerciseChange(val: string) {
    setExercise(val);
    setShowCustomEx(val === "__custom__");
    if (val !== "__custom__") {
      const weights = settings.quickWeights[val] ?? [];
      setWeight(weights[0] != null ? String(weights[0]) : "");
    }
  }

  function save() {
    const ex = exercise === "__custom__" ? customEx.trim() : exercise;
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    onSave({ exercise: ex || null, weight: isNaN(w) ? null : w, reps: isNaN(r) ? null : r });
  }

  const weights = [...(settings.quickWeights[exercise] ?? [])];
  const repsOptions = [...settings.quickReps];

  return (
    <Modal show={show} onClose={onClose} maxWidth="460px">
      <ModalHeader title="Edit set" onClose={onClose} />
      <div class="mb-6">
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Exercise</div>
        <select
          class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none appearance-none cursor-pointer"
          value={exercise}
          onChange={(e) => onExerciseChange((e.target as HTMLSelectElement).value)}
        >
          {exercises.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
        {showCustomEx && (
          <input
            class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none focus:border-[#5B8DEF] mt-2"
            placeholder="Exercise name"
            value={customEx}
            onInput={(e) => setCustomEx((e.target as HTMLInputElement).value)}
          />
        )}
      </div>
      <div class="grid grid-cols-2 gap-3.5 mb-6">
        <div>
          <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Weight</div>
          <select
            class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none appearance-none cursor-pointer"
            value={weight}
            onChange={(e) => setWeight((e.target as HTMLSelectElement).value)}
          >
            {weights.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Reps</div>
          <select
            class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none appearance-none cursor-pointer"
            value={reps}
            onChange={(e) => setReps((e.target as HTMLSelectElement).value)}
          >
            {repsOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div class="flex gap-2.5 justify-end">
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={onClose}>Cancel</button>
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/85" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

// ─── SettingsModal ─────────────────────────────────────────────────────────────

type SettingsModalProps = {
  show: boolean;
  settings: UserSettings;
  onSave: (s: UserSettings) => void;
  onClose: () => void;
};

function SettingsModal({ show, settings, onSave, onClose }: SettingsModalProps) {
  const [s, setS] = useState<UserSettings>(settings);
  const [newName, setNewName] = useState("");
  const [newTarget, setNewTarget] = useState("");

  useEffect(() => { if (show) setS({ ...settings }); }, [show]);

  function update(patch: Partial<UserSettings>) {
    const next = { ...s, ...patch };
    setS(next);
    onSave(next);
  }

  function addExercise() {
    const name = newName.trim();
    if (!name) return;
    const sec = parseTimeStr(newTarget || "3:00") || 180;
    const next = {
      ...s,
      targets: { ...s.targets, [name]: sec },
      quickWeights: { ...s.quickWeights, [name]: defaultQuickWeights(s.unit) },
    };
    setS(next);
    onSave(next);
    setNewName("");
    setNewTarget("");
  }

  function deleteExercise(name: string) {
    const targets = { ...s.targets };
    const quickWeights = { ...s.quickWeights };
    delete targets[name];
    delete quickWeights[name];
    const next = { ...s, targets, quickWeights };
    setS(next);
    onSave(next);
  }

  function updateTarget(name: string, val: string) {
    const sec = parseTimeStr(val);
    if (!isNaN(sec) && sec > 0) update({ targets: { ...s.targets, [name]: sec } });
  }

  function toggleGlobalRest() {
    if (s.globalRest !== null) {
      update({ globalRest: null });
    } else {
      update({ globalRest: 60 });
    }
  }

  function exportCSV(history: Session[]) {
    const rows = [["session_start","session_name","session_notes","set_num","exercise","weight","reps","lift_duration_s","rest_after_s"]];
    history.forEach((sess) => {
      sess.sets.forEach((set) => {
        rows.push([
          new Date(sess.startTime).toISOString(),
          sess.name || "",
          (sess.notes || "").replace(/"/g, '""'),
          String(set.setNum),
          set.exercise || "",
          set.weight != null ? String(set.weight) : "",
          set.reps != null ? String(set.reps) : "",
          String(set.liftDuration || ""),
          set.restAfter != null ? String(set.restAfter) : "",
        ]);
      });
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    downloadBlob(csv, "text/csv", `rest-timer-history-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function exportJSON(history: Session[]) {
    downloadBlob(JSON.stringify(history, null, 2), "application/json", `rest-timer-history-${new Date().toISOString().slice(0, 10)}.json`);
  }

  function downloadBlob(content: string, type: string, filename: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function resetToDefaults() {
    if (!confirm("Reset all settings to defaults? Your workout history will not be affected.")) return;
    const next = { ...DEFAULT_SETTINGS };
    setS(next);
    onSave(next);
  }

  const dimmed = s.globalRest !== null;

  return (
    <Modal show={show} onClose={onClose}>
      <ModalHeader title="Settings" onClose={onClose} />

      {/* Rest targets */}
      <div class="mb-6">
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Rest targets</div>
        <div class="flex justify-between items-center px-4 py-3.5 border-b border-white/[0.08]">
          <span>Global override</span>
          <div class="flex items-center gap-2.5">
            <input
              class="w-[70px] bg-[#141414] border border-white/[0.16] text-white text-center px-2.5 py-1.5 rounded font-mono text-sm outline-none"
              value={s.globalRest != null ? fmtTime(s.globalRest) : "1:00"}
              onChange={(e) => {
                const sec = parseTimeStr((e.target as HTMLInputElement).value);
                if (!isNaN(sec) && sec > 0 && s.globalRest !== null) update({ globalRest: sec });
              }}
              disabled={s.globalRest === null}
            />
            <Toggle on={s.globalRest !== null} onClick={toggleGlobalRest} />
          </div>
        </div>
        <div class={`bg-white/[0.04] rounded-lg overflow-hidden ${dimmed ? "opacity-35 pointer-events-none" : ""}`}>
          {Object.keys(s.targets).map((name) => (
            <div key={name} class="grid gap-4 px-4 py-3.5 items-center border-b border-white/[0.08] last:border-b-0" style="grid-template-columns:1fr auto auto">
              <span class="text-[15px]">{name}</span>
              <input
                class="w-20 bg-[#141414] border border-white/[0.16] text-white text-center px-2.5 py-1.5 rounded font-mono text-sm outline-none"
                defaultValue={fmtTime(s.targets[name])}
                onBlur={(e) => updateTarget(name, (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateTarget(name, (e.target as HTMLInputElement).value); }}
              />
              <button class="text-white/40 text-xs px-2 py-1 hover:text-[#E15A5A]" onClick={() => deleteExercise(name)}>Remove</button>
            </div>
          ))}
        </div>
        <div class="flex gap-2 px-4 py-3 items-center">
          <input class="flex-1 bg-[#141414] border border-white/[0.16] text-white px-3 py-2 rounded text-sm outline-none focus:border-[#5B8DEF]" placeholder="Exercise name" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") addExercise(); }} />
          <input class="w-20 bg-[#141414] border border-white/[0.16] text-white px-3 py-2 rounded text-sm outline-none focus:border-[#5B8DEF]" placeholder="3:00" value={newTarget} onInput={(e) => setNewTarget((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") addExercise(); }} />
          <button class="bg-white/[0.08] text-white px-3.5 py-2 rounded text-sm hover:bg-white/[0.12]" onClick={addExercise}>Add</button>
        </div>
      </div>

      {/* Preferences */}
      <div class="mb-6">
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Preferences</div>
        <div class="bg-white/[0.04] rounded-lg overflow-hidden">
          <div class="flex justify-between items-center px-4 py-3.5 border-b border-white/[0.08]">
            <span>Sound cues</span>
            <Toggle on={s.sound} onClick={() => update({ sound: !s.sound })} />
          </div>
          <div class="flex justify-between items-center px-4 py-3.5 border-b border-white/[0.08]">
            <span>Keep screen awake</span>
            <Toggle on={s.wake} onClick={() => update({ wake: !s.wake })} />
          </div>
          <div class="flex justify-between items-center px-4 py-3.5">
            <span>Units</span>
            <div class="flex bg-[#141414] rounded p-0.5">
              {(["lb", "kg"] as const).map((u) => (
                <button
                  key={u}
                  class={`px-3.5 py-1 text-sm rounded transition-all ${s.unit === u ? "bg-white text-black font-medium" : "text-white/60"}`}
                  onClick={() => update({ unit: u })}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Data */}
      <div>
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Data</div>
        <ExportButtons onExportCSV={exportCSV} onExportJSON={exportJSON} />
        <button class="w-full mt-2.5 px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-[#E15A5A] hover:bg-white/[0.08]" onClick={resetToDefaults}>
          Reset to defaults
        </button>
      </div>
    </Modal>
  );
}

function ExportButtons({ onExportCSV, onExportJSON }: { onExportCSV: (h: Session[]) => void; onExportJSON: (h: Session[]) => void }) {
  const sessions = useQuery<Session[]>("sessions") ?? [];
  return (
    <div class="flex gap-2.5">
      <button class="flex-1 px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={() => onExportCSV(sessions)}>Export CSV</button>
      <button class="flex-1 px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={() => onExportJSON(sessions)}>Export JSON</button>
    </div>
  );
}

// ─── HistoryModal ─────────────────────────────────────────────────────────────

function plural(n: number, word: string) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

// A saved session and the in-progress one, normalized so the list and the
// detail view can treat "today, still going" like any other workout.
type ViewSession = {
  key: string;
  active: boolean;
  name: string;
  notes: string;
  startTime: number;
  duration: number;
  sets: LiveSet[];
};

type DayFilter = { day: number; month: number; year: number };

function sameDay(ts: number, f: DayFilter) {
  const d = new Date(ts);
  return d.getDate() === f.day && d.getMonth() === f.month && d.getFullYear() === f.year;
}

function SessionDetail({ session, onBack }: { session: ViewSession; onBack: () => void }) {
  // Group by exercise, keeping the order each exercise was first performed
  const groups: { name: string; sets: LiveSet[] }[] = [];
  const byName = new Map<string, { name: string; sets: LiveSet[] }>();
  for (const set of session.sets) {
    const name = set.exercise || "—";
    let g = byName.get(name);
    if (!g) { g = { name, sets: [] }; byName.set(name, g); groups.push(g); }
    g.sets.push(set);
  }
  const volOf = (sets: LiveSet[]) => sets.reduce((sum, x) => sum + ((x.weight || 0) * (x.reps || 0)), 0);
  const totalVol = volOf(session.sets);
  const d = new Date(session.startTime);

  return (
    <div>
      <div class="flex items-center gap-3">
        <button class="bg-white/[0.04] text-white/60 px-2.5 py-1 rounded text-xs shrink-0 hover:bg-white/[0.08] hover:text-white" onClick={onBack}>&larr; Back</button>
        <span class="font-medium text-base flex-1">{session.name || "Untitled"}</span>
        <span class="text-white/40 text-[13px] font-mono">{session.active ? "IN PROGRESS" : fmtTimeLong(session.duration)}</span>
      </div>
      <div class="text-white/40 text-xs mt-1.5 mb-4">
        {d.toLocaleDateString("default", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · started {d.toLocaleTimeString("default", { hour: "numeric", minute: "2-digit" })}
      </div>
      <div class="flex flex-col gap-2.5 max-h-[50vh] sm:max-h-[420px] overflow-y-auto">
        {groups.length === 0 ? (
          <div class="text-white/40 text-sm text-center py-10">No sets were logged in this session.</div>
        ) : groups.map((g) => {
          const gVol = volOf(g.sets);
          return (
            <div key={g.name} class="bg-white/[0.04] rounded-lg px-3.5 py-3">
              <div class="flex justify-between items-baseline gap-2.5 mb-1.5">
                <span class="font-medium text-[13px] uppercase tracking-[0.06em]">{g.name}</span>
                <span class="text-white/40 text-xs whitespace-nowrap">{plural(g.sets.length, "set")}{gVol > 0 ? ` · ${gVol.toLocaleString()} lb` : ""}</span>
              </div>
              {g.sets.map((set, i) => (
                <div key={i} class={`flex justify-between items-baseline gap-2.5 py-[5px] text-[13px] font-mono ${i > 0 ? "border-t border-white/[0.04]" : ""}`}>
                  <span>{set.weight != null ? set.weight : "—"} × {set.reps ?? "—"}</span>
                  <span class="text-white/40 text-xs">{set.restAfter ? `rest ${fmtTime(set.restAfter)}` : "—"}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {session.notes ? <div class="text-white/40 text-[13px] italic mt-3.5">"{session.notes}"</div> : null}
      <div class="mt-3 pt-3 border-t border-white/[0.06] text-white/60 text-xs">
        {plural(session.sets.length, "set")} · {plural(groups.length, "exercise")}{totalVol > 0 ? ` · ${totalVol.toLocaleString()} lb total volume` : ""}
      </div>
    </div>
  );
}

function HistoryModal({ show, onClose, mode, sessionStart, liveSets, sessionName, sessionNotes }: {
  show: boolean;
  onClose: () => void;
  mode: TimerMode;
  sessionStart: number | null;
  liveSets: LiveSet[];
  sessionName: string;
  sessionNotes: string;
}) {
  const sessions = useQuery<Session[]>("sessions") ?? [];
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<DayFilter | null>(null);

  // Always reopen on the list, not wherever the last visit left off
  useEffect(() => {
    if (show) { setDetailKey(null); setDayFilter(null); }
  }, [show]);

  function navMonth(delta: number) {
    setDayFilter(null);  // the filter is scoped to a month; don't carry it across
    setCalMonth((m) => {
      let nm = m + delta;
      if (nm < 0) { nm = 11; setCalYear((y) => y - 1); }
      else if (nm > 11) { nm = 0; setCalYear((y) => y + 1); }
      return nm;
    });
  }

  const entries: ViewSession[] = sessions.map((s) => ({
    key: s.id, active: false, name: s.name, notes: s.notes,
    startTime: s.startTime, duration: s.duration, sets: s.sets,
  }));
  if (mode !== "ready" && sessionStart) {
    entries.push({
      key: "current", active: true, name: sessionName, notes: sessionNotes,
      startTime: sessionStart, duration: Math.floor((Date.now() - sessionStart) / 1000), sets: liveSets,
    });
  }

  function openDay(day: number) {
    const filter = { day, month: calMonth, year: calYear };
    const onDay = entries.filter((e) => sameDay(e.startTime, filter));
    if (onDay.length === 1) { setDetailKey(onDay[0].key); return; }
    setDayFilter(filter);
  }

  const monthSessions = sessions.filter((s) => {
    const d = new Date(s.startTime);
    return d.getMonth() === calMonth && d.getFullYear() === calYear;
  });
  const totalSec = monthSessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const workedDays = new Set([
    ...monthSessions.map((s) => new Date(s.startTime).getDate()),
    ...(mode !== "ready" && sessionStart && new Date(sessionStart).getMonth() === calMonth && new Date(sessionStart).getFullYear() === calYear
      ? [new Date(sessionStart).getDate()]
      : []),
  ]);
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long", year: "numeric" });

  // If the session vanished under us (e.g. a refetch), fall through to the list
  const detail = detailKey ? entries.find((e) => e.key === detailKey) : null;

  let sorted = [...sessions].sort((a, b) => b.startTime - a.startTime);
  sorted = dayFilter ? sorted.filter((s) => sameDay(s.startTime, dayFilter)) : sorted.slice(0, 20);
  const showLive = mode !== "ready" && sessionStart && (!dayFilter || sameDay(sessionStart, dayFilter));

  if (detail) {
    return (
      <Modal show={show} onClose={onClose} maxWidth="800px">
        <ModalHeader title="History" onClose={onClose} />
        <SessionDetail session={detail} onBack={() => setDetailKey(null)} />
      </Modal>
    );
  }

  return (
    <Modal show={show} onClose={onClose} maxWidth="800px">
      <ModalHeader title="History" onClose={onClose} />
      {/* stacked on phones — side-by-side clips the session cards below ~600px */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-7">
        {/* Calendar */}
        <div>
          <div class="flex justify-between items-center mb-3.5">
            <div class="font-medium text-base">{monthName}</div>
            <div class="flex gap-1">
              <button class="bg-white/[0.04] text-white/60 px-2 py-1 rounded text-xs hover:bg-white/[0.08] hover:text-white" onClick={() => navMonth(-1)}>&lt;</button>
              <button class="bg-white/[0.04] text-white/60 px-2 py-1 rounded text-xs hover:bg-white/[0.08] hover:text-white" onClick={() => navMonth(1)}>&gt;</button>
            </div>
          </div>
          <div class="grid grid-cols-7 gap-1 text-center">
            {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} class="text-[11px] text-white/40 py-1">{d}</div>)}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} class="py-2 text-[13px] text-white/20" />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
              const worked = workedDays.has(d);
              const selected = dayFilter != null && dayFilter.day === d && dayFilter.month === calMonth && dayFilter.year === calYear;
              return (
                <div
                  key={d}
                  title={worked ? "View this day" : undefined}
                  onClick={worked ? () => openDay(d) : undefined}
                  class={`py-2 text-[13px] rounded ${worked ? "bg-[rgba(93,202,165,0.2)] text-white cursor-pointer hover:bg-[rgba(93,202,165,0.35)]" : "text-white/60"} ${isToday ? "border border-[#5DCAA5]" : ""} ${selected ? "shadow-[inset_0_0_0_1px_#5B8DEF]" : ""}`}
                >
                  {d}
                </div>
              );
            })}
          </div>
          <div class="mt-4 p-3.5 bg-white/[0.04] rounded-lg grid grid-cols-2 gap-2.5">
            <div><div class="text-[22px] font-medium">{monthSessions.length}</div><div class="text-xs text-white/40">sessions</div></div>
            <div><div class="text-[22px] font-medium">{fmtTimeLong(totalSec)}</div><div class="text-xs text-white/40">total time</div></div>
          </div>
        </div>

        {/* Session list */}
        <div>
          {dayFilter ? (
            <div class="flex items-center gap-2 font-medium text-base mb-3.5">
              <button class="bg-white/[0.04] text-white/60 px-2.5 py-1 rounded text-xs shrink-0 hover:bg-white/[0.08] hover:text-white" onClick={() => setDayFilter(null)}>&larr; All</button>
              <span>{new Date(dayFilter.year, dayFilter.month, dayFilter.day).toLocaleDateString("default", { weekday: "long", month: "short", day: "numeric" })}</span>
            </div>
          ) : (
            <div class="font-medium text-base mb-3.5">Recent sessions</div>
          )}
          <div class="flex flex-col gap-2 max-h-[320px] sm:max-h-[480px] overflow-y-auto">
            {showLive ? (
              <div
                title="View sets"
                onClick={() => setDetailKey("current")}
                class="bg-[rgba(93,202,165,0.08)] border border-[rgba(93,202,165,0.3)] p-3.5 rounded-lg cursor-pointer hover:bg-[rgba(93,202,165,0.16)]"
              >
                <div class="flex justify-between mb-1">
                  <span class="font-medium text-sm">{sessionName || "Current session"}</span>
                  <span class="text-white/40 text-xs font-mono">IN PROGRESS</span>
                </div>
                <div class="text-white/60 text-xs">{plural(new Set(liveSets.map((s) => s.exercise)).size, "exercise")} · {plural(liveSets.length, "set")} · {fmtTimeLong(Math.floor((Date.now() - sessionStart!) / 1000))}</div>
              </div>
            ) : null}
            {sorted.length === 0 && !showLive ? (
              <div class="text-white/40 text-sm text-center py-10">{dayFilter ? "No sessions on this day." : "No sessions yet."}</div>
            ) : sorted.map((sess) => {
              const d = new Date(sess.startTime);
              const diffDays = Math.floor((Date.now() - sess.startTime) / (1000 * 60 * 60 * 24));
              const dateStr = diffDays === 0 ? "Today" : diffDays === 1 ? "Yesterday" : diffDays < 7 ? d.toLocaleDateString("default", { weekday: "long" }) : d.toLocaleDateString("default", { month: "short", day: "numeric" });
              const exCount = new Set(sess.sets.map((x) => x.exercise)).size;
              const totalVol = sess.sets.reduce((sum, x) => sum + ((x.weight || 0) * (x.reps || 0)), 0);
              return (
                <div key={sess.id} title="View sets" onClick={() => setDetailKey(sess.id)} class="bg-white/[0.04] p-3.5 rounded-lg cursor-pointer hover:bg-white/[0.08]">
                  <div class="flex justify-between mb-1">
                    <span class="font-medium text-sm">{dateStr} · {sess.name || "Untitled"}</span>
                    <span class="text-white/40 text-xs font-mono">{fmtTimeLong(sess.duration)}</span>
                  </div>
                  <div class="text-white/60 text-xs">{plural(exCount, "exercise")} · {plural(sess.sets.length, "set")}{totalVol > 0 ? ` · ${totalVol.toLocaleString()} lb` : ""}</div>
                  {sess.notes ? <div class="text-white/40 text-xs mt-1.5 italic">"{sess.notes}"</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── NotesModal ────────────────────────────────────────────────────────────────

function NotesModal({ show, value, onChange, onClose }: { show: boolean; value: string; onChange: (v: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (show) setDraft(value); }, [show, value]);
  function save() { onChange(draft); onClose(); }
  return (
    <Modal show={show} onClose={onClose} maxWidth="480px">
      <ModalHeader title="Session notes" onClose={onClose} />
      <textarea
        class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-sm outline-none resize-y min-h-[140px] font-[inherit] focus:border-[#5B8DEF]"
        placeholder="Felt strong today, tweaked left shoulder…"
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save(); }}
        autoFocus
      />
      <div class="flex justify-end mt-6">
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white text-black hover:bg-white/85" onClick={save}>Save</button>
      </div>
    </Modal>
  );
}

// ─── EndSessionModal ───────────────────────────────────────────────────────────

function EndSessionModal({ show, defaultName, defaultNotes, onEnd, onClose }: {
  show: boolean;
  defaultName: string;
  defaultNotes: string;
  onEnd: (name: string, notes: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (show) { setName(defaultName); setNotes(defaultNotes); } }, [show]);
  return (
    <Modal show={show} maxWidth="480px">
      <ModalHeader title="End session" />
      <div class="mb-6">
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Session name</div>
        <input
          class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-[15px] outline-none focus:border-[#5B8DEF]"
          placeholder="Push day"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter") onEnd(name, notes); }}
          autoFocus
        />
      </div>
      <div class="mb-6">
        <div class="font-mono text-[11px] tracking-[2px] text-white/40 uppercase mb-3">Notes (optional)</div>
        <textarea
          class="w-full bg-white/[0.04] border border-white/[0.08] text-white px-3.5 py-3 rounded-lg text-sm outline-none resize-y min-h-[80px] font-[inherit] focus:border-[#5B8DEF]"
          placeholder="How did it feel?"
          value={notes}
          onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        />
      </div>
      <div class="flex gap-2.5 justify-end">
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-white/[0.04] text-white hover:bg-white/[0.08]" onClick={onClose}>Cancel</button>
        <button class="px-5 py-3 rounded-lg text-sm font-medium bg-[rgba(225,90,90,0.15)] text-[#E15A5A] hover:bg-[rgba(225,90,90,0.25)]" onClick={() => onEnd(name, notes)}>End session</button>
      </div>
    </Modal>
  );
}

// ─── Auth header strip ─────────────────────────────────────────────────────────

function AuthStrip() {
  const auth = useAuth();
  if (auth.isLoading) return null;
  if (auth.isGuest) {
    return (
      <div class="flex items-center gap-2 shrink-0">
        <span class="hidden xl:block text-xs text-white/30 font-mono whitespace-nowrap">guest — history lost on refresh</span>
        <SignInWithGoogle className="border border-white/20 px-2.5 py-1 text-xs text-white/50 hover:border-white hover:text-white whitespace-nowrap" />
      </div>
    );
  }
  return (
    <div class="flex items-center gap-2 shrink-0">
      {auth.picture
        ? <img src={auth.picture} alt="" class="w-6 h-6 rounded-full shrink-0" referrerPolicy="no-referrer" />
        : <div class="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] text-white shrink-0">{auth.displayName?.[0]?.toUpperCase()}</div>
      }
      <span class="hidden xl:block text-xs text-white/30 font-mono truncate max-w-[140px]">{auth.displayName}</span>
      <button class="hidden xl:block text-xs text-white/30 font-mono hover:text-white/60 whitespace-nowrap" onClick={() => signOut()}>sign out</button>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────

export function App() {
  const savedSettingsRaw = useQuery<string | null>("userSettings");
  const saveUserSettings = useMutation<[data: string], void>("saveUserSettings");
  const saveSessionMutation = useMutation<[payload: { name: string; notes: string; startTime: number; duration: number; sets: LiveSet[] }], string>("saveSession");
  const sessions = useQuery<Session[]>("sessions") ?? [];

  const [settings, setSettings] = useState<UserSettings>(() => mergeSettings(null));
  useEffect(() => { setSettings(mergeSettings(savedSettingsRaw ?? null)); }, [savedSettingsRaw]);

  // Body background
  useEffect(() => {
    document.body.style.background = "#0a0a0a";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
  }, []);

  // Timer state
  const [mode, setMode] = useState<TimerMode>("ready");
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [modeStart, setModeStart] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [liveSets, setLiveSets] = useState<LiveSet[]>([]);
  const [currentSetNum, setCurrentSetNum] = useState(0);
  const [currentExercise, setCurrentExercise] = useState<string | null>(null);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [currentReps, setCurrentReps] = useState<number | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [lastWarning, setLastWarning] = useState<"target" | "over" | null>(null);

  // Display timer
  const [displaySec, setDisplaySec] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Pagination
  const [pages, setPages] = useState({ exercise: 0, weight: 0, reps: 0 });
  const [configTab, setConfigTab] = useState<"exercise" | "weight" | "reps">("exercise");

  // Modals
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const [editSetIdx, setEditSetIdx] = useState<number | null>(null);
  const [customValueType, setCustomValueType] = useState<"weight" | "reps" | null>(null);
  const [showCustomExercise, setShowCustomExercise] = useState(false);

  // Timer refs
  const modeStartRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const modeRef = useRef<TimerMode>("ready");
  const pausedRef = useRef(false);
  const sessionStartRef = useRef<number | null>(null);
  const lastWarningRef = useRef<"target" | "over" | null>(null);
  const settingsRef = useRef(settings);
  const currentExerciseRef = useRef<string | null>(null);

  useEffect(() => { modeStartRef.current = modeStart; }, [modeStart]);
  useEffect(() => { pausedAtRef.current = pausedAt; }, [pausedAt]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { sessionStartRef.current = sessionStart; }, [sessionStart]);
  useEffect(() => { lastWarningRef.current = lastWarning; }, [lastWarning]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { currentExerciseRef.current = currentExercise; }, [currentExercise]);

  // Timer tick
  useEffect(() => {
    const id = setInterval(() => {
      const m = modeRef.current;
      if (m === "ready") return;
      const now = pausedRef.current && pausedAtRef.current ? pausedAtRef.current : Date.now();
      const ms = modeStartRef.current;
      if (!ms) return;
      const sec = Math.floor((now - ms) / 1000);
      setDisplaySec(sec);

      if (sessionStartRef.current) {
        setElapsedSec(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }

      if (m === "resting" && !pausedRef.current) {
        const s = settingsRef.current;
        const target = s.globalRest ?? (s.targets[currentExerciseRef.current ?? ""] ?? 180);
        const overThreshold = target + 15;
        if (sec >= overThreshold && lastWarningRef.current !== "over") {
          setLastWarning("over");
          lastWarningRef.current = "over";
          if (s.sound) chimeOver();
        } else if (sec >= target && sec < overThreshold && lastWarningRef.current !== "target" && lastWarningRef.current !== "over") {
          setLastWarning("target");
          lastWarningRef.current = "target";
          if (s.sound) chimeTarget();
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // Wake lock
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  async function requestWakeLock() {
    if (!settings.wake) return;
    try {
      if ("wakeLock" in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
    } catch {}
  }
  function releaseWakeLock() {
    if (wakeLockRef.current) { wakeLockRef.current.release(); wakeLockRef.current = null; }
  }
  useEffect(() => {
    const handler = () => { if (document.visibilityState === "visible" && modeRef.current !== "ready" && settings.wake) requestWakeLock(); };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [settings.wake]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") return;
      if (isInput) return;
      if (e.code === "Space") { e.preventDefault(); primaryAction(); }
      else if (e.key === "p" || e.key === "P") { e.preventDefault(); togglePause(); }
      else if ((e.key === "e" || e.key === "E") && modeRef.current === "resting") {
        e.preventDefault();
        setEditSetIdx((prev) => (liveSets.length > 0 ? liveSets.length - 1 : prev));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [liveSets.length]);

  function persistSettings(next: UserSettings) {
    setSettings(next);
    saveUserSettings(JSON.stringify(next));
  }

  function getRestTarget(exercise: string | null) {
    return settings.globalRest ?? (exercise ? settings.targets[exercise] ?? 180 : 180);
  }

  function primaryAction() {
    if (modeRef.current === "ready") beginSession();
    else if (modeRef.current === "lifting") finishLifting();
    else if (modeRef.current === "resting") startNextSet();
  }

  function beginSession() {
    const now = Date.now();
    const firstEx = Object.keys(settings.targets)[0] ?? null;
    setSessionStart(now);
    setModeStart(now);
    setCurrentSetNum(1);
    setLiveSets([]);
    setSessionNotes("");
    setSessionName("");
    setLastWarning(null);
    setCurrentExercise(firstEx);
    setCurrentWeight(firstEx ? settings.quickWeights[firstEx]?.[0] ?? null : null);
    setCurrentReps(settings.quickReps.includes(10) ? 10 : settings.quickReps[0] ?? null);
    setMode("lifting");
    requestWakeLock();
  }

  function finishLifting() {
    const now = Date.now();
    const liftDuration = Math.floor((now - (modeStartRef.current ?? now)) / 1000);
    setLiveSets((prev) => [
      ...prev,
      { setNum: currentSetNum, exercise: currentExerciseRef.current, weight: currentWeight, reps: currentReps, liftDuration, restAfter: null, timestamp: now },
    ]);
    setMode("resting");
    setModeStart(now);
    setPaused(false);
    setPausedAt(null);
    setLastWarning(null);
  }

  function startNextSet() {
    const now = Date.now();
    const restDuration = Math.floor((now - (modeStartRef.current ?? now)) / 1000);
    setLiveSets((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = { ...updated[updated.length - 1], restAfter: restDuration };
      return updated;
    });
    setCurrentSetNum((n) => n + 1);
    setMode("lifting");
    setModeStart(now);
    setPaused(false);
    setPausedAt(null);
  }

  function togglePause() {
    if (modeRef.current === "ready") return;
    if (pausedRef.current) {
      const dur = Date.now() - (pausedAtRef.current ?? Date.now());
      setModeStart((ms) => (ms ?? 0) + dur);
      setPaused(false);
      setPausedAt(null);
    } else {
      setPaused(true);
      setPausedAt(Date.now());
    }
  }

  function discardSet() {
    if (mode === "ready") return;
    if (!confirm("Discard this set? It will not be logged to history.")) return;
    const now = Date.now();
    if (mode === "lifting") {
      setModeStart(now);
      setPaused(false);
      setPausedAt(null);
    } else if (mode === "resting") {
      setLiveSets((prev) => prev.slice(0, -1));
      setMode("lifting");
      setModeStart(now);
      setPaused(false);
      setPausedAt(null);
      setLastWarning(null);
    }
  }

  async function endSession(name: string, notes: string) {
    const now = Date.now();
    const finalSets = [...liveSets];
    if (mode === "lifting") {
      finalSets.push({ setNum: currentSetNum, exercise: currentExercise, weight: currentWeight, reps: currentReps, liftDuration: Math.floor((now - (modeStartRef.current ?? now)) / 1000), restAfter: null, timestamp: now });
    } else if (mode === "resting" && finalSets.length > 0) {
      finalSets[finalSets.length - 1] = { ...finalSets[finalSets.length - 1], restAfter: Math.floor((now - (modeStartRef.current ?? now)) / 1000) };
    }
    await saveSessionMutation({ name: name || "Untitled", notes, startTime: sessionStart ?? now, duration: Math.floor((now - (sessionStart ?? now)) / 1000), sets: finalSets });
    resetSession();
    setShowEnd(false);
  }

  function resetSession() {
    setMode("ready");
    setDisplaySec(0);
    setElapsedSec(0);
    setSessionStart(null);
    setModeStart(null);
    setPaused(false);
    setPausedAt(null);
    setCurrentSetNum(0);
    setCurrentExercise(null);
    setCurrentWeight(null);
    setCurrentReps(null);
    setLiveSets([]);
    setSessionNotes("");
    setSessionName("");
    setLastWarning(null);
    setConfigTab("exercise");
    releaseWakeLock();
  }

  // Config selectors
  function selectExercise(name: string) {
    setCurrentExercise(name);
    setPages((p) => ({ ...p, weight: 0 }));
    const lastSet = [...liveSets].reverse().find((s) => s.exercise === name);
    if (lastSet) {
      setCurrentWeight(lastSet.weight);
      setCurrentReps(lastSet.reps);
    } else {
      setCurrentWeight(settings.quickWeights[name]?.[0] ?? null);
    }
    if (window.matchMedia("(max-width: 599px)").matches) setConfigTab("weight");
  }

  function selectWeight(w: number | string) {
    setCurrentWeight(Number(w));
    if (window.matchMedia("(max-width: 599px)").matches) setConfigTab("reps");
  }

  function selectReps(r: number | string) { setCurrentReps(Number(r)); }

  // Derived timer display
  const restTarget = getRestTarget(currentExercise);
  const overThreshold = restTarget + 15;
  const isAmber = mode === "resting" && displaySec >= overThreshold;
  const atTarget = mode === "resting" && displaySec >= restTarget;
  const isPaused = paused;

  const timerColor = isPaused
    ? "text-white/40"
    : isAmber
    ? "text-[#F2B84B]"
    : mode === "resting"
    ? "text-[#5DCAA5]"
    : "text-white";

  const timerBorder = atTarget && !isPaused
    ? isAmber
      ? "border-[#F2B84B] shadow-[0_0_32px_rgba(242,184,75,0.25)]"
      : "border-[#5DCAA5] shadow-[0_0_32px_rgba(93,202,165,0.25)]"
    : "border-transparent";

  const labelText = mode === "ready" ? "READY" : mode === "lifting" ? "LIFTING" : isAmber ? "OVER REST" : "RESTING";
  const labelColor = mode === "resting" ? (isAmber ? "text-[#F2B84B]" : "text-[#5DCAA5]") : "text-white/40";

  const lastRestForEx = [...liveSets].reverse().find((s) => s.exercise === currentExercise && s.restAfter !== null)?.restAfter ?? null;

  const btnText = mode === "ready" ? "Begin session" : mode === "lifting" ? "Done — start rest" : "Start next set";
  const btnColor = mode === "resting" ? (isAmber ? "bg-[#F2B84B]" : "bg-[#5DCAA5]") : "bg-white";
  const btnTextColor = "text-black";

  const exercises = Object.keys(settings.targets);
  const weightOptions = (currentExercise && settings.quickWeights[currentExercise]) ? settings.quickWeights[currentExercise] : [];
  const repsOptions = settings.quickReps;

  // Phone tab bar
  const tabZones: Array<"exercise" | "weight" | "reps"> = ["exercise", "weight", "reps"];

  const editingSet = editSetIdx !== null ? liveSets[editSetIdx] ?? null : null;

  return (
    <div class="h-screen flex flex-col px-4 sm:px-6 lg:px-10 py-4 lg:py-7 max-w-[1400px] mx-auto overflow-hidden text-white bg-[#0a0a0a]" style="font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; user-select: none;">

      {/* Header */}
      <div class="flex justify-between items-center pb-3 lg:pb-5 min-h-[52px] lg:min-h-[64px] shrink-0 gap-2">
        <div class="flex items-center gap-2 lg:gap-4 text-white/60 text-[15px] min-w-0">
          <input
            class="bg-transparent border-b border-dashed border-white/[0.16] text-white font-medium text-[13px] lg:text-[15px] outline-none w-[120px] lg:w-[200px] pb-0.5 placeholder:text-white/30 shrink-0"
            placeholder="Session name…"
            value={sessionName}
            onInput={(e) => setSessionName((e.target as HTMLInputElement).value)}
            autocomplete="off"
            style="-webkit-text-fill-color: white; caret-color: white;"
          />
          {mode !== "ready" && <span class="text-white/60 text-[13px] lg:text-[15px] whitespace-nowrap shrink-0">Set {currentSetNum}</span>}
          {mode !== "ready" && (
            <span class="font-mono text-[12px] lg:text-[13px] flex items-center gap-1 whitespace-nowrap shrink-0">
              <svg class="w-3 h-3 lg:w-3.5 lg:h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              {fmtTimeLong(elapsedSec)}
            </span>
          )}
        </div>
        <div class="flex gap-1.5 lg:gap-2.5 items-center shrink-0">
          <AuthStrip />
          <button class="bg-white/[0.04] text-white/40 p-2 lg:px-3.5 lg:py-2.5 rounded-lg text-sm flex items-center gap-2 hover:bg-white/[0.08] hover:text-white transition-all" onClick={() => setShowHistory(true)}>
            <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            <span class="hidden xl:inline">History</span>
          </button>
          <button class="bg-white/[0.04] text-white/40 p-2 lg:px-3.5 lg:py-2.5 rounded-lg text-sm flex items-center gap-2 hover:bg-white/[0.08] hover:text-white transition-all" onClick={() => setShowNotes(true)}>
            <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>
            <span class="hidden xl:inline">Notes</span>
          </button>
          <button class="bg-white/[0.04] text-white/40 p-2 lg:p-2.5 rounded-lg hover:bg-white/[0.08] hover:text-white transition-all" onClick={() => setShowSettings(true)}>
            <svg class="w-[18px] h-[18px] lg:w-[22px] lg:h-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          {mode !== "ready" && (
            <button class="bg-[rgba(225,90,90,0.15)] text-[#E15A5A] font-medium px-2.5 lg:px-3.5 py-2 lg:py-2.5 rounded-lg text-sm flex items-center gap-1.5 lg:gap-2 hover:bg-[rgba(225,90,90,0.25)] transition-all" onClick={() => setShowEnd(true)}>
              <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
              End
            </button>
          )}
        </div>
      </div>

      {/* Main */}
      <div class="flex-1 grid gap-3 min-h-0" style="grid-template-rows: 1fr min(340px, 46vh)">

        {/* Stage */}
        <div
          class={`relative flex flex-col justify-center items-center gap-5 overflow-hidden pb-2 ${mode !== "ready" ? "cursor-pointer" : ""}`}
          onClick={(e) => {
            if (mode === "ready") return;
            if ((e.target as HTMLElement).closest("button")) return;
            primaryAction();
          }}
        >
          <SessionRail sets={liveSets} onEdit={(idx) => setEditSetIdx(idx)} />

          <div class={`font-mono text-[13px] tracking-[4px] uppercase font-medium ${labelColor}`}>
            {labelText}
            {isPaused && <span class="inline-block ml-3 bg-[rgba(242,184,75,0.15)] text-[#F2B84B] font-mono text-[11px] tracking-[2px] px-2.5 py-1 rounded align-middle">PAUSED</span>}
          </div>

          <div
            class={`font-mono font-light leading-[0.95] tracking-[-6px] tabular-nums rounded-2xl border-2 transition-all duration-500 px-8 py-2 ${timerColor} ${timerBorder}`}
            style="font-size: clamp(96px, 14vw, 180px)"
          >
            {fmtTime(displaySec)}
          </div>

          <div class="text-white/40 text-sm font-mono tracking-[0.5px] h-[18px]">
            {mode === "lifting"
              ? [currentExercise, currentWeight != null ? `${currentWeight} ${settings.unit}` : null, currentReps != null ? `${currentReps} reps` : null].filter(Boolean).join(" · ")
              : mode === "resting"
              ? `Target: ${fmtTime(restTarget)}${lastRestForEx != null ? ` · Last rest: ${fmtTime(lastRestForEx)}` : ""}`
              : ""}
          </div>

          <button
            id="primary-btn"
            class={`${btnColor} ${btnTextColor} px-14 py-4 rounded-lg text-base font-medium tracking-[1px] uppercase flex items-center gap-3 transition-all hover:-translate-y-px active:translate-y-0`}
            onClick={(e) => { e.stopPropagation(); primaryAction(); }}
          >
            {btnText}
            <span class="font-mono text-[11px] opacity-50 px-1.5 py-0.5 border border-black/20 rounded">SPACE</span>
          </button>
        </div>

        {/* Bottom panel */}
        <div class="flex flex-col overflow-hidden">
          <div class="border-t border-white/[0.08] pt-4 mt-2">

            {/* Phone tab bar (≤599px) */}
            <div class="hidden max-[599px]:flex border-b border-white/[0.08] mb-3">
              {tabZones.map((tab) => (
                <button
                  key={tab}
                  class={`flex-1 py-2.5 font-mono text-[11px] tracking-[2px] uppercase border-b-2 -mb-px transition-all ${configTab === tab ? "text-white border-white" : "text-white/40 border-transparent"}`}
                  onClick={() => setConfigTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div class="grid gap-3 lg:gap-7" style="grid-template-columns: 1fr 1fr 1fr">
              {/* Exercise */}
              <div class={`flex flex-col items-center max-[599px]:${configTab !== "exercise" ? "hidden" : "flex"}`}>
                <ChunkGrid
                  items={exercises}
                  activeValue={currentExercise}
                  page={pages.exercise}
                  onPage={(d) => setPages((p) => ({ ...p, exercise: Math.max(0, p.exercise + d) }))}
                  onSelect={(v) => selectExercise(String(v))}
                  onCustom={() => setShowCustomExercise(true)}
                />
                <div class="font-mono text-[12px] tracking-[3px] text-white/40 mt-3.5 uppercase max-[599px]:hidden">Exercise</div>
              </div>

              {/* Weight */}
              <div class={`flex flex-col items-center max-[599px]:${configTab !== "weight" ? "hidden" : "flex"}`}>
                <ChunkGrid
                  items={weightOptions}
                  activeValue={currentWeight}
                  page={pages.weight}
                  onPage={(d) => setPages((p) => ({ ...p, weight: Math.max(0, p.weight + d) }))}
                  onSelect={selectWeight}
                  onCustom={() => setCustomValueType("weight")}
                  placeholder="←\nSELECT EXERCISE"
                />
                <div class="font-mono text-[12px] tracking-[3px] text-white/40 mt-3.5 uppercase max-[599px]:hidden">Weight</div>
              </div>

              {/* Reps */}
              <div class={`flex flex-col items-center max-[599px]:${configTab !== "reps" ? "hidden" : "flex"}`}>
                <ChunkGrid
                  items={repsOptions}
                  activeValue={currentReps}
                  page={pages.reps}
                  onPage={(d) => setPages((p) => ({ ...p, reps: Math.max(0, p.reps + d) }))}
                  onSelect={selectReps}
                  onCustom={() => setCustomValueType("reps")}
                />
                <div class="font-mono text-[12px] tracking-[3px] text-white/40 mt-3.5 uppercase max-[599px]:hidden">Reps</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          {mode !== "ready" && (
            <div class="flex justify-center gap-2 pt-3 pb-1 opacity-55 hover:opacity-100 transition-opacity">
              <button
                class={`flex items-center gap-1.5 px-3.5 py-2 rounded text-xs text-white/40 border border-transparent hover:text-white/60 hover:bg-white/[0.04] hover:border-white/[0.08] transition-all ${paused ? "text-[#F2B84B] border-[rgba(242,184,75,0.3)] bg-[rgba(242,184,75,0.08)]" : ""}`}
                onClick={togglePause}
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                {paused ? "Resume" : "Pause"}
                <span class="font-mono text-[10px] opacity-60 ml-0.5">P</span>
              </button>
              <button
                class="flex items-center gap-1.5 px-3.5 py-2 rounded text-xs text-white/40 border border-transparent hover:text-[#E15A5A] hover:border-[rgba(225,90,90,0.3)] transition-all"
                onClick={discardSet}
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Discard set
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <SettingsModal show={showSettings} settings={settings} onSave={persistSettings} onClose={() => setShowSettings(false)} />
      <HistoryModal show={showHistory} onClose={() => setShowHistory(false)} mode={mode} sessionStart={sessionStart} liveSets={liveSets} sessionName={sessionName} sessionNotes={sessionNotes} />
      <NotesModal show={showNotes} value={sessionNotes} onChange={setSessionNotes} onClose={() => setShowNotes(false)} />
      <EndSessionModal show={showEnd} defaultName={sessionName} defaultNotes={sessionNotes} onEnd={endSession} onClose={() => setShowEnd(false)} />
      <EditSetModal show={editSetIdx !== null} set={editingSet} settings={settings} onSave={(patch) => {
        if (editSetIdx === null) return;
        setLiveSets((prev) => {
          const next = [...prev];
          next[editSetIdx] = { ...next[editSetIdx], ...patch };
          return next;
        });
        setEditSetIdx(null);
      }} onClose={() => setEditSetIdx(null)} />
      <CustomValueModal
        show={customValueType !== null}
        type={customValueType}
        options={customValueType === "weight" ? weightOptions : repsOptions}
        onConfirm={(v) => {
          if (customValueType === "weight") {
            selectWeight(v);
            if (currentExercise && settings.quickWeights[currentExercise] && !settings.quickWeights[currentExercise].includes(v)) {
              const next = { ...settings, quickWeights: { ...settings.quickWeights, [currentExercise]: [...settings.quickWeights[currentExercise], v].sort((a, b) => a - b) } };
              persistSettings(next);
            }
          } else {
            selectReps(v);
            if (!settings.quickReps.includes(Math.round(v))) {
              const next = { ...settings, quickReps: [...settings.quickReps, Math.round(v)].sort((a, b) => a - b) };
              persistSettings(next);
            }
          }
          setCustomValueType(null);
        }}
        onClose={() => setCustomValueType(null)}
      />
      <CustomExerciseModal
        show={showCustomExercise}
        onConfirm={(name) => {
          if (!settings.targets[name]) {
            persistSettings({ ...settings, targets: { ...settings.targets, [name]: 180 }, quickWeights: { ...settings.quickWeights, [name]: defaultQuickWeights(settings.unit) } });
          }
          selectExercise(name);
          setShowCustomExercise(false);
        }}
        onClose={() => setShowCustomExercise(false)}
      />
    </div>
  );
}
