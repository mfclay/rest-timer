export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function fmtTimeLong(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseTimeStr(str: string): number {
  const parts = str.split(":");
  if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return parseInt(parts[0]);
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
}

import type { UserSettings } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  globalRest: null,
  targets: {
    "Standing Curl": 60,
    "Incline Curl": 60,
    "Iso Curl": 60,
    "Shoulder Shrug": 60,
    "Shoulder Raise": 60,
    Squat: 60,
    Bench: 60,
    Deadlift: 60,
    OHP: 60,
    Row: 60,
    Pullup: 60,
    Pooping: 600,
  },
  quickWeights: {
    "Standing Curl": [20, 22.5, 25, 30, 35],
    "Incline Curl": [20, 22.5, 25, 30, 35],
    "Iso Curl": [20, 22.5, 25, 30, 35],
    "Shoulder Shrug": [25, 30, 35, 40, 45],
    "Shoulder Raise": [15, 17.5, 20, 22.5, 25, 30, 35],
    Squat: [135, 185, 225, 275],
    Bench: [135, 155, 175, 185, 205],
    Deadlift: [185, 225, 275, 315],
    OHP: [75, 95, 115, 135],
    Row: [95, 115, 135, 155],
    Pullup: [0],
    Pooping: [350, 475, 650],
  },
  quickReps: [3, 5, 8, 10, 12],
  sound: true,
  wake: true,
  unit: "lb",
};

export const DEFAULT_QUICK_WEIGHTS = { lb: [25, 30, 35, 40, 45, 50], kg: [25, 30, 35, 40, 45, 50] };
