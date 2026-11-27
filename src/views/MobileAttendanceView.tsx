import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Camera,
  School,
  Clock,
  UserCheck,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { FacialVerification } from '../components/FacialVerification.tsx';
import {
  LivenessChallengeType,
  VerificationResult,
} from '../shared/types.ts';

interface MobileAttendanceViewProps {
  onGoToPortal?: () => void;
}

type AttendanceFlowState =
  | 'no_params'
  | 'validating_token'
  | 'validation_error'
  | 'verifying_face'
  | 'completed';

interface SessionInfo {
  id: string;
  subjectCode: string;
  subjectName: string;
  sectionDisplayName: string;
  facultyName: string;
  classroom?: string;
}

export const MobileAttendanceView: React.FC<MobileAttendanceViewProps> = ({
  onGoToPortal,
}) => {
  const [flowState, setFlowState] = useState<AttendanceFlowState>('validating_token');
  const [sessionId, setSessionId] = useState<string>('');
  const [qrToken, setQrToken] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [verificationSessionId, setVerificationSessionId] = useState<string>('');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [challengeType, setChallengeType] = useState<LivenessChallengeType>('BLINK_AND_HEAD_LEFT');
  const [challengeInstruction, setChallengeInstruction] = useState<string>('');

  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    studentName?: string;
    studentUsn?: string;
    sectionName?: string;
    subjectName?: string;
    subjectCode?: string;
    timestamp?: string;
    message?: string;
  } | null>(null);

  // Parse parameters from window.location.search and check for active verification session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sId = params.get('sessionId') || '';
    const token = params.get('token') || '';

    if (!sId) {
      setFlowState('no_params');
      return;
    }

    setSessionId(sId);

    // Check if an unexpired verification session exists in sessionStorage for this sessionId
    const storageKey = `vtu_attend_session_${sId}`;
    try {
      const storedJson = sessionStorage.getItem(storageKey);
      if (storedJson) {
        const stored = JSON.parse(storedJson);
        const age = Date.now() - (stored.claimedAt || 0);
        // Valid for up to 4.5 minutes (backend allows 5 minutes)
        if (stored.verificationSessionId && stored.sessionToken && age < 4.5 * 60 * 1000) {
          setVerificationSessionId(stored.verificationSessionId);
          setSessionToken(stored.sessionToken);
          setChallengeType(stored.challengeType || 'BLINK_AND_HEAD_LEFT');
          setChallengeInstruction(
            stored.challengeInstruction || 'Look straight at the camera and blink once naturally.'
          );
          setSessionInfo(stored.sessionInfo);
          setFlowState('verifying_face');
          return;
        } else {
          sessionStorage.removeItem(storageKey);
        }
      }
    } catch {
      // Ignore storage read error
    }

    if (!token) {
      // No active stored session and no token provided in URL
      setFlowState('no_params');
      return;
    }

    setQrToken(token);
    claimAndValidateSession(sId, token);
  }, []);

  const claimAndValidateSession = async (sId: string, token: string) => {
    setFlowState('validating_token');
    setErrorMessage('');

    try {
      const ua = navigator.userAgent;
      const isIOS = /iPhone|iPad|iPod/i.test(ua);
      const isAndroid = /Android/i.test(ua);
      const platform = isIOS
        ? 'Apple iOS'
        : isAndroid
        ? 'Google Android'
        : 'Mobile Browser';
      const browser = ua.includes('Chrome')
        ? 'Chrome Mobile'
        : ua.includes('Safari')
        ? 'Safari Mobile'
        : 'Standard Mobile Browser';

      let fingerprint = localStorage.getItem('vtu_device_fp');
      if (!fingerprint) {
        fingerprint = 'dev-' + Math.random().toString(36).substring(2, 12);
        localStorage.setItem('vtu_device_fp', fingerprint);
      }

      const res = await api.validatePublicQrScan({
        sessionId: sId,
        qrToken: token,
        deviceFingerprint: fingerprint,
        devicePlatform: platform,
        browserName: browser,
      });

      if (!res.success) {
        setFlowState('validation_error');
        setErrorMessage(res.message || 'The scanned QR code has expired or is invalid. Please scan the current code.');
        return;
      }

      setVerificationSessionId(res.verificationSessionId);
      setSessionToken(res.sessionToken);
      const challenge = res.challengeType || 'BLINK_AND_HEAD_LEFT';
      const instruction =
        res.challengeInstruction || 'Look straight at the camera and blink once naturally.';
      setChallengeType(challenge);
      setChallengeInstruction(instruction);
      setSessionInfo(res.sessionInfo);

      // Persist to sessionStorage so page refreshes retain the 5-minute session
      try {
        sessionStorage.setItem(
          `vtu_attend_session_${sId}`,
          JSON.stringify({
            verificationSessionId: res.verificationSessionId,
            sessionToken: res.sessionToken,
            sessionInfo: res.sessionInfo,
            challengeType: challenge,
            challengeInstruction: instruction,
            claimedAt: Date.now(),
          })
        );
        // Clean expired 5-second qrToken from URL search so refresh doesn't re-submit it
        const cleanUrl = `${window.location.pathname}?sessionId=${encodeURIComponent(sId)}`;
        window.history.replaceState(null, '', cleanUrl);
      } catch {
        // Ignore storage write error
      }

      setFlowState('verifying_face');
    } catch (err) {
      setFlowState('validation_error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not connect to the attendance server. Please check your internet connection.'
      );
    }
  };

  const handleFacialVerificationComplete = useCallback(
    (result: VerificationResult) => {
      if (result.verificationStatus === 'VERIFIED') {
        // Clear active session from sessionStorage once attendance is recorded
        try {
          if (sessionId) {
            sessionStorage.removeItem(`vtu_attend_session_${sessionId}`);
          }
        } catch {
          // Ignore
        }
        const studentName =
          result.attempt?.studentName ||
          (result as any).student?.name ||
          (result as any).studentName ||
          'Verified Student';
        const studentUsn =
          result.studentId && result.studentId !== 'AUTO_IDENTIFY'
            ? result.studentId
            : result.attempt?.studentIdentifier ||
              (result as any).student?.identifier ||
              (result as any).matchedUsn ||
              'USN Confirmed';

        setVerificationResult({
          success: true,
          studentName,
          studentUsn,
          sectionName:
            result.attempt?.sectionDisplayName ||
            sessionInfo?.sectionDisplayName ||
            'CSBS B',
          subjectName: result.attempt?.subjectName || sessionInfo?.subjectName || 'Course Attendance',
          subjectCode: result.attempt?.subjectCode || sessionInfo?.subjectCode || 'VTU',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: 'Attendance verified and marked PRESENT.',
        });
        setFlowState('completed');
      } else {
        setVerificationResult({
          success: false,
          message:
            result.failureReason ||
            'No User Found: Facial recognition could not verify an authorized student identity.',
        });
        setFlowState('completed');
      }
    },
    [sessionInfo]
  );

  return (
    <div className="min-h-screen bg-[#FAF3E3] text-[#241710] flex flex-col items-center justify-between p-3 sm:p-5 font-sans">
      {/* Minimal Header */}
      <header className="w-full max-w-md flex items-center justify-between py-2 border-b border-[#E3D2B4]/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#165B33] flex items-center justify-center text-white font-serif font-bold text-xs shadow-xs">
            VTU
          </div>
          <div>
            <div className="text-xs font-bold text-[#165B33] tracking-wide uppercase">
              VTU Smart Attendance
            </div>
            <div className="text-[10px] text-[#6B5A4C]">
              Contactless Biometric Verification
            </div>
          </div>
        </div>

        {sessionInfo && (
          <div className="text-right">
            <span className="inline-block text-[11px] font-bold font-mono text-[#165B33] bg-white px-2 py-0.5 rounded border border-[#E3D2B4]">
              {sessionInfo.subjectCode} · {sessionInfo.sectionDisplayName}
            </span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-md my-auto py-3">
        {/* STATE 1: Missing Parameters (Direct visit without QR scan) */}
        {flowState === 'no_params' && (
          <div className="bg-white rounded-2xl border border-[#E3D2B4] p-6 shadow-sm text-center space-y-4 animate-in fade-in duration-200">
            <div className="w-16 h-16 rounded-full bg-[#FAF3E3] border-2 border-[#165B33] flex items-center justify-center mx-auto text-[#165B33]">
              <Camera className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-base font-serif font-bold text-[#165B33]">
                Scan Classroom Attendance QR
              </h2>
              <p className="text-xs text-[#6B5A4C] mt-2 leading-relaxed">
                Open your phone’s normal camera (iPhone Camera, Android Camera, or Google Lens) and point it at the live dynamic QR code on the classroom screen.
              </p>
            </div>

            <div className="bg-[#FAF3E3] rounded-lg p-3 text-left border border-[#E3D2B4]/60 text-xs text-[#6B5A4C] space-y-1">
              <div className="font-semibold text-[#165B33]">Automatic Attendance:</div>
              <p>• No login or password required.</p>
              <p>• Front camera opens automatically for facial identification.</p>
              <p>• Real-time blink verification confirms natural presence.</p>
            </div>
          </div>
        )}

        {/* STATE 2: Validating Initial Scanned QR Token */}
        {flowState === 'validating_token' && (
          <div className="bg-white rounded-2xl border border-[#E3D2B4] p-8 shadow-sm text-center space-y-3 animate-in fade-in duration-200">
            <RefreshCw className="w-10 h-10 text-[#DF6A24] animate-spin mx-auto" />
            <div>
              <h3 className="text-sm font-semibold text-[#165B33]">
                Connecting to Session...
              </h3>
              <p className="text-xs text-[#6B5A4C] mt-1">
                Validating QR code and starting camera.
              </p>
            </div>
          </div>
        )}

        {/* STATE 3: Validation Error (Expired / Mismatched QR) */}
        {flowState === 'validation_error' && (
          <div className="bg-white rounded-2xl border border-[#B42318]/30 p-6 shadow-sm text-center space-y-4 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-full bg-[#FDF2F2] border border-[#B42318]/20 flex items-center justify-center mx-auto text-[#B42318]">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-serif font-bold text-[#B42318]">
                QR Code Expired or Invalid
              </h3>
              <p className="text-xs text-[#6B5A4C] mt-2 leading-relaxed">
                {errorMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (sessionId) {
                  try {
                    sessionStorage.removeItem(`vtu_attend_session_${sessionId}`);
                  } catch {
                    // Ignore
                  }
                }
                if (qrToken) {
                  claimAndValidateSession(sessionId, qrToken);
                } else {
                  setFlowState('no_params');
                }
              }}
              className="w-full py-2.5 px-4 bg-[#DF6A24] hover:bg-[#c95b1b] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{qrToken ? 'Retry Scan' : 'Scan Live QR Code'}</span>
            </button>
          </div>
        )}

        {/* STATE 4: Front Camera Automatic Facial Recognition & Blink Liveness */}
        {flowState === 'verifying_face' && (
          <div className="w-full space-y-3 animate-in fade-in duration-200">
            {/* Minimal Attendance Interface: Large Live Camera Feed with Oval & Landmarks */}
            <FacialVerification
              isOpen={true}
              studentId="AUTO_IDENTIFY"
              verificationSessionId={verificationSessionId}
              sessionToken={sessionToken}
              qrSessionId={sessionId}
              challengeType={challengeType}
              challengeInstruction={challengeInstruction}
              onComplete={handleFacialVerificationComplete}
              onCancel={() => {
                if (sessionId) {
                  try {
                    sessionStorage.removeItem(`vtu_attend_session_${sessionId}`);
                  } catch {
                    // Ignore
                  }
                }
                setFlowState('no_params');
              }}
            />
          </div>
        )}

        {/* STATE 5: Completed Verification (Success or Rejection) */}
        {flowState === 'completed' && verificationResult && (
          <div className="w-full space-y-3 animate-in zoom-in-95 duration-200">
            {verificationResult.success ? (
              <div className="bg-white rounded-2xl border-2 border-[#165B33] p-6 shadow-md text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-[#EDF7ED] border-2 border-[#165B33] flex items-center justify-center mx-auto text-[#165B33]">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EDF7ED] text-[#165B33] mb-1.5">
                    PRESENT
                  </div>
                  <h2 className="text-lg font-serif font-bold text-[#165B33]">
                    Attendance Marked!
                  </h2>
                </div>

                <div className="bg-[#FAF3E3] rounded-xl p-4 border border-[#E3D2B4] text-left text-xs space-y-2.5">
                  <div className="flex justify-between items-center border-b border-[#E3D2B4]/80 pb-2">
                    <span className="text-[#6B5A4C]">Student Name</span>
                    <span className="font-bold text-[#241710] text-sm">
                      {verificationResult.studentName}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-[#E3D2B4]/80 pb-2">
                    <span className="text-[#6B5A4C]">USN</span>
                    <span className="font-mono font-bold text-[#165B33] text-sm">
                      {verificationResult.studentUsn}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-[#E3D2B4]/80 pb-2">
                    <span className="text-[#6B5A4C]">Subject</span>
                    <span className="font-semibold text-[#241710]">
                      {verificationResult.subjectCode} · {verificationResult.subjectName}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-b border-[#E3D2B4]/80 pb-2">
                    <span className="text-[#6B5A4C]">Section</span>
                    <span className="font-semibold text-[#241710]">
                      {verificationResult.sectionName}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#6B5A4C] flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Timestamp
                    </span>
                    <span className="font-mono text-[#241710] font-medium">
                      {verificationResult.timestamp}
                    </span>
                  </div>
                </div>

                <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-2.5 text-[11px] text-emerald-800 flex items-center justify-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Recorded permanently in VTU academic database</span>
                </div>

                <div className="text-[11px] text-[#6B5A4C]">
                  You may now safely close this browser window.
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border-2 border-[#B42318] p-6 shadow-md text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-[#FDF2F2] border-2 border-[#B42318] flex items-center justify-center mx-auto text-[#B42318]">
                  <AlertTriangle className="w-9 h-9" />
                </div>
                <div>
                  <div className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FDF2F2] text-[#B42318] mb-1.5">
                    VERIFICATION REJECTED
                  </div>
                  <h2 className="text-lg font-serif font-bold text-[#B42318]">
                    Attendance Not Marked
                  </h2>
                  <p className="text-xs text-[#6B5A4C] mt-2 leading-relaxed">
                    {verificationResult.message}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (sessionId && qrToken) {
                      claimAndValidateSession(sessionId, qrToken);
                    } else {
                      setFlowState('no_params');
                    }
                  }}
                  className="w-full py-2.5 px-4 bg-[#DF6A24] hover:bg-[#c95b1b] text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Minimal Footer */}
      <footer className="w-full max-w-md py-2 text-center text-[10px] text-[#8C7A6B]">
        Visvesvaraya Technological University · Belagavi
      </footer>
    </div>
  );
};
