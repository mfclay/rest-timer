export type TimerMode = "ready" | "lifting" | "resting";

export type SetRecord = {
  id: string;
  sessionId: string;
  setNum: number;
  exercise: string | null;
  weight: number | null;
  reps: number | null;
  liftDuration: number;
  restAfter: number | null;
  timestamp: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type Session = {
  id: string;
  name: string;
  notes: string;
  startTime: number;
  duration: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  sets: SetRecord[];
};

export type UserSettings = {
  globalRest: number | null;
  targets: Record<string, number>;
  quickWeights: Record<string, number[]>;
  quickReps: number[];
  sound: boolean;
  wake: boolean;
  unit: "lb" | "kg";
};

// In-session set (not yet persisted)
export type LiveSet = {
  setNum: number;
  exercise: string | null;
  weight: number | null;
  reps: number | null;
  liftDuration: number;
  restAfter: number | null;
  timestamp: number;
};
