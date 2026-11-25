import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  type User as FirebaseUser,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

function getDriveFirebaseAuth() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

function getGoogleDriveProvider() {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'consent select_account' });
  return provider;
}

let isSigningIn = false;
// Keep OAuth access token strictly in memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedFirebaseUser: FirebaseUser | null = null;

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  publicUrl: string;
}

export function initDriveAuth(
  onAuthSuccess?: (user: FirebaseUser, token: string) => void,
  onAuthFailure?: () => void
) {
  try {
    const auth = getDriveFirebaseAuth();
    return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
      cachedFirebaseUser = user;
      if (user) {
        if (cachedAccessToken) {
          onAuthSuccess?.(user, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          onAuthFailure?.();
        }
      } else {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    });
  } catch {
    onAuthFailure?.();
    return () => {};
  }
}

export async function signInWithGoogleDrive(): Promise<{ user: FirebaseUser; accessToken: string }> {
  isSigningIn = true;
  try {
    const auth = getDriveFirebaseAuth();
    const result = await signInWithPopup(auth, getGoogleDriveProvider());
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive অ্যাক্সেস টোকেন পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
    cachedAccessToken = credential.accessToken;
    cachedFirebaseUser = result.user;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getDriveUser(): FirebaseUser | null {
  return cachedFirebaseUser;
}

export async function logoutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  cachedFirebaseUser = null;
  try {
    await getDriveFirebaseAuth().signOut();
  } catch {
    // ignore if auth was not initialized
  }
}

export function getDrivePublicImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

export function formatDriveFileSize(sizeStr?: string): string {
  const bytes = Number(sizeStr || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function handleDriveResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive সেশনের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার Sign in with Google করুন।');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Google Drive অনুরোধ ব্যর্থ হয়েছে।');
  }
  return data as T;
}

export async function ensureOrvexaFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    "name = 'Orvexa Marketplace' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const searchData = await handleDriveResponse<{ files?: Array<{ id: string; name: string }> }>(searchRes);
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Orvexa Marketplace',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { app: 'orvexa' },
    }),
  });
  const created = await handleDriveResponse<{ id: string }>(createRes);
  return created.id;
}

export async function listOrvexaDriveFiles(accessToken: string): Promise<DriveFileItem[]> {
  const folderId = await ensureOrvexaFolder(accessToken);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&fields=files(id,name,mimeType,size,createdTime,webViewLink,thumbnailLink)&pageSize=50`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data = await handleDriveResponse<{ files?: Array<Omit<DriveFileItem, 'publicUrl'>> }>(res);
  return (data.files || []).map((f) => ({
    ...f,
    publicUrl: getDrivePublicImageUrl(f.id),
  }));
}

export async function uploadImageToDrive(accessToken: string, file: File): Promise<DriveFileItem> {
  const folderId = await ensureOrvexaFolder(accessToken);
  const metadata = {
    name: `orvexa-${Date.now()}-${file.name}`,
    parents: [folderId],
    mimeType: file.type || 'image/jpeg',
    appProperties: { app: 'orvexa', category: 'media' },
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  const uploaded = await handleDriveResponse<Omit<DriveFileItem, 'publicUrl'>>(uploadRes);

  // Grant public read access so the image renders inside storefront <img> tags for buyers
  const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!permRes.ok) {
    // Non-fatal fallback; webViewLink/thumbnail still works for owner
    console.warn('Could not set public permission on Drive image');
  }

  return {
    ...uploaded,
    publicUrl: getDrivePublicImageUrl(uploaded.id),
  };
}

export async function uploadJsonBackupToDrive(
  accessToken: string,
  filename: string,
  payload: unknown
): Promise<DriveFileItem> {
  const folderId = await ensureOrvexaFolder(accessToken);
  const metadata = {
    name: filename,
    parents: [folderId],
    mimeType: 'application/json',
    appProperties: { app: 'orvexa', category: 'backup' },
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,createdTime,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  const uploaded = await handleDriveResponse<Omit<DriveFileItem, 'publicUrl'>>(uploadRes);
  return {
    ...uploaded,
    publicUrl: uploaded.webViewLink || getDrivePublicImageUrl(uploaded.id),
  };
}

export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive সেশনের মেয়াদ শেষ হয়েছে। অনুগ্রহ করে আবার Sign in with Google করুন।');
  }
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Google Drive থেকে ফাইল মুছতে সমস্যা হয়েছে।');
  }
}
