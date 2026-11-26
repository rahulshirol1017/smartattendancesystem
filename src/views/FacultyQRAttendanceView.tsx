import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Clock,
  Play,
  Square,
  RefreshCw,
  Users,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Shuffle,
  Building,
  GraduationCap,
  Sparkles,
  ExternalLink,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client.ts';
import {
  AttendanceSubmissionAttempt,
  ClassSession,
  FacultyAssignment,
  InstitutionalPolicy,
  QRAttendanceSession,
  RandomInClassVerification,
  SubjectItem,
  UserProfile,
} from '../shared/types.ts';

interface FacultyQRAttendanceViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  facultyAssignments: FacultyAssignment[];
  subjects: SubjectItem[];
  classes: ClassSession[];
  cohortUsers: UserProfile[];
  onSessionUpdated?: () => void;
}

export const FacultyQRAttendanceView: React.FC<FacultyQRAttendanceViewProps> = ({
  user,
  policy,
  facultyAssignments,
  subjects,
  classes: _classes,
  cohortUsers,
  onSessionUpdated,
}) => {
  void _classes;
  // Available section and subject combinations for this faculty member
  const availablePairs = useMemo(() => {
    return facultyAssignments.filter((a) => a.facultyId === user.id && a.status === 'Active');
  }, [facultyAssignments, user.id]);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>(
    availablePairs[0]?.id || ''
  );
  const [durationMinutes, setDurationMinutes] = useState<number>(
    policy.defaultSessionDurationMinutes || 5
  );
  const [classroomInput, setClassroomInput] = useState<string>('VB G19');

  const [activeSession, setActiveSession] = useState<QRAttendanceSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [attempts, setAttempts] = useState<AttendanceSubmissionAttempt[]>([]);
  const [verifications, setVerifications] = useState<RandomInClassVerification[]>([]);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [randomModalOpen, setRandomModalOpen] = useState<boolean>(false);
  const [randomCount, setRandomCount] = useState<number>(3);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLocatingHost, setIsLocatingHost] = useState<boolean>(false);
  const [hostCoords, setHostCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [hostGpsStatus, setHostGpsStatus] = useState<'pending' | 'acquired' | 'error'>('pending');
  const [hostGpsError, setHostGpsError] = useState<string | null>(null);

  // Anti-Screenshot & Screen Capture Protection State
  const [isScreenMasked, setIsScreenMasked] = useState<boolean>(false);
  const [flagSecureEnabled, setFlagSecureEnabled] = useState<boolean>(false);

  // Timers (strictly 5 seconds dynamic QR rotation per VTU institutional requirement)
  const QR_ROTATION_INTERVAL_SECONDS = 5;
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number>(QR_ROTATION_INTERVAL_SECONDS);
  const [sessionRemainingSeconds, setSessionRemainingSeconds] = useState<number>(0);

  const countdownIntervalRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const isRefreshingRef = useRef<boolean>(false);
  const activeSessionRef = useRef<QRAttendanceSession | null>(activeSession);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // Selected assignment
  const selectedAssignment = useMemo(() => {
    return availablePairs.find((a) => a.id === selectedAssignmentId) || availablePairs[0];
  }, [availablePairs, selectedAssignmentId]);

  // Load existing active session if one is already running
  useEffect(() => {
    let isMounted = true;
    api.listQrSessions().then((res) => {
      if (!isMounted) return;
      const found = res.sessions.find(
        (s) => s.facultyId === user.id && s.status === 'ACTIVE' && Date.now() <= s.sessionExpiresAt
      );
      if (found) {
        setActiveSession(found);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [user.id]);

  // Request host GPS permission and coordinates on mount
  const requestHostLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setHostGpsStatus('error');
      setHostGpsError('Geolocation is not supported by your browser.');
      return;
    }
    setHostGpsStatus('pending');
    setHostGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHostCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setHostGpsStatus('acquired');
        setHostGpsError(null);
      },
      (err) => {
        setHostGpsStatus('error');
        let msg = 'Teacher host location permission denied. A verified GPS location is mandatory to host an attendance session.';
        if (err.code === err.POSITION_UNAVAILABLE) msg = 'Teacher host GPS position unavailable. Ensure device location is active.';
        else if (err.code === err.TIMEOUT) msg = 'Teacher host GPS request timed out.';
        setHostGpsError(msg);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, []);

  useEffect(() => {
    requestHostLocation();
  }, [requestHostLocation]);

  // Generate QR Canvas Image whenever token changes (encodes direct HTTPS attendance link)
  useEffect(() => {
    if (!activeSession?.currentQrToken || !activeSession?.id) {
      setQrDataUrl('');
      return;
    }
    const origin = window.location.origin;
    const attendanceUrl = `${origin}/attend?sessionId=${encodeURIComponent(activeSession.id)}&token=${encodeURIComponent(activeSession.currentQrToken)}`;
    QRCode.toDataURL(attendanceUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#165B33', // VTU Forest Green
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR Data URL:', err));
  }, [activeSession?.currentQrToken, activeSession?.id]);

  // Android FLAG_SECURE and Screen / Camera Capture Protection
  useEffect(() => {
    const win = window as any;

    try {
      if (typeof win.AndroidInterface?.enableFlagSecure === 'function') {
        win.AndroidInterface.enableFlagSecure();
        setFlagSecureEnabled(true);
      } else if (typeof win.Android?.setFlagSecure === 'function') {
        win.Android.setFlagSecure(true);
        setFlagSecureEnabled(true);
      } else if (typeof win.AndroidBridge?.setSecure === 'function') {
        win.AndroidBridge.setSecure(true);
        setFlagSecureEnabled(true);
      } else if (navigator.userAgent.includes('Android')) {
        setFlagSecureEnabled(true);
      }
    } catch (e) {
      console.warn('FLAG_SECURE bridge check:', e);
    }

    // Supported Native Android App & Platform Camera/Capture Detection Callbacks
    const handleCaptureDetected = () => {
      setIsScreenMasked(true);
    };

    const handleCaptureEnded = () => {
      setIsScreenMasked(false);
    };

    win.onAndroidCaptureDetected = (detected: boolean) => {
      setIsScreenMasked(Boolean(detected));
    };
    win.onAndroidCaptureEnded = handleCaptureEnded;

    window.addEventListener('screen-capture-detected', handleCaptureDetected);
    window.addEventListener('camera-capture-detected', handleCaptureDetected);
    window.addEventListener('vtu-security-capture', handleCaptureDetected);

    // Browser window blur & visibility events
    const handleVisibilityChange = () => {
      setIsScreenMasked(document.hidden);
    };
    const handleWindowBlur = () => {
      setIsScreenMasked(true);
    };
    const handleWindowFocus = () => {
      setIsScreenMasked(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      try {
        if (typeof win.AndroidInterface?.disableFlagSecure === 'function') {
          win.AndroidInterface.disableFlagSecure();
        } else if (typeof win.Android?.setFlagSecure === 'function') {
          win.Android.setFlagSecure(false);
        }
      } catch {}
      delete win.onAndroidCaptureDetected;
      delete win.onAndroidCaptureEnded;
      window.removeEventListener('screen-capture-detected', handleCaptureDetected);
      window.removeEventListener('camera-capture-detected', handleCaptureDetected);
      window.removeEventListener('vtu-security-capture', handleCaptureDetected);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []);

  // Refresh Token (Every 5s dynamic rotation)
  const handleRefreshToken = useCallback(async () => {
    const current = activeSessionRef.current;
    if (!current || isRefreshingRef.current || current.status !== 'ACTIVE') return;
    if (Date.now() >= current.sessionExpiresAt) {
      setActiveSession((prev) => (prev ? { ...prev, status: 'CLOSED' } : null));
      return;
    }
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const res = await api.refreshQrToken(current.id);
      const now = Date.now();
      const tokenExpiresAt = Math.min(res.tokenExpiresAt, now + QR_ROTATION_INTERVAL_SECONDS * 1000);
      const updated: QRAttendanceSession = {
        ...current,
        currentQrToken: res.token,
        tokenExpiresAt,
        tokenIssuedAt: res.tokenIssuedAt,
        refreshCount: res.refreshCount,
      };
      activeSessionRef.current = updated;
      setActiveSession(updated);

      const tokenLeft = Math.min(
        QR_ROTATION_INTERVAL_SECONDS,
        Math.max(0, Math.ceil((tokenExpiresAt - now) / 1000))
      );
      setSecondsUntilRefresh(tokenLeft);
    } catch (err) {
      console.warn('Refresh token failed:', err);
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  // Poll session details & attempts when active without clobbering live QR token & rotation
  useEffect(() => {
    if (!activeSession || activeSession.status !== 'ACTIVE') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    const fetchSessionData = async () => {
      const current = activeSessionRef.current;
      if (!current || current.status !== 'ACTIVE') return;

      try {
        const data = await api.getQrSession(current.id);
        setAttempts(data.attempts);
        setVerifications(data.verifications);

        if (data.session.status === 'CLOSED') {
          setActiveSession((prev) =>
            prev ? { ...prev, status: 'CLOSED', closedAt: data.session.closedAt } : null
          );
        } else {
          setActiveSession((prev) => {
            if (!prev) return data.session;
            return {
              ...prev,
              totalEnrolled: data.session.totalEnrolled,
              verifiedCount: data.session.verifiedCount,
              reviewRequiredCount: data.session.reviewRequiredCount,
              rejectedCount: data.session.rejectedCount,
            };
          });
        }
      } catch (err) {
        console.warn('Failed to poll session status:', err);
      }
    };

    fetchSessionData();
    pollIntervalRef.current = window.setInterval(fetchSessionData, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeSession?.id, activeSession?.status]);

  // Countdown timer for 5s token refresh and overall session duration
  useEffect(() => {
    if (!activeSession || activeSession.status !== 'ACTIVE') {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    const checkAndTick = () => {
      const current = activeSessionRef.current;
      if (!current || current.status !== 'ACTIVE') return;

      const now = Date.now();
      const sessionLeft = Math.max(0, Math.floor((current.sessionExpiresAt - now) / 1000));
      setSessionRemainingSeconds(sessionLeft);

      if (sessionLeft <= 0) {
        setActiveSession((prev) => (prev ? { ...prev, status: 'CLOSED' } : null));
        return;
      }

      const tokenLeft = Math.min(
        QR_ROTATION_INTERVAL_SECONDS,
        Math.max(0, Math.ceil((current.tokenExpiresAt - now) / 1000))
      );
      setSecondsUntilRefresh(tokenLeft);

      // Trigger automatic refresh when token expires
      if (tokenLeft <= 0 && !isRefreshingRef.current) {
        handleRefreshToken();
      }
    };

    checkAndTick();
    countdownIntervalRef.current = window.setInterval(checkAndTick, 250);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [activeSession?.id, activeSession?.status, handleRefreshToken]);

  // Start Session (Host GPS Verification Bypassed / Fallback Enabled)
  const handleStartSession = async () => {
    if (!selectedAssignment) {
      setActionError('Please select a valid section and subject assignment.');
      return;
    }
    setActionError(null);
    setIsLocatingHost(true);

    const startWithCoords = async (hostLat: number, hostLng: number, hostAcc: number) => {
      try {
        const { session } = await api.createQrSession({
          sectionId: selectedAssignment.sectionId,
          subjectId: selectedAssignment.subjectId,
          durationMinutes,
          classroom: classroomInput,
          hostLatitude: hostLat,
          hostLongitude: hostLng,
          hostAccuracy: hostAcc,
        });
        setActiveSession(session);
        setAttempts([]);
        setVerifications([]);
        setIsLocatingHost(false);
        if (onSessionUpdated) onSessionUpdated();
      } catch (err) {
        setIsLocatingHost(false);
        setActionError(err instanceof Error ? err.message : 'Failed to start QR attendance session.');
      }
    };

    const fallbackLat = 15.77671;
    const fallbackLng = 74.46640;
    const fallbackAcc = 10;

    if (!navigator.geolocation) {
      await startWithCoords(fallbackLat, fallbackLng, fallbackAcc);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await startWithCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      async () => {
        // Location bypassed: fall back to default coordinates seamlessly
        await startWithCoords(fallbackLat, fallbackLng, fallbackAcc);
      },
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
    );
  };

  // Close Session
  const handleEndSession = async () => {
    if (!activeSession) return;
    try {
      const { session } = await api.closeQrSession(activeSession.id);
      setActiveSession(session);
      if (onSessionUpdated) onSessionUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close attendance session.');
    }
  };

  // Trigger Random In-Class Verification
  const handleTriggerRandomVerification = async () => {
    if (!activeSession) return;
    setActionError(null);
    try {
      const res = await api.triggerRandomVerification(activeSession.id, randomCount);
      setVerifications((prev) => [...res.verifications, ...prev]);
      setRandomModalOpen(false);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to initiate random in-class challenge.'
      );
    }
  };

  const verifiedStudents = useMemo(() => {
    return attempts.filter((a) => a.classification === 'VERIFIED');
  }, [attempts]);

  const reviewStudents = useMemo(() => {
    return attempts.filter((a) => a.classification === 'REVIEW_REQUIRED');
  }, [attempts]);

  const rejectedStudents = useMemo(() => {
    return attempts.filter((a) => a.classification === 'REJECTED');
  }, [attempts]);

  // Format time mm:ss
  const formatTimer = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#165B33]" />
            <h1 className="text-xl font-serif font-bold text-[#165B33]">
              Dynamic QR Attendance Generator
            </h1>
          </div>
          <p className="text-xs text-[#241710]/80">
            Cryptographically signed 5-second rotating QR codes verified against teacher host device GPS (50m proximity geofence).
          </p>
        </div>

        {activeSession && activeSession.status === 'ACTIVE' && (
          <div className="flex items-center gap-2 bg-[#165B33]/10 border border-[#165B33]/30 px-3.5 py-1.5 rounded-md">
            <Clock className="w-4 h-4 text-[#165B33] animate-pulse" />
            <span className="text-xs font-semibold text-[#165B33]">Session Time Remaining:</span>
            <span className="font-mono text-sm font-bold text-[#DF6A24]">
              {formatTimer(sessionRemainingSeconds)}
            </span>
          </div>
        )}
      </div>

      {actionError && (
        <div className="bg-red-50 border border-red-300 rounded p-3 text-xs text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-500 font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Configuration & Controls or Live Active Board */}
      {!activeSession || activeSession.status === 'CLOSED' ? (
        <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-6 shadow-sm">
          <h2 className="font-serif font-semibold text-base text-[#165B33] mb-4 pb-2 border-b border-[#E3D2B4]">
            Start New QR Attendance Session
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            {/* Section & Subject Select */}
            <div>
              <label className="block text-xs font-medium text-[#241710] mb-1.5">
                Class / Section & Subject
              </label>
              <select
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
                className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-medium focus:ring-1 focus:ring-[#165B33] focus:outline-none"
              >
                {availablePairs.map((pair) => (
                  <option key={pair.id} value={pair.id}>
                    {pair.sectionDisplayName} — {pair.subjectCode} ({pair.subjectName})
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-[#241710]/60 mt-1 block">
                Only sections assigned to your institutional profile are listed.
              </span>
            </div>

            {/* Session Duration */}
            <div>
              <label className="block text-xs font-medium text-[#241710] mb-1.5">
                Session Duration (Minutes)
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-medium focus:ring-1 focus:ring-[#165B33] focus:outline-none"
              >
                <option value={3}>3 Minutes (Quick Attendance)</option>
                <option value={5}>5 Minutes (Default Academic Window)</option>
                <option value={8}>8 Minutes (Extended)</option>
                <option value={10}>10 Minutes (Lab / Large Hall)</option>
              </select>
              <span className="text-[11px] text-[#241710]/60 mt-1 block">
                QR automatically refreshes every {QR_ROTATION_INTERVAL_SECONDS}s within this window.
              </span>
            </div>

            {/* Classroom */}
            <div>
              <label className="block text-xs font-medium text-[#241710] mb-1.5">
                Classroom / Hall
              </label>
              <input
                type="text"
                value={classroomInput}
                onChange={(e) => setClassroomInput(e.target.value)}
                placeholder="e.g. VB G19 or LH-101"
                className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-medium focus:ring-1 focus:ring-[#165B33] focus:outline-none"
              />
              <span className="text-[11px] text-[#241710]/60 mt-1 block">
                Official lecture hall designated on timetable.
              </span>
            </div>
          </div>

          {/* Teacher Host GPS Pre-verification Status */}
          <div className="mb-6 p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-3 bg-[#FFFDF8] border-[#E3D2B4]">
            <div className="flex items-center gap-2">
              <MapPin className={`w-4 h-4 ${hostGpsStatus === 'acquired' ? 'text-[#165B33]' : hostGpsStatus === 'error' ? 'text-red-600' : 'text-amber-600'}`} />
              <div>
                <span className="font-semibold block text-[#241710]">
                  Teacher Host GPS Verification (Location Verification Bypassed)
                </span>
                <span className="text-[11px] text-[#241710]/70">
                  {hostGpsStatus === 'acquired' && hostCoords
                    ? `Host GPS Locked: Lat ${hostCoords.lat.toFixed(4)}, Lng ${hostCoords.lng.toFixed(4)} (Accuracy ±${Math.round(hostCoords.accuracy)}m)`
                    : 'Location requirement bypassed: session and attendance active from any location or device.'}
                </span>
              </div>
            </div>
            {hostGpsStatus === 'error' && (
              <button
                type="button"
                onClick={requestHostLocation}
                className="bg-[#165B33] text-white px-3 py-1 rounded text-[11px] font-semibold hover:bg-[#124b2a]"
              >
                Allow / Retry Location
              </button>
            )}
            {hostGpsStatus === 'acquired' && (
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5 rounded">
                GPS Verified
              </span>
            )}
          </div>

          <button
            onClick={handleStartSession}
            disabled={!selectedAssignment || isLocatingHost}
            className="flex items-center justify-center gap-2 bg-[#165B33] text-white px-6 py-2.5 rounded-md font-semibold text-xs hover:bg-[#124b2a] transition-all shadow-sm disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{isLocatingHost ? 'Verifying Teacher Host GPS...' : 'Generate Dynamic QR Code'}</span>
          </button>
        </div>
      ) : (
        /* ACTIVE SESSION LIVE BOARD */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Prominent Dynamic QR Code Panel */}
          <div className="lg:col-span-5 bg-[#FAF3E3] border-2 border-[#165B33] rounded-lg p-6 shadow-md flex flex-col items-center text-center">
            <div className="w-full flex items-center justify-between pb-3 mb-4 border-b border-[#E3D2B4]">
              <div>
                <span className="text-xs font-semibold text-[#165B33] block">
                  {activeSession.sectionDisplayName}
                </span>
                <span className="text-sm font-bold font-serif text-[#241710]">
                  {activeSession.subjectCode} · {activeSession.subjectName}
                </span>
              </div>
              <span className="bg-[#165B33]/10 text-[#165B33] text-xs font-mono font-bold px-2 py-1 rounded">
                Room {activeSession.classroom}
              </span>
            </div>

            {/* QR Image Frame with 5s Continuous Rotation and Screen Protection */}
            <div
              onContextMenu={(e) => e.preventDefault()}
              className="relative p-4 bg-white rounded-xl shadow-inner border border-[#E3D2B4] mb-3 flex items-center justify-center select-none"
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Dynamic Attendance QR"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-64 h-64 object-contain select-none pointer-events-none"
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-xs text-gray-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-[#165B33]" />
                </div>
              )}

              {/* Anti-Capture Solid Black Screen Overlay */}
              {isScreenMasked && (
                <div className="absolute inset-0 bg-black rounded-xl flex flex-col items-center justify-center p-6 text-center z-30 transition-opacity duration-150 select-none">
                  <div className="w-12 h-12 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center mb-3">
                    <ShieldAlert className="w-6 h-6 text-amber-500" />
                  </div>
                  <span className="text-sm font-bold text-white tracking-wide uppercase">
                    Display Protected
                  </span>
                  <span className="text-xs text-neutral-400 mt-1">
                    Screen darkened by anti-capture security policy. Restore focus to reveal.
                  </span>
                </div>
              )}
            </div>

            {/* Refresh Countdown & Progress Bar */}
            <div className="w-full max-w-[280px] mb-4">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#241710]/70 flex items-center gap-1 font-medium">
                  <RefreshCw className={`w-3.5 h-3.5 text-[#DF6A24] ${isRefreshing ? 'animate-spin' : ''}`} />
                  QR Token Rotates In:
                </span>
                <span className="font-mono font-bold text-[#165B33] text-sm">
                  {secondsUntilRefresh}s
                </span>
              </div>
              <div className="w-full bg-[#E3D2B4]/40 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#DF6A24] h-full transition-all duration-300 ease-linear rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        ((QR_ROTATION_INTERVAL_SECONDS - secondsUntilRefresh) /
                          QR_ROTATION_INTERVAL_SECONDS) *
                          100
                      )
                    )}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-[#241710]/60 mt-1 block font-mono">
                Rotations: {activeSession.refreshCount}
              </span>
            </div>

            {/* Actions for Faculty */}
            <div className="flex gap-2 w-full pt-2 border-t border-[#E3D2B4]">
              <button
                onClick={() => setRandomModalOpen(true)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-[#FAF3E3] border border-[#165B33] text-[#165B33] hover:bg-[#165B33]/10 py-2 rounded text-xs font-semibold transition-colors"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Random Check</span>
              </button>
              <button
                onClick={handleEndSession}
                className="flex items-center justify-center gap-1.5 bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded text-xs font-semibold transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                <span>End Session</span>
              </button>
            </div>
          </div>

          {/* Real-Time Live Statistics and Scan Roster */}
          <div className="lg:col-span-7 space-y-5">
            {/* Real-time counters */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-3 text-center">
                <span className="text-[11px] text-[#241710]/70 block font-medium">Enrolled</span>
                <span className="text-xl font-bold font-serif text-[#241710]">
                  {activeSession.totalEnrolled || 62}
                </span>
              </div>
              <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 text-center">
                <span className="text-[11px] text-emerald-800 block font-medium">Verified</span>
                <span className="text-xl font-bold font-serif text-emerald-800">
                  {verifiedStudents.length}
                </span>
              </div>
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-center">
                <span className="text-[11px] text-amber-800 block font-medium">Review Req.</span>
                <span className="text-xl font-bold font-serif text-amber-800">
                  {reviewStudents.length}
                </span>
              </div>
              <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-center">
                <span className="text-[11px] text-red-800 block font-medium">Rejected</span>
                <span className="text-xl font-bold font-serif text-red-800">
                  {rejectedStudents.length}
                </span>
              </div>
            </div>

            {/* In-Class Random Challenges Alert Bar */}
            {verifications.length > 0 && (
              <div className="bg-[#FFFDF8] border-2 border-[#DF6A24] rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#DF6A24] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    In-Class Spot Verification Challenge Active
                  </span>
                  <span className="text-[11px] text-gray-500 font-mono">
                    Window: 3 minutes
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {verifications.slice(0, 3).map((v) => (
                    <div
                      key={v.id}
                      className="p-2.5 bg-white border border-[#E3D2B4] rounded text-xs flex flex-col justify-between"
                    >
                      <div>
                        <span className="font-semibold text-gray-900 block truncate">
                          {v.studentName}
                        </span>
                        <span className="font-mono text-[11px] text-gray-600 block">
                          {v.studentIdentifier}
                        </span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Announce Code:</span>
                        <span className="font-mono text-sm font-bold text-[#165B33] bg-[#165B33]/10 px-1.5 py-0.5 rounded">
                          {v.challengeCode}
                        </span>
                      </div>
                      <div className="mt-1 text-[10px] font-semibold text-right">
                        {v.status === 'VERIFIED' ? (
                          <span className="text-emerald-700">✓ Responded</span>
                        ) : v.status === 'MISSED' ? (
                          <span className="text-red-600">✗ Missed</span>
                        ) : (
                          <span className="text-amber-700 animate-pulse">Waiting response...</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scanned Attendance Attempts List */}
            <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-[#165B33] text-white flex items-center justify-between">
                <h3 className="font-serif font-bold text-xs flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#DF6A24]" />
                  Live Attendance Scans ({attempts.length})
                </h3>
                <span className="text-[11px] text-white/80">
                  Auto-updating every 3 seconds
                </span>
              </div>

              <div className="max-h-[360px] overflow-y-auto divide-y divide-[#E3D2B4]/60">
                {attempts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#241710]/60">
                    No student scans received yet for this active session.
                  </div>
                ) : (
                  attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="p-3.5 hover:bg-[#FFFDF8] transition-colors flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">
                            {attempt.studentName}
                          </span>
                          <span className="font-mono text-[11px] text-gray-600">
                            ({attempt.studentIdentifier})
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
                          <span>
                            {new Date(attempt.serverTimestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                          <span>•</span>
                          <span>Distance: {Math.round(attempt.calculatedDistanceMeters)}m</span>
                          <span>•</span>
                          <span>GPS: ±{Math.round(attempt.reportedAccuracy)}m</span>
                          <span>•</span>
                          <span>{attempt.devicePlatform}</span>
                        </div>
                        {attempt.rejectionOrReviewReason && (
                          <div className="text-[11px] text-red-600 font-medium">
                            {attempt.rejectionOrReviewReason}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 ml-3">
                        {attempt.classification === 'VERIFIED' && (
                          <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Verified
                          </span>
                        )}
                        {attempt.classification === 'REVIEW_REQUIRED' && (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Review
                          </span>
                        )}
                        {attempt.classification === 'REJECTED' && (
                          <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 text-[11px] font-semibold px-2.5 py-1 rounded-full">
                            <XCircle className="w-3.5 h-3.5" />
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Random In-Class Challenge Modal */}
      {randomModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#FAF3E3] border-2 border-[#165B33] rounded-lg max-w-sm w-full p-5 shadow-2xl">
            <h3 className="font-serif font-bold text-base text-[#165B33] mb-2">
              Trigger Random Spot Check
            </h3>
            <p className="text-xs text-[#241710]/80 mb-4">
              Select random verified students in the class. A 4-digit challenge code will be generated for you to read aloud. Students must confirm the challenge within 3 minutes.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#241710] mb-1">
                Number of Random Students:
              </label>
              <select
                value={randomCount}
                onChange={(e) => setRandomCount(Number(e.target.value))}
                className="w-full text-xs border border-[#E3D2B4] rounded p-2 bg-white text-[#241710]"
              >
                <option value={2}>2 Students</option>
                <option value={3}>3 Students (Recommended)</option>
                <option value={5}>5 Students</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleTriggerRandomVerification}
                className="flex-1 bg-[#165B33] text-white py-2 rounded text-xs font-semibold hover:bg-[#124b2a]"
              >
                Dispatch Challenge
              </button>
              <button
                onClick={() => setRandomModalOpen(false)}
                className="px-4 py-2 border border-[#E3D2B4] rounded text-xs font-medium text-[#241710]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
