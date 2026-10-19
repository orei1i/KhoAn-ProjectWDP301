import type { DecodedIdToken } from 'firebase-admin/auth';
import type { UserHydrated } from '../shared/db/models';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`: the Mongo profile (role, facilityIds) is the source of truth for RBAC. */
      auth?: { user: UserHydrated; token?: DecodedIdToken };
      /** Set by `verifyFirebase` (used by /auth/sync before a profile exists). */
      firebase?: DecodedIdToken;
      /** Zod-parsed input from `validate()`. */
      valid: { body?: any; query?: any; params?: any };
    }
  }
}

export {};
