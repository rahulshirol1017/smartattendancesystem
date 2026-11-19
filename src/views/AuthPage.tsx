import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { VtuEmblemLogo } from '../components/VtuEmblemLogo.tsx';
import { AcademicSection } from '../shared/types.ts';
import { api } from '../api/client.ts';

interface AuthPageProps {
  initialMode?: 'login' | 'register';
  sections: AcademicSection[];
  institutionName?: string;
  onBackToHero: () => void;
  onLogin: (identifierOrEmail: string, password: string) => Promise<void>;
  onRegister: (payload: {
    name: string;
    identifier: string;
    email: string;
    password: string;
    college: string;
    programme: string;
    semester: number;
    sectionId?: string;
  }) => Promise<void>;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialMode = 'login',
  sections,
  institutionName = 'Department of CSE (CSBS) · VTU Campus, Belagavi',
  onBackToHero,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot_password'>(initialMode);
  const [loginMethod, setLoginMethod] = useState<'id' | 'email'>('id');

  const [identifierOrEmail, setIdentifierOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot Password state
  const [forgotStep, setForgotStep] = useState<'request_code' | 'verify_code' | 'set_new_password'>('request_code');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [showForgotNewPassword, setShowForgotNewPassword] = useState(false);
  const [showForgotConfirmPassword, setShowForgotConfirmPassword] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [regName, setRegName] = useState('');
  const [regUsn, setRegUsn] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [regCollege, setRegCollege] = useState('VTU Campus, Jnana Sangama, Belagavi');
  const [regSectionId, setRegSectionId] = useState(sections[0]?.id || '');
  const [regProgramme, setRegProgramme] = useState(
    sections[0]?.programme || 'B.Tech in Computer Science and Business Systems'
  );
  const [regSemester, setRegSemester] = useState(sections[0]?.semester || 5);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!regSectionId && sections.length > 0) {
      setRegSectionId(sections[0].id);
      setRegProgramme(sections[0].programme);
      setRegSemester(sections[0].semester);
    }
  }, [sections, regSectionId]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifierOrEmail.trim() || !password) {
      setError('Enter your USN / Staff ID or email and password.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onLogin(identifierOrEmail.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regUsn.trim() || !regEmail.trim()) {
      setError('Full name, USN, and university email address are required.');
      return;
    }
    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Password and confirm password do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onRegister({
        name: regName.trim(),
        identifier: regUsn.trim().toUpperCase(),
        email: regEmail.trim().toLowerCase(),
        password: regPassword,
        college: regCollege.trim(),
        programme: regProgramme.trim(),
        semester: Number(regSemester) || 5,
        sectionId: regSectionId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  };

  const handleRequestResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setError('Please enter your university USN or registered email address.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const res = await api.forgotPassword(forgotEmail.trim());
      setSuccessMsg(res.message);
      if ((res as any).devOtp) {
        setForgotOtp((res as any).devOtp);
      }
      setForgotStep('verify_code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request verification code.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotOtp.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      await api.verifyResetCode(forgotEmail.trim(), forgotOtp.trim());
      setSuccessMsg('Verification code confirmed! Now enter your new password.');
      setForgotStep('set_new_password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotNewPassword || !forgotConfirmPassword) {
      setError('Please enter and confirm your new password.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const res = await api.resetPassword({
        email: forgotEmail.trim(),
        code: forgotOtp.trim(),
        newPassword: forgotNewPassword,
        confirmPassword: forgotConfirmPassword,
      });
      setSuccessMsg(res.message);
      setTimeout(() => {
        setMode('login');
        setIdentifierOrEmail(forgotEmail.trim());
        setForgotStep('request_code');
        setForgotOtp('');
        setForgotNewPassword('');
        setForgotConfirmPassword('');
        setSuccessMsg('Password updated! You can now sign in with your new password.');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF3E3] text-[#241710]">
      <header className="h-16 bg-[#165B33] text-white border-b border-[#E3D2B4]">
        <div className="max-w-5xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={onBackToHero}
            className="inline-flex items-center gap-2 text-sm font-medium text-white/90 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-[#DF6A24]" />
            <span>Back</span>
          </button>

          <div className="inline-flex items-center gap-2.5 shrink-0">
            <VtuEmblemLogo size="sm" />
            <span className="font-display text-sm font-semibold text-white whitespace-nowrap">
              VTU Smart Attendance System
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 py-10">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-md border border-[#E3D2B4] bg-white overflow-hidden">
          <div className="lg:col-span-5 bg-[#165B33] text-white p-6 sm:p-8 flex flex-col justify-between space-y-8">
            <div className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-4">
              <VtuEmblemLogo size="lg" />
              <div className="space-y-1.5">
                <div className="font-display text-xl font-bold tracking-tight text-white">
                  Visvesvaraya Technological University
                </div>
                <div className="text-sm font-semibold text-[#DF6A24]">
                  Smart Attendance System
                </div>
              </div>
            </div>

            <div className="border-t border-white/15 pt-4 text-xs text-white/80 space-y-1">
              <div>{institutionName}</div>
              <div className="text-white/65">CSBS V-Semester Portal</div>
            </div>
          </div>

          <div className="lg:col-span-7 p-6 sm:p-8 lg:p-10 space-y-6 bg-[#FFFDF8]">
            <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-4">
              <h1 className="text-xl font-semibold text-[#165B33]">
                {mode === 'login'
                  ? 'Sign In'
                  : mode === 'register'
                  ? 'Student Registration'
                  : 'Reset Password'}
              </h1>

              <button
                type="button"
                onClick={() => {
                  setMode((prev) => (prev === 'login' ? 'register' : 'login'));
                  setError(null);
                  setSuccessMsg(null);
                }}
                className="text-xs font-semibold text-[#DF6A24] hover:underline whitespace-nowrap shrink-0"
              >
                {mode === 'login'
                  ? 'Create student account'
                  : 'Back to sign in'}
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded border border-[#B42318]/30 bg-[#B42318]/5 px-3.5 py-2.5 text-xs text-[#B42318]"
              >
                {error}
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="rounded border border-[#165B33]/30 bg-[#165B33]/10 px-3.5 py-2.5 text-xs text-[#165B33] font-medium flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-[#165B33] shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {mode === 'forgot_password' ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between text-xs border-b border-[#E3D2B4]/60 pb-3">
                  <div
                    className={`flex items-center gap-1.5 ${
                      forgotStep === 'request_code'
                        ? 'text-[#165B33] font-bold'
                        : 'text-[#6B5A4C]'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center border text-[11px] bg-white">
                      1
                    </span>
                    <span>Enter Email</span>
                  </div>
                  <div className="h-px w-8 bg-[#E3D2B4]" />
                  <div
                    className={`flex items-center gap-1.5 ${
                      forgotStep === 'verify_code'
                        ? 'text-[#165B33] font-bold'
                        : 'text-[#6B5A4C]'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center border text-[11px] bg-white">
                      2
                    </span>
                    <span>Verification Code</span>
                  </div>
                  <div className="h-px w-8 bg-[#E3D2B4]" />
                  <div
                    className={`flex items-center gap-1.5 ${
                      forgotStep === 'set_new_password'
                        ? 'text-[#165B33] font-bold'
                        : 'text-[#6B5A4C]'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center border text-[11px] bg-white">
                      3
                    </span>
                    <span>New Password</span>
                  </div>
                </div>

                {forgotStep === 'request_code' && (
                  <form onSubmit={handleRequestResetCode} className="space-y-4">
                    <p className="text-xs text-[#6B5A4C]">
                      Enter your university USN or registered email address. We will send a secure 6-digit verification code to reset your password.
                    </p>
                    <div>
                      <label htmlFor="forgot-email" className="block text-xs font-medium text-[#241710] mb-1.5">
                        USN or Registered Email Address
                      </label>
                      <div className="relative">
                        <input
                          id="forgot-email"
                          type="text"
                          required
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          placeholder="e.g. 2VX24CB069 or student@example.com"
                          className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-3.5 py-2.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                        />
                        <Mail className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-3" />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded bg-[#165B33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {busy ? 'Sending code…' : 'Send Verification Code'}
                    </button>
                  </form>
                )}

                {forgotStep === 'verify_code' && (
                  <form onSubmit={handleVerifyResetCode} className="space-y-4">
                    <p className="text-xs text-[#6B5A4C]">
                      A 6-digit verification code was sent to <strong className="text-[#241710]">{forgotEmail}</strong>. Please enter the code below (valid for 15 minutes).
                    </p>
                    <div>
                      <label htmlFor="forgot-otp" className="block text-xs font-medium text-[#241710] mb-1.5">
                        6-Digit Verification Code
                      </label>
                      <div className="relative">
                        <input
                          id="forgot-otp"
                          type="text"
                          maxLength={6}
                          required
                          value={forgotOtp}
                          onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, ''))}
                          placeholder="123456"
                          className="w-full tracking-widest text-center text-lg font-mono rounded border border-[#E3D2B4] bg-white px-3.5 py-2.5 text-[#241710] focus:border-[#165B33] focus:outline-none"
                        />
                        <ShieldCheck className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-3.5" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setForgotStep('request_code');
                          setError(null);
                        }}
                        className="rounded border border-[#E3D2B4] px-4 py-2.5 text-sm font-medium text-[#6B5A4C] hover:bg-[#FAF3E3] transition-colors"
                      >
                        Change Email
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="flex-1 rounded bg-[#165B33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors"
                      >
                        {busy ? 'Verifying…' : 'Verify Code'}
                      </button>
                    </div>
                  </form>
                )}

                {forgotStep === 'set_new_password' && (
                  <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                    <p className="text-xs text-[#6B5A4C]">
                      Create a strong new password for your account (minimum 8 characters).
                    </p>
                    <div>
                      <label htmlFor="forgot-new-password" className="block text-xs font-medium text-[#241710] mb-1.5">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          id="forgot-new-password"
                          type={showForgotNewPassword ? 'text' : 'password'}
                          required
                          value={forgotNewPassword}
                          onChange={(e) => setForgotNewPassword(e.target.value)}
                          placeholder="Enter new password (min. 8 characters)"
                          className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-10 py-2.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                        />
                        <KeyRound className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-3" />
                        <button
                          type="button"
                          onClick={() => setShowForgotNewPassword((prev) => !prev)}
                          aria-label={showForgotNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 px-3 text-[#6B5A4C] hover:text-[#241710]"
                        >
                          {showForgotNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="forgot-confirm-password" className="block text-xs font-medium text-[#241710] mb-1.5">
                        Confirm New Password
                      </label>
                      <div className="relative">
                        <input
                          id="forgot-confirm-password"
                          type={showForgotConfirmPassword ? 'text' : 'password'}
                          required
                          value={forgotConfirmPassword}
                          onChange={(e) => setForgotConfirmPassword(e.target.value)}
                          placeholder="Re-enter new password"
                          className="w-full rounded border border-[#E3D2B4] bg-white pl-9 pr-10 py-2.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                        />
                        <KeyRound className="w-4 h-4 text-[#6B5A4C] absolute left-3 top-3" />
                        <button
                          type="button"
                          onClick={() => setShowForgotConfirmPassword((prev) => !prev)}
                          aria-label={showForgotConfirmPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 px-3 text-[#6B5A4C] hover:text-[#241710]"
                        >
                          {showForgotConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full rounded bg-[#165B33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors"
                    >
                      {busy ? 'Updating Password…' : 'Reset Password'}
                    </button>
                  </form>
                )}

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-xs font-medium text-[#DF6A24] hover:underline"
                  >
                    Return to Sign In
                  </button>
                </div>
              </div>
            ) : mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-[#6B5A4C]">
                    Login method
                  </span>
                  <div className="grid grid-cols-2 gap-1 rounded bg-[#FAF3E3] p-1 border border-[#E3D2B4]">
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod('id');
                        setError(null);
                      }}
                      className={`rounded py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                        loginMethod === 'id'
                          ? 'bg-[#DF6A24] text-white'
                          : 'text-[#6B5A4C] hover:text-[#241710]'
                      }`}
                    >
                      USN / Staff ID
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLoginMethod('email');
                        setError(null);
                      }}
                      className={`rounded py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                        loginMethod === 'email'
                          ? 'bg-[#DF6A24] text-white'
                          : 'text-[#6B5A4C] hover:text-[#241710]'
                      }`}
                    >
                      University Email
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="unified-login-credential"
                    className="block text-xs font-medium text-[#241710] mb-1.5"
                  >
                    {loginMethod === 'id' ? 'USN or Staff ID' : 'University Email'}
                  </label>
                  <input
                    id="unified-login-credential"
                    type={loginMethod === 'email' ? 'email' : 'text'}
                    required
                    autoComplete="username"
                    value={identifierOrEmail}
                    onChange={(e) => setIdentifierOrEmail(e.target.value)}
                    placeholder={
                      loginMethod === 'id'
                        ? 'Enter USN or Staff ID'
                        : 'name@vtu.ac.in'
                    }
                    className="w-full rounded border border-[#E3D2B4] bg-white px-3.5 py-2.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="unified-login-password"
                      className="block text-xs font-medium text-[#241710]"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot_password');
                        setForgotStep('request_code');
                        setError(null);
                        setSuccessMsg(null);
                        if (identifierOrEmail.includes('@')) {
                          setForgotEmail(identifierOrEmail);
                        }
                      }}
                      className="text-xs font-medium text-[#DF6A24] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="unified-login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full rounded border border-[#E3D2B4] bg-white pl-3.5 pr-10 py-2.5 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 text-[#6B5A4C] hover:text-[#241710]"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded bg-[#165B33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Signing in…' : 'Sign In'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="reg-fullname"
                      className="block text-xs font-medium text-[#241710] mb-1"
                    >
                      Full Name
                    </label>
                    <input
                      id="reg-fullname"
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Full name"
                      className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-usn"
                      className="block text-xs font-medium text-[#241710] mb-1"
                    >
                      USN
                    </label>
                    <input
                      id="reg-usn"
                      type="text"
                      required
                      value={regUsn}
                      onChange={(e) => setRegUsn(e.target.value)}
                      placeholder="e.g., 2VX24CB010"
                      className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm uppercase font-mono focus:border-[#165B33] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label
                      htmlFor="reg-email"
                      className="block text-xs font-medium text-[#241710] mb-1"
                    >
                      University Email
                    </label>
                    <input
                      id="reg-email"
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="usn@vtu.ac.in"
                      className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-section"
                      className="block text-xs font-medium text-[#241710] mb-1"
                    >
                      Section
                    </label>
                    <select
                      id="reg-section"
                      value={regSectionId}
                      onChange={(e) => {
                        const secId = e.target.value;
                        setRegSectionId(secId);
                        const found = sections.find((s) => s.id === secId);
                        if (found) {
                          setRegProgramme(found.programme);
                          setRegSemester(found.semester);
                        }
                      }}
                      className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                    >
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName} (Sem {s.semester} · {s.defaultClassroom})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-pass"
                    className="block text-xs font-medium text-[#241710] mb-1"
                  >
                    Password (minimum 8 characters)
                  </label>
                  <div className="relative">
                    <input
                      id="reg-pass"
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Create password"
                      className="w-full rounded border border-[#E3D2B4] bg-white pl-3.5 pr-10 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword((prev) => !prev)}
                      aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 text-[#6B5A4C] hover:text-[#241710] flex items-center"
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-confirm-pass"
                    className="block text-xs font-medium text-[#241710] mb-1"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="reg-confirm-pass"
                      type={showRegConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="w-full rounded border border-[#E3D2B4] bg-white pl-3.5 pr-10 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegConfirmPassword((prev) => !prev)}
                      aria-label={showRegConfirmPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-3 text-[#6B5A4C] hover:text-[#241710] flex items-center"
                    >
                      {showRegConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded bg-[#165B33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors"
                  >
                    {busy ? 'Creating account…' : 'Create Account'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
