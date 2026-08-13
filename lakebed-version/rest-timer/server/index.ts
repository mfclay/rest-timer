import { boolean, capsule, mutation, query, string, table } from "lakebed/server";
import type { LiveSet } from "../shared/types";

export default capsule({
  name: "rest-timer",

  schema: {
    sessions: table({
      name: string(),
      notes: string().default(""),
      startTime: string(), // ms timestamp as string
      duration: string(),  // seconds as string
      setsJson: string(),  // JSON array of LiveSet objects
      ownerId: string(),
    }).index("by_owner_start", ["ownerId", "startTime"]),
    userSettings: table({
      ownerId: string(),
      data: string(), // JSON-encoded UserSettings
      isDefault: boolean().default(false),
    }).index("by_owner", ["ownerId"]),
  },

  queries: {
    sessions: query(async (ctx) => {
      // ownerId is pinned by eq, so "desc" orders by startTime within this user
      const rows = await ctx.db.sessions
        .withIndex("by_owner_start", (q) => q.eq("ownerId", ctx.auth.userId))
        .order("desc")
        .take(100);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        notes: row.notes,
        startTime: Number(row.startTime),
        duration: Number(row.duration),
        ownerId: row.ownerId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sets: JSON.parse(row.setsJson || "[]") as LiveSet[],
      }));
    }),

    userSettings: query(async (ctx) => {
      const row = await ctx.db.userSettings
        .withIndex("by_owner", (q) => q.eq("ownerId", ctx.auth.userId))
        .first();
      return row?.data ?? null;
    }),
  },

  mutations: {
    saveSession: mutation(
      async (
        ctx,
        payload: { name: string; notes: string; startTime: number; duration: number; sets: LiveSet[] }
      ) => {
        const session = await ctx.db.sessions.insert({
          name: payload.name,
          notes: payload.notes,
          startTime: String(payload.startTime),
          duration: String(payload.duration),
          setsJson: JSON.stringify(payload.sets),
          ownerId: ctx.auth.userId,
        });
        return session.id;
      }
    ),

    saveUserSettings: mutation(async (ctx, data: string) => {
      const existing = await ctx.db.userSettings
        .withIndex("by_owner", (q) => q.eq("ownerId", ctx.auth.userId))
        .first();
      if (existing) {
        await ctx.db.userSettings.update(existing.id, { data });
      } else {
        await ctx.db.userSettings.insert({ ownerId: ctx.auth.userId, data });
      }
    }),
  },
});
