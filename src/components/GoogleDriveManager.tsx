import React, { useCallback, useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  Cloud,
  ExternalLink,
  FileJson,
  HardDrive,
  Image as ImageIcon,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  type DriveFileItem,
  deleteDriveFile,
  formatDriveFileSize,
  getDriveAccessToken,
  getDriveUser,
  initDriveAuth,
  listOrvexaDriveFiles,
  logoutGoogleDrive,
  signInWithGoogleDrive,
  uploadImageToDrive,
  uploadJsonBackupToDrive,
} from '../lib/googleDrive';
import { GoogleSignInButton } from './GoogleSignInButton';
import { SafeImage } from './SafeImage';

interface ConfirmActionState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

interface GoogleDriveManagerProps {
  mode?: 'full' | 'image-picker';
  onSelectImageUrl?: (url: string) => void;
  onGetBackupPayload?: () => Promise<{ filename: string; data: unknown }>;
  title?: string;
  subtitle?: string;
}

export function GoogleDriveManager({
  mode = 'full',
  onSelectImageUrl,
  onGetBackupPayload,
  title = 'Google Drive ক্লাউড স্টোরেজ',
  subtitle = 'আপনার মার্কেটপ্লেসের ছবি ও ডেটা ব্যাকআপ সরাসরি Google Drive-এ সংরক্ষণ করুন।',
}: GoogleDriveManagerProps) {
  const { showToast } = useAuth();
  const [driveUser, setDriveUser] = useState<FirebaseUser | null>(() => getDriveUser());
  const [accessToken, setAccessToken] = useState<string | null>(() => getDriveAccessToken());
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getDriveAccessToken());
  const [loggingIn, setLoggingIn] = useState(false);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmActionState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadFiles = useCallback(
    async (token: string) => {
      setLoadingFiles(true);
      try {
        const list = await listOrvexaDriveFiles(token);
        setFiles(list);
      } catch (err: any) {
        if (String(err.message).includes('মেয়াদ শেষ')) {
          setAccessToken(null);
          setNeedsAuth(true);
        }
        showToast(err.message || 'Google Drive ফাইল লোড করতে সমস্যা হয়েছে।', 'error');
      } finally {
        setLoadingFiles(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    const unsub = initDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      () => {
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (accessToken) {
      loadFiles(accessToken);
    }
  }, [accessToken, loadFiles]);

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    try {
      const res = await signInWithGoogleDrive();
      setDriveUser(res.user);
      setAccessToken(res.accessToken);
      setNeedsAuth(false);
      showToast('Google Drive সফলভাবে সংযুক্ত হয়েছে!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Google Drive সংযোগ ব্যর্থ হয়েছে।', 'error');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleDisconnect = async () => {
    await logoutGoogleDrive();
    setDriveUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setFiles([]);
    showToast('Google Drive সংযোগ বিচ্ছিন্ন করা হয়েছে।', 'info');
  };

  const handleUploadImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0 || !accessToken) return;
    setUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < selected.length; i++) {
        const item = await uploadImageToDrive(accessToken, selected[i]);
        uploadedUrls.push(item.publicUrl);
        if (onSelectImageUrl) {
          onSelectImageUrl(item.publicUrl);
        }
      }
      showToast(`${uploadedUrls.length}টি ছবি Google Drive-এ সংরক্ষিত হয়েছে!`, 'success');
      await loadFiles(accessToken);
    } catch (err: any) {
      if (String(err.message).includes('মেয়াদ শেষ')) {
        setAccessToken(null);
        setNeedsAuth(true);
      }
      showToast(err.message || 'Google Drive আপলোড ব্যর্থ হয়েছে।', 'error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const requestSaveBackup = async () => {
    if (!accessToken || !onGetBackupPayload) return;
    try {
      const { filename, data } = await onGetBackupPayload();
      setConfirmState({
        title: 'Google Drive-এ মার্কেটপ্লেস ব্যাকআপ সংরক্ষণ',
        description: `আপনি কি "${filename}" ফাইলটি আপনার Google Drive-এর "Orvexa Marketplace" ফোল্ডারে সংরক্ষণ করতে নিশ্চিত?`,
        confirmLabel: 'Drive-এ ব্যাকআপ সংরক্ষণ করুন',
        danger: false,
        onConfirm: async () => {
          await uploadJsonBackupToDrive(accessToken, filename, data);
          showToast('মার্কেটপ্লেস ব্যাকআপ সফলভাবে Google Drive-এ সংরক্ষিত হয়েছে!', 'success');
          await loadFiles(accessToken);
        },
      });
    } catch (err: any) {
      showToast(err.message || 'ব্যাকআপ প্রস্তুত করতে সমস্যা হয়েছে।', 'error');
    }
  };

  const requestDeleteFile = (file: DriveFileItem) => {
    if (!accessToken) return;
    setConfirmState({
      title: 'Google Drive থেকে ফাইল মুছুন',
      description: `আপনি কি নিশ্চিত যে আপনি "${file.name}" ফাইলটি আপনার Google Drive থেকে স্থায়ীভাবে মুছে ফেলতে চান? এটি আর পুনরুদ্ধার করা যাবে না।`,
      confirmLabel: 'স্থায়ীভাবে মুছুন',
      danger: true,
      onConfirm: async () => {
        await deleteDriveFile(accessToken, file.id);
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        showToast(`"${file.name}" Google Drive থেকে মুছে ফেলা হয়েছে।`, 'info');
      },
    });
  };

  const executeConfirm = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (err: any) {
      if (String(err.message).includes('মেয়াদ শেষ')) {
        setAccessToken(null);
        setNeedsAuth(true);
      }
      showToast(err.message || 'অপারেশনটি সম্পন্ন করা যায়নি।', 'error');
    } finally {
      setConfirmBusy(false);
    }
  };

  const imageFiles = files.filter((f) => f.mimeType.startsWith('image/'));
  const displayedFiles = mode === 'image-picker' ? imageFiles : files;

  return (
    <div className="glass-card rounded-3xl p-5 sm:p-6 space-y-4 border border-purple-500/20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/15 border border-purple-400/30 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5 text-[#C8FA50]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              {title}
              {!needsAuth && accessToken && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <Check className="w-3 h-3" /> সংযুক্ত
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {needsAuth || !accessToken ? (
            <GoogleSignInButton onClick={handleGoogleLogin} loading={loggingIn} />
          ) : (
            <>
              <div className="text-xs text-slate-300 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                {driveUser?.email || driveUser?.displayName || 'Google Connected'}
              </div>
              <button
                type="button"
                onClick={handleDisconnect}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" /> বিচ্ছিন্ন করুন
              </button>
            </>
          )}
        </div>
      </div>

      {/* Connected Controls */}
      {!needsAuth && accessToken && (
        <div className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full glow-lime-btn text-xs font-bold cursor-pointer">
              <Upload className="w-4 h-4" />
              {uploading ? 'Drive-এ আপলোড হচ্ছে...' : 'Google Drive-এ ছবি আপলোড করুন'}
              <input
                type="file"
                multiple={mode === 'full' || Boolean(onSelectImageUrl)}
                accept="image/*"
                disabled={uploading}
                onChange={handleUploadImageFiles}
                className="hidden"
              />
            </label>

            {onGetBackupPayload && (
              <button
                type="button"
                onClick={requestSaveBackup}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full glow-purple-btn text-xs font-semibold"
              >
                <Cloud className="w-4 h-4 text-[#C8FA50]" />
                Drive-এ সম্পূর্ণ ব্যাকআপ নিন
              </button>
            )}

            <button
              type="button"
              onClick={() => loadFiles(accessToken)}
              disabled={loadingFiles}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-200 hover:border-[#C8FA50]/45"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingFiles ? 'animate-spin' : ''}`} />
              রিফ্রেশ
            </button>
          </div>

          {/* File list */}
          {loadingFiles ? (
            <div className="p-6 text-center text-xs text-slate-400">Google Drive ফোল্ডার থেকে ফাইল লোড হচ্ছে...</div>
          ) : displayedFiles.length === 0 ? (
            <div className="p-6 rounded-2xl bg-[#090B11] border border-white/10 text-center text-xs text-slate-400">
              আপনার &ldquo;Orvexa Marketplace&rdquo; Google Drive ফোল্ডারে এখনো কোনো{' '}
              {mode === 'image-picker' ? 'ছবি' : 'ফাইল'} নেই।
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
              {displayedFiles.map((file) => {
                const isImage = file.mimeType.startsWith('image/');
                return (
                  <div
                    key={file.id}
                    className="rounded-2xl bg-[#090B11] border border-white/10 overflow-hidden flex flex-col group"
                  >
                    <div className="aspect-square bg-slate-900 relative overflow-hidden">
                      {isImage ? (
                        <SafeImage
                          src={file.publicUrl}
                          alt={file.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-purple-300">
                          <FileJson className="w-8 h-8" />
                          <span className="text-[10px] font-mono uppercase">JSON Backup</span>
                        </div>
                      )}
                    </div>

                    <div className="p-2.5 space-y-1.5 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] font-semibold text-white truncate" title={file.name}>
                          {file.name}
                        </div>
                        <div className="text-[10px] text-slate-500 tabular-nums">
                          {formatDriveFileSize(file.size)}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        {isImage && onSelectImageUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectImageUrl(file.publicUrl);
                              showToast('Drive থেকে ছবিটি যোগ করা হয়েছে!', 'success');
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded-lg glow-lime-btn text-[10px] font-bold"
                          >
                            <ImageIcon className="w-3 h-3" /> ব্যবহার
                          </button>
                        )}
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Google Drive-এ দেখুন"
                            className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => requestDeleteFile(file)}
                          aria-label="Drive থেকে মুছুন"
                          className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mandatory Explicit User Confirmation Modal before Mutating/Deleting Drive files */}
      {confirmState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 space-y-4 border border-white/15 shadow-2xl">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  confirmState.danger ? 'bg-rose-500/15 text-rose-400' : 'bg-[#C8FA50]/15 text-[#C8FA50]'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">{confirmState.title}</h4>
                <p className="text-xs text-slate-300 leading-relaxed mt-1">{confirmState.description}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmState(null)}
                className="px-4 py-2 rounded-full bg-white/5 border border-white/15 text-xs font-semibold text-slate-300 hover:bg-white/10"
              >
                বাতিল
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={executeConfirm}
                className={`px-5 py-2 rounded-full text-xs font-bold ${
                  confirmState.danger
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'glow-lime-btn'
                }`}
              >
                {confirmBusy ? 'সম্পন্ন হচ্ছে...' : confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
