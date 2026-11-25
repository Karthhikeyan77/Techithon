import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(app);

export async function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken> {
  return adminAuth.verifyIdToken(idToken);
}
