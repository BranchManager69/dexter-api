export const MEMORY_LIMITS = {
  storage: {
    /**
     * Maximum memories to keep per user. Set to null to retain everything.
     */
    maxStoredPerUser: null as number | null,
  },
  instructions: {
    /** Recent memories included in agent instruction preamble. */
    recentCount: 5,
    /** Facts lines pulled from each memory when building instructions. */
    maxFactsPerMemory: 2,
    /** Follow-up lines pulled from each memory for instructions. */
    maxFollowUpsPerMemory: 1,
  },
  dossier: {
    /** Memories provided to the dossier composer when generating the snapshot. */
    recentCount: 30,
  },
  adminPanel: {
    /** Memories surfaced in the admin console by default. */
    recentCount: 50,
  },
} as const;

export type MemoryLimits = typeof MEMORY_LIMITS;
