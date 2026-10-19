import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from './env';

const app = getApps()[0] ?? initializeApp({
  credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY }),
});

/** Firebase Admin Auth. Set FIREBASE_AUTH_EMULATOR_HOST to point it at the local emulator. */
export const firebaseAuth = getAuth(app);
