import React, { useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { VtuEmblemLogo } from '../components/VtuEmblemLogo.tsx';
import { AcademicSection } from '../shared/types.ts';

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
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [loginMethod, setLoginMethod] = useState<'id' | 'email'>('id');

  const [identifierOrEmail, setIdentifierOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [regName, setRegName] = useState('');
  const [regUsn, setRegUsn] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
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
                {mode === 'login' ? 'Sign In' : 'Student Registration'}
              </h1>

              <button
                type="button"
                onClick={() => {
                  setMode((prev) => (prev === 'login' ? 'register' : 'login'));
                  setError(null);
                }}
                className="text-xs font-semibold text-[#DF6A24] hover:underline whitespace-nowrap shrink-0"
              >
                {mode === 'login' ? 'Create student account' : 'Back to sign in'}
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

            {mode === 'login' ? (
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
                  <label
                    htmlFor="unified-login-password"
                    className="block text-xs font-medium text-[#241710] mb-1.5"
                  >
                    Password
                  </label>
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
                  <input
                    id="reg-pass"
                    type="password"
                    required
                    minLength={8}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create password"
                    className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm focus:border-[#165B33] focus:outline-none"
                  />
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
