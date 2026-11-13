import React, { useEffect, useState } from 'react';
import {
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  RotateCcw,
  Check,
  X,
  Clock,
  Radio,
  Sliders,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';
import { api } from '../api/client.ts';
import {
  AttendanceSubmissionAttempt,
  InstitutionalPolicy,
  QRAttendanceSession,
  StudentDeviceBinding,
  UserProfile,
} from '../shared/types.ts';

interface AdminAttendanceMonitoringViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  onPolicyUpdated: (updated: InstitutionalPolicy) => void;
}

export const AdminAttendanceMonitoringView: React.FC<AdminAttendanceMonitoringViewProps> = ({
  user: _user,
  policy,
  onPolicyUpdated,
}) => {
  void _user;
  const [activeTab, setActiveTab] = useState<'monitoring' | 'geofence' | 'devices' | 'audit'>(
    'monitoring'
  );

  const [activeSessions, setActiveSessions] = useState<QRAttendanceSession[]>([]);
  const [recentSessions, setRecentSessions] = useState<QRAttendanceSession[]>([]);
  const [attempts, setAttempts] = useState<AttendanceSubmissionAttempt[]>([]);
  const [deviceBindings, setDeviceBindings] = useState<StudentDeviceBinding[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Geofence configuration form state
  const [campusLat, setCampusLat] = useState<number>(policy.campusLatitude || 15.8858);
  const [campusLng, setCampusLng] = useState<number>(policy.campusLongitude || 74.5298);
  const [permittedRadius, setPermittedRadius] = useState<number>(
    policy.permittedRadiusMeters || 350
  );
  const [teacherHostRadius, setTeacherHostRadius] = useState<number>(
    policy.teacherHostRadiusMeters || 50
  );
  const [maxAccuracy, setMaxAccuracy] = useState<number>(
    policy.maxAcceptableGpsAccuracyMeters || 80
  );
  const [qrRefreshSec, setQrRefreshSec] = useState<number>(policy.qrRefreshSeconds || 5);
  const [sessionDurationMin, setSessionDurationMin] = useState<number>(
    policy.defaultSessionDurationMinutes || 5
  );
  const [randomWindowMin, setRandomWindowMin] = useState<number>(
    policy.randomVerificationWindowMinutes || 3
  );
  const [enforceDevice, setEnforceDevice] = useState<boolean>(
    policy.enforceDeviceRegistration ?? true
  );

  const [configSuccessMessage, setConfigSuccessMessage] = useState<string | null>(null);
  const [configErrorMessage, setConfigErrorMessage] = useState<string | null>(null);

  // Search / filter for attempts and devices
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [classificationFilter, setClassificationFilter] = useState<string>('ALL');

  const loadMonitoringData = async () => {
    setRefreshing(true);
    try {
      const data = await api.getAdminQrMonitoring();
      setActiveSessions(data.activeSessions);
      setRecentSessions(data.recentSessions);
      setAttempts(data.attempts);
      setDeviceBindings(data.deviceBindings);
    } catch (err) {
      console.error('Failed to load admin QR monitoring data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadMonitoringData();
    const interval = setInterval(loadMonitoringData, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigSuccessMessage(null);
    setConfigErrorMessage(null);

    try {
      const res = await api.updateCampusLocationPolicy({
        campusLatitude: campusLat,
        campusLongitude: campusLng,
        permittedRadiusMeters: permittedRadius,
        teacherHostRadiusMeters: teacherHostRadius,
        maxAcceptableGpsAccuracyMeters: maxAccuracy,
        qrRefreshSeconds: qrRefreshSec,
        defaultSessionDurationMinutes: sessionDurationMin,
        randomVerificationWindowMinutes: randomWindowMin,
        enforceDeviceRegistration: enforceDevice,
      });

      onPolicyUpdated(res.policy);
      setConfigSuccessMessage('Campus GPS perimeter and QR security policies updated successfully.');
    } catch (err) {
      setConfigErrorMessage(
        err instanceof Error ? err.message : 'Failed to save campus configuration.'
      );
    }
  };

  const handleReviewDevice = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      const res = await api.reviewDeviceBinding(id, status);
      setDeviceBindings((prev) => prev.map((d) => (d.id === id ? res.binding : d)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update device status.');
    }
  };

  const handleResetDevice = async (studentId: string) => {
    if (!confirm('Are you sure you want to reset this student’s bound device registration?')) return;
    try {
      await api.resetDeviceBinding(studentId);
      setDeviceBindings((prev) => prev.filter((d) => d.studentId !== studentId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset device.');
    }
  };

  const filteredAttempts = attempts.filter((a) => {
    if (classificationFilter !== 'ALL' && a.classification !== classificationFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.studentName.toLowerCase().includes(q) ||
      a.studentIdentifier.toLowerCase().includes(q) ||
      a.subjectCode.toLowerCase().includes(q) ||
      a.sectionDisplayName.toLowerCase().includes(q) ||
      a.devicePlatform.toLowerCase().includes(q)
    );
  });

  const suspiciousAttempts = attempts.filter(
    (a) => a.classification === 'REVIEW_REQUIRED' || a.classification === 'REJECTED'
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Radio className="w-4 h-4 text-[#DF6A24] animate-pulse" />
            <h1 className="text-xl font-serif font-bold text-[#165B33]">
              Attendance Monitoring & Anti-Proxy Console
            </h1>
          </div>
          <p className="text-xs text-[#241710]/80">
            Real-time surveillance of dynamic QR sessions, GPS geofencing radius, device bindings, and suspicious proxy signals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadMonitoringData}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FAF3E3] border border-[#165B33] text-[#165B33] rounded text-xs font-semibold hover:bg-[#165B33]/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Feed</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-[#E3D2B4] gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'monitoring'
              ? 'border-[#165B33] text-[#165B33]'
              : 'border-transparent text-[#241710]/60 hover:text-[#241710]'
          }`}
        >
          Live Sessions & Roster ({activeSessions.length})
        </button>
        <button
          onClick={() => setActiveTab('geofence')}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'geofence'
              ? 'border-[#165B33] text-[#165B33]'
              : 'border-transparent text-[#241710]/60 hover:text-[#241710]'
          }`}
        >
          Campus Geofence Configuration
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'audit'
              ? 'border-[#165B33] text-[#165B33]'
              : 'border-transparent text-[#241710]/60 hover:text-[#241710]'
          }`}
        >
          Anti-Proxy Logs ({suspiciousAttempts.length} Flagged)
        </button>
        <button
          onClick={() => setActiveTab('devices')}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'devices'
              ? 'border-[#165B33] text-[#165B33]'
              : 'border-transparent text-[#241710]/60 hover:text-[#241710]'
          }`}
        >
          Device Registrations ({deviceBindings.length})
        </button>
      </div>

      {/* TAB 1: LIVE SESSIONS MONITORING */}
      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          {/* Active Sessions Card Grid */}
          <div>
            <h2 className="font-serif font-bold text-sm text-[#165B33] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
              Active Classroom Sessions
            </h2>

            {activeSessions.length === 0 ? (
              <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-6 text-center text-xs text-[#241710]/70">
                No active QR attendance sessions currently running on campus.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className="bg-[#FAF3E3] border-2 border-[#165B33] rounded-lg p-4 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-xs font-semibold text-[#165B33] block">
                          {session.sectionDisplayName} · {session.subjectCode}
                        </span>
                        <h3 className="font-serif font-bold text-sm text-[#241710]">
                          {session.subjectName}
                        </h3>
                        <span className="text-[11px] text-gray-600 block mt-0.5">
                          Faculty: {session.facultyName} · Classroom: {session.classroom}
                        </span>
                      </div>
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                        Active
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-[#E3D2B4]">
                      <div className="bg-white/80 p-1.5 rounded border border-[#E3D2B4]">
                        <span className="text-[10px] text-gray-500 block">Verified</span>
                        <span className="font-bold text-emerald-700 text-sm">
                          {session.verifiedCount}
                        </span>
                      </div>
                      <div className="bg-white/80 p-1.5 rounded border border-[#E3D2B4]">
                        <span className="text-[10px] text-gray-500 block">Review</span>
                        <span className="font-bold text-amber-700 text-sm">
                          {session.reviewRequiredCount}
                        </span>
                      </div>
                      <div className="bg-white/80 p-1.5 rounded border border-[#E3D2B4]">
                        <span className="text-[10px] text-gray-500 block">Rejected</span>
                        <span className="font-bold text-red-700 text-sm">
                          {session.rejectedCount}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical / Recent Sessions Table */}
          <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
            <div className="px-4 py-3 bg-[#165B33] text-white flex items-center justify-between">
              <h3 className="font-serif font-bold text-xs">Recent Concluded Sessions</h3>
              <span className="text-[11px] text-white/80">
                Last 20 sessions campus-wide
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#241710]">
                <thead className="bg-[#E3D2B4]/40 font-semibold border-b border-[#E3D2B4]">
                  <tr>
                    <th className="p-3">Section</th>
                    <th className="p-3">Subject</th>
                    <th className="p-3">Faculty</th>
                    <th className="p-3">Date & Time</th>
                    <th className="p-3">Verified</th>
                    <th className="p-3">Review</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3D2B4]/50">
                  {recentSessions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-gray-500">
                        No session records found.
                      </td>
                    </tr>
                  ) : (
                    recentSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-white/40">
                        <td className="p-3 font-semibold">{s.sectionDisplayName}</td>
                        <td className="p-3">
                          <span className="font-medium">{s.subjectCode}</span> - {s.subjectName}
                        </td>
                        <td className="p-3">{s.facultyName}</td>
                        <td className="p-3 font-mono text-[11px]">
                          {s.date} {s.startTime}
                        </td>
                        <td className="p-3 text-emerald-700 font-bold">{s.verifiedCount}</td>
                        <td className="p-3 text-amber-700 font-bold">{s.reviewRequiredCount}</td>
                        <td className="p-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              s.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-200 text-gray-800'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CAMPUS GEOFENCE CONFIGURATION */}
      {activeTab === 'geofence' && (
        <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-6 shadow-sm max-w-3xl">
          <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E3D2B4]">
            <MapPin className="w-5 h-5 text-[#165B33]" />
            <div>
              <h2 className="font-serif font-bold text-base text-[#165B33]">
                Campus Coordinates & Geofencing Perimeter
              </h2>
              <p className="text-xs text-[#241710]/80">
                Configured for VTU Headquarters, Jnana Sangama Campus, Belagavi, Karnataka.
              </p>
            </div>
          </div>

          {configSuccessMessage && (
            <div className="bg-emerald-50 border border-emerald-300 rounded p-3 text-xs text-emerald-800 mb-4">
              {configSuccessMessage}
            </div>
          )}
          {configErrorMessage && (
            <div className="bg-red-50 border border-red-300 rounded p-3 text-xs text-red-800 mb-4">
              {configErrorMessage}
            </div>
          )}

          <form onSubmit={handleSavePolicy} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Campus Latitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={campusLat}
                  onChange={(e) => setCampusLat(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Default VTU Belagavi: 15.885800
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Campus Longitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={campusLng}
                  onChange={(e) => setCampusLng(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Default VTU Belagavi: 74.529800
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Teacher Host Radius (Meters)
                </label>
                <input
                  type="number"
                  min={5}
                  max={500}
                  step={1}
                  value={teacherHostRadius}
                  onChange={(e) => setTeacherHostRadius(Number(e.target.value))}
                  className="w-full text-xs border border-[#165B33] font-bold rounded p-2.5 bg-white text-[#165B33] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Dynamic host limit: student must be within configured proximity (e.g. 50m) from teacher host device.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Permitted Campus Radius (Meters)
                </label>
                <input
                  type="number"
                  value={permittedRadius}
                  onChange={(e) => setPermittedRadius(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Secondary campus geofence limit (e.g. 350m).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Max Acceptable GPS Accuracy (Meters)
                </label>
                <input
                  type="number"
                  value={maxAccuracy}
                  onChange={(e) => setMaxAccuracy(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Rejects readings with loose or spoofed GPS precision (e.g. 80m).
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#E3D2B4]">
              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  QR Refresh Interval (Seconds)
                </label>
                <input
                  type="number"
                  min={5}
                  value={qrRefreshSec}
                  onChange={(e) => setQrRefreshSec(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
                <span className="text-[10px] text-gray-500 block mt-1">
                  Dynamic QR rotation interval (default 5 seconds).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Default Session Duration (Mins)
                </label>
                <input
                  type="number"
                  value={sessionDurationMin}
                  onChange={(e) => setSessionDurationMin(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#241710] mb-1">
                  Spot Check Window (Mins)
                </label>
                <input
                  type="number"
                  value={randomWindowMin}
                  onChange={(e) => setRandomWindowMin(Number(e.target.value))}
                  className="w-full text-xs border border-[#E3D2B4] rounded p-2.5 bg-white text-[#241710] font-mono focus:ring-1 focus:ring-[#165B33] focus:outline-none"
                  required
                />
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <input
                type="checkbox"
                id="enforceDevice"
                checked={enforceDevice}
                onChange={(e) => setEnforceDevice(e.target.checked)}
                className="rounded border-[#E3D2B4] text-[#165B33] focus:ring-[#165B33]"
              />
              <label htmlFor="enforceDevice" className="text-xs font-medium text-[#241710]">
                Strict Device Registration (Flags secondary devices or multiple accounts on 1 device)
              </label>
            </div>

            <div className="pt-4 border-t border-[#E3D2B4] flex justify-end">
              <button
                type="submit"
                className="bg-[#165B33] text-white px-6 py-2 rounded text-xs font-semibold hover:bg-[#124b2a] transition-colors"
              >
                Save Geofence & QR Configuration
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: ANTI-PROXY ACTIVITY LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Filter by USN, student name, course..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs border border-[#E3D2B4] rounded p-2 bg-white text-[#241710]"
              />
            </div>

            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={classificationFilter}
                onChange={(e) => setClassificationFilter(e.target.value)}
                className="text-xs border border-[#E3D2B4] rounded p-2 bg-white text-[#241710]"
              >
                <option value="ALL">All Classifications</option>
                <option value="VERIFIED">Verified Only</option>
                <option value="REVIEW_REQUIRED">Review Required</option>
                <option value="REJECTED">Rejected Only</option>
              </select>
            </div>
          </div>

          <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#241710]">
                <thead className="bg-[#E3D2B4]/40 font-semibold border-b border-[#E3D2B4]">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Student</th>
                    <th className="p-3">Section & Subject</th>
                    <th className="p-3">Distance & Accuracy</th>
                    <th className="p-3">Device / Platform</th>
                    <th className="p-3">Classification</th>
                    <th className="p-3">Detection Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3D2B4]/50">
                  {filteredAttempts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-gray-500">
                        No attendance attempts matching filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredAttempts.map((attempt) => (
                      <tr key={attempt.id} className="hover:bg-white/40">
                        <td className="p-3 font-mono text-[11px]">
                          {new Date(attempt.serverTimestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="p-3">
                          <span className="font-semibold block">{attempt.studentName}</span>
                          <span className="font-mono text-[11px] text-gray-600 block">
                            {attempt.studentIdentifier}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="block">{attempt.sectionDisplayName}</span>
                          <span className="text-[11px] text-gray-500 block">
                            {attempt.subjectCode}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-[11px]">
                          <div>
                            {attempt.calculatedHostDistanceMeters !== undefined && (
                              <span className="font-semibold text-[#165B33] block">
                                Host: {Math.round(attempt.calculatedHostDistanceMeters * 10) / 10}m
                              </span>
                            )}
                            <span className="text-gray-600">
                              Campus: {Math.round(attempt.calculatedDistanceMeters)}m
                            </span>
                            <span className="text-gray-400 ml-1">
                              (±{Math.round(attempt.reportedAccuracy)}m)
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-[11px] text-gray-700">
                          {attempt.devicePlatform}
                        </td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              attempt.classification === 'VERIFIED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : attempt.classification === 'REVIEW_REQUIRED'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {attempt.classification}
                          </span>
                        </td>
                        <td className="p-3 max-w-[220px]">
                          {attempt.suspiciousSignals && attempt.suspiciousSignals.length > 0 ? (
                            <div className="space-y-0.5">
                              {attempt.suspiciousSignals.map((sig, idx) => (
                                <span
                                  key={idx}
                                  className="text-[10px] font-mono text-red-700 block truncate"
                                  title={sig}
                                >
                                  • {sig}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-400 text-[11px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: STUDENT DEVICE REGISTRATIONS */}
      {activeTab === 'devices' && (
        <div className="bg-[#FAF3E3] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
          <div className="px-4 py-3 bg-[#165B33] text-white flex items-center justify-between">
            <h3 className="font-serif font-bold text-xs flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#DF6A24]" />
              Authorized Student Hardware Registry
            </h3>
            <span className="text-[11px] text-white/80">
              Single-Device Institutional Binding
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#241710]">
              <thead className="bg-[#E3D2B4]/40 font-semibold border-b border-[#E3D2B4]">
                <tr>
                  <th className="p-3">Student</th>
                  <th className="p-3">USN</th>
                  <th className="p-3">Hardware Fingerprint</th>
                  <th className="p-3">Platform</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Verified</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3D2B4]/50">
                {deviceBindings.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-gray-500">
                      No registered student devices in database.
                    </td>
                  </tr>
                ) : (
                  deviceBindings.map((device) => (
                    <tr key={device.id} className="hover:bg-white/40">
                      <td className="p-3 font-semibold">{device.studentName}</td>
                      <td className="p-3 font-mono text-[11px]">{device.studentIdentifier}</td>
                      <td className="p-3 font-mono text-[10px] text-gray-700 truncate max-w-[180px]">
                        {device.deviceFingerprint}
                      </td>
                      <td className="p-3 text-gray-600">{device.devicePlatform}</td>
                      <td className="p-3">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            device.status === 'Approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : device.status === 'Pending_Approval'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {device.status}
                        </span>
                      </td>
                      <td className="p-3 text-[11px] text-gray-500 font-mono">
                        {new Date(device.lastUsedAt).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        {device.status === 'Pending_Approval' && (
                          <button
                            onClick={() => handleReviewDevice(device.id, 'Approved')}
                            className="bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-semibold hover:bg-emerald-800"
                          >
                            Approve
                          </button>
                        )}
                        <button
                          onClick={() => handleResetDevice(device.studentId)}
                          className="bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 px-2 py-1 rounded text-[10px] font-semibold"
                        >
                          Reset Binding
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
