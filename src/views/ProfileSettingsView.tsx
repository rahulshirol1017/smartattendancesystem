import React, { useState } from 'react';
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api/client.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import {
  CancelledClassPolicy,
  ExcusedAbsencePolicy,
  InstitutionalPolicy,
  SubjectItem,
  UserProfile,
} from '../shared/types.ts';

interface ProfileSettingsViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  storageMode: 'mongodb' | 'local_sandbox';
  subjects: SubjectItem[];
  cohortUsers: UserProfile[];
  onSwitchPortal: () => void;
  onRefreshWorkspace: () => Promise<void>;
}

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  user,
  policy,
  onSwitchPortal,
  onRefreshWorkspace,
}) => {
  const [minPct, setMinPct] = useState<number>(policy.defaultMinimumPercentage);
  const [bufferPct, setBufferPct] = useState<number>(policy.warningBufferPercentage);
  const [excusedPolicy, setExcusedPolicy] = useState<ExcusedAbsencePolicy>(
    policy.excusedAbsencePolicy
  );
  const [cancelledPolicy, setCancelledPolicy] = useState<CancelledClassPolicy>(
    policy.cancelledClassPolicy
  );
  const [allowFacultyExtra, setAllowFacultyExtra] = useState<boolean>(
    policy.allowFacultyExtraClassRequests
  );
  const [enforceRooms, setEnforceRooms] = useState<boolean>(policy.enforceRoomConflictCheck);

  const [saving, setSaving] = useState<boolean>(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordFeedback({
        type: 'error',
        text: 'All password fields are required.',
      });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordFeedback({
        type: 'error',
        text: 'New password must be at least 8 characters long.',
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({
        type: 'error',
        text: 'New password and confirm password do not match.',
      });
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordFeedback({
        type: 'error',
        text: 'New password must be different from your current password.',
      });
      return;
    }

    setPasswordChanging(true);
    try {
      const res = await api.changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setPasswordFeedback({
        type: 'success',
        text: res.message || 'Password changed successfully. Your account is secured with the new password.',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change password.',
      });
    } finally {
      setPasswordChanging(false);
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await api.updatePolicy({
        defaultMinimumPercentage: minPct,
        warningBufferPercentage: bufferPct,
        excusedAbsencePolicy: excusedPolicy,
        cancelledClassPolicy: cancelledPolicy,
        allowFacultyExtraClassRequests: allowFacultyExtra,
        enforceRoomConflictCheck: enforceRooms,
        evidenceRequiredForSubmission: true,
      });
      await onRefreshWorkspace();
      setFeedback({ type: 'success', text: 'Attendance policy updated.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update policy.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-[#165B33]">
          {user.role === 'admin' ? 'Settings' : 'Profile'}
        </h1>
        <p className="mt-1 text-sm text-[#6B5A4C]">{policy.institutionName}</p>
      </div>

      {feedback && (
        <div
          className={`rounded-md border px-4 py-3 text-sm bg-white ${
            feedback.type === 'success'
              ? 'border-[#165B33]/40 text-[#165B33]'
              : 'border-[#B42318]/40 text-[#B42318]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <section className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
          <h2 className="text-base font-semibold text-[#165B33]">Account Details</h2>
          <button
            type="button"
            onClick={onSwitchPortal}
            className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-1.5 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3]"
          >
            Switch account
          </button>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-[#6B5A4C]">Full Name</dt>
            <dd className="mt-0.5 font-medium text-[#241710]">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B5A4C]">
              {user.role === 'student' ? 'USN' : 'Staff ID'}
            </dt>
            <dd className="mt-0.5 font-mono text-xs text-[#241710]">{user.identifier}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B5A4C]">University Email</dt>
            <dd className="mt-0.5 text-[#241710]">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6B5A4C]">Department</dt>
            <dd className="mt-0.5 text-[#241710]">{user.department}</dd>
          </div>
          {user.role === 'student' && (
            <>
              <div>
                <dt className="text-xs text-[#6B5A4C]">Section</dt>
                <dd className="mt-0.5 font-medium text-[#241710]">
                  {user.sectionDisplayName || user.section}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#6B5A4C]">Semester</dt>
                <dd className="mt-0.5 text-[#241710]">
                  Semester {user.semester} ({user.academicYear || policy.academicYear})
                </dd>
              </div>
            </>
          )}
          {user.designation && (
            <div>
              <dt className="text-xs text-[#6B5A4C]">Designation</dt>
              <dd className="mt-0.5 text-[#241710]">{user.designation}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Change Password Section */}
      <section className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[#E3D2B4] pb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#165B33]" />
            <h2 className="text-base font-semibold text-[#165B33]">Change Password</h2>
          </div>
          <span className="text-xs text-[#6B5A4C] flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#165B33]" />
            Encrypted with bcrypt
          </span>
        </div>

        {passwordFeedback && (
          <div
            className={`rounded-md border px-4 py-3 text-sm flex items-start gap-2 ${
              passwordFeedback.type === 'success'
                ? 'border-[#165B33]/40 bg-[#EDF7ED] text-[#165B33]'
                : 'border-[#B42318]/40 bg-[#FDF2F2] text-[#B42318]'
            }`}
          >
            {passwordFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{passwordFeedback.text}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword} className="space-y-4 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
              Current Password
            </label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your existing password"
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] pr-10 focus:outline-none focus:ring-1 focus:ring-[#165B33]"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#6B5A4C] hover:text-[#241710]"
                aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] pr-10 focus:outline-none focus:ring-1 focus:ring-[#165B33]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#6B5A4C] hover:text-[#241710]"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] pr-10 focus:outline-none focus:ring-1 focus:ring-[#165B33]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-[#6B5A4C] hover:text-[#241710]"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {newPassword && (
            <div className="text-xs space-y-1">
              <div className={`flex items-center gap-1.5 ${newPassword.length >= 8 ? 'text-[#165B33]' : 'text-[#6B5A4C]'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                At least 8 characters long
              </div>
              {confirmPassword && (
                <div className={`flex items-center gap-1.5 ${newPassword === confirmPassword ? 'text-[#165B33]' : 'text-[#B42318]'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {newPassword === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                </div>
              )}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={passwordChanging || !currentPassword || !newPassword || !confirmPassword}
              className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50 transition-colors"
            >
              {passwordChanging ? 'Updating Password…' : 'Update Password'}
            </button>
          </div>
        </form>
      </section>

      {user.role !== 'admin' ? (
        <section className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-3">
          <h2 className="text-base font-semibold text-[#165B33]">VTU Attendance Standards</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-[#6B5A4C]">Minimum Requirement</dt>
              <dd className="mt-0.5 font-semibold text-[#165B33] tabular-nums">
                {policy.defaultMinimumPercentage}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[#6B5A4C]">Correction Mode</dt>
              <dd className="mt-0.5 font-medium text-[#241710]">Documentary Evidence Only</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6B5A4C]">Academic Session</dt>
              <dd className="mt-0.5 font-medium text-[#241710]">
                {policy.academicYear} · Sem {policy.semester}
              </dd>
            </div>
          </dl>
        </section>
      ) : (
        <form
          onSubmit={handleSavePolicy}
          className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4"
        >
          <h2 className="text-base font-semibold text-[#165B33]">VTU Attendance Policy</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Minimum Attendance (%)
              </label>
              <input
                type="number"
                min={50}
                max={100}
                value={minPct}
                onChange={(e) => setMinPct(Number(e.target.value))}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Borderline Margin (%)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={bufferPct}
                onChange={(e) => setBufferPct(Number(e.target.value))}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Verified Duty / Medical Rule
              </label>
              <select
                value={excusedPolicy}
                onChange={(e) => setExcusedPolicy(e.target.value as ExcusedAbsencePolicy)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                <option value="count_as_attended">Count as attended</option>
                <option value="exclude_from_conducted">Exclude from total classes</option>
                <option value="count_as_missed">Count as missed</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                Cancelled Class Rule
              </label>
              <select
                value={cancelledPolicy}
                onChange={(e) => setCancelledPolicy(e.target.value as CancelledClassPolicy)}
                className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710]"
              >
                <option value="exclude_from_conducted">Exclude from total classes</option>
                <option value="count_as_conducted">Include in total classes</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-1 text-sm text-[#241710]">
            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={allowFacultyExtra}
                onChange={(e) => setAllowFacultyExtra(e.target.checked)}
                className="rounded border-[#E3D2B4]"
              />
              <span>Allow faculty to schedule extra classes</span>
            </label>

            <label className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={enforceRooms}
                onChange={(e) => setEnforceRooms(e.target.checked)}
                className="rounded border-[#E3D2B4]"
              />
              <span>Enforce classroom clash validation</span>
            </label>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Policy'}
            </button>

            <button
              type="button"
              onClick={() => setConfirmResetOpen(true)}
              className="text-xs font-medium text-[#B42318] hover:underline"
            >
              Restore official CSBS 2026 seed
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmResetOpen}
        title="Restore official CSBS 2026 data?"
        description="This resets sections, faculty, timetable, and attendance records to the V-Semester CSBS 2026 timetable."
        confirmLabel="Restore CSBS Data"
        variant="danger"
        busy={saving}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={async () => {
          setSaving(true);
          try {
            await api.resetDemoData();
            await onRefreshWorkspace();
            setConfirmResetOpen(false);
            setFeedback({ type: 'success', text: 'CSBS 2026 semester data restored.' });
          } catch (err) {
            setFeedback({
              type: 'error',
              text: err instanceof Error ? err.message : 'Could not restore data.',
            });
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
};
