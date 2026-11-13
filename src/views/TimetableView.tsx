import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  FileText,
  Filter,
  Grid3X3,
  ListFilter,
  Sparkles,
} from 'lucide-react';
import { getWeekdayFromDate } from '../shared/conflictCheck.ts';
import {
  AcademicSection,
  ClassSession,
  InstitutionalPolicy,
  SubjectAttendanceComputed,
  TimetableEntry,
  UserProfile,
} from '../shared/types.ts';
import {
  getStudentBatch,
  OfficialVTUTimetableDocument,
} from '../components/OfficialVTUTimetableDocument.tsx';

interface TimetableViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  sections: AcademicSection[];
  classes: ClassSession[];
  timetable: TimetableEntry[];
  subjectMetrics: SubjectAttendanceComputed[];
  onOpenSessionForAttendance: (sessionId: string) => void;
}

const WEEKDAYS: Array<'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'> = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const SHORT_DAY_LABELS: Record<(typeof WEEKDAYS)[number], string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};

interface DisplaySlot {
  id: string;
  dayOfWeek: (typeof WEEKDAYS)[number];
  startTime: string;
  endTime: string;
  subjectName: string;
  subjectCode: string;
  classroom: string;
  secondaryLabel: string;
  batch?: 'B1' | 'B2' | 'All';
  statusLabel: 'Regular' | 'Extra class' | 'Cancelled' | 'Rescheduled';
  sessionId?: string;
}

export const TimetableView: React.FC<TimetableViewProps> = ({
  user,
  policy,
  sections,
  classes,
  timetable,
  onOpenSessionForAttendance,
}) => {
  const activeSections = useMemo(
    () => sections.filter((s) => s.status === 'Active'),
    [sections]
  );

  // Default section selection: student's section, or faculty's primary assignment, or first active section
  const [selectedSectionId, setSelectedSectionId] = useState<string>(() => {
    if (user.sectionId) return user.sectionId;
    return activeSections[0]?.id || 'sec-csbs-a';
  });

  // View mode: 'official' (the authentic VTU document matrix) vs 'interactive' (daily schedule cards)
  const [viewMode, setViewMode] = useState<'official' | 'interactive'>('official');

  const [mobileDay, setMobileDay] = useState<(typeof WEEKDAYS)[number]>(() => {
    const jsDay = new Date().getDay();
    if (jsDay >= 1 && jsDay <= 6) {
      return WEEKDAYS[jsDay - 1];
    }
    return 'Monday';
  });

  const studentBatch = useMemo(() => getStudentBatch(user), [user]);

  const selectedSectionObj = useMemo(
    () =>
      activeSections.find((s) => s.id === selectedSectionId) ||
      activeSections[0] || {
        id: 'sec-csbs-a',
        displayName: 'CSBS A',
        defaultClassroom: 'VB G19',
        semester: 5,
        programme: 'B.Tech in CSBS',
        academicYear: '2026',
      },
    [activeSections, selectedSectionId]
  );

  const slotsByDay = useMemo(() => {
    const map: Record<(typeof WEEKDAYS)[number], DisplaySlot[]> = {
      Monday: [],
      Tuesday: [],
      Wednesday: [],
      Thursday: [],
      Friday: [],
      Saturday: [],
    };

    const filteredRegular = timetable.filter((t) => {
      if (t.status !== 'Active') return false;
      // In interactive schedule, filter by the selected division
      if (selectedSectionId && t.sectionId !== selectedSectionId) {
        return false;
      }
      return true;
    });

    for (const entry of filteredRegular) {
      const matchingSession = classes.find(
        (s) =>
          s.timetableEntryId === entry.id &&
          (s.status === 'Scheduled' ||
            s.status === 'Confirmed' ||
            s.status === 'Cancelled' ||
            s.status === 'Rescheduled')
      );

      let statusLabel: DisplaySlot['statusLabel'] = 'Regular';
      const rawStatus = matchingSession?.status || entry.upcomingStatus;
      if (rawStatus === 'Cancelled') statusLabel = 'Cancelled';
      else if (rawStatus === 'Rescheduled') statusLabel = 'Rescheduled';

      map[entry.dayOfWeek].push({
        id: entry.id,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        subjectName: entry.subjectName,
        subjectCode: entry.subjectCode,
        classroom: matchingSession?.classroom || entry.classroom,
        secondaryLabel:
          user.role === 'faculty' ? entry.sectionDisplayName : entry.facultyName,
        batch: entry.batch,
        statusLabel,
        sessionId:
          matchingSession &&
          matchingSession.status !== 'Cancelled' &&
          matchingSession.status !== 'Rescheduled'
            ? matchingSession.id
            : undefined,
      });
    }

    const extraSessions = classes.filter((s) => {
      if (s.sessionType === 'Regular') return false;
      if (s.approvalStatus !== 'Approved') return false;
      if (s.status !== 'Scheduled' && s.status !== 'Confirmed') return false;
      if (selectedSectionId && s.sectionId !== selectedSectionId) return false;
      return true;
    });

    for (const extra of extraSessions) {
      const weekday = getWeekdayFromDate(extra.date);
      if (weekday === 'Sunday') continue;
      map[weekday].push({
        id: extra.id,
        dayOfWeek: weekday,
        startTime: extra.startTime,
        endTime: extra.endTime,
        subjectName: extra.subjectName || extra.topic || 'Extra Class',
        subjectCode: extra.subjectCode || '',
        classroom: extra.classroom,
        secondaryLabel:
          user.role === 'faculty' ? extra.sectionDisplayName : extra.facultyName,
        batch: extra.batch,
        statusLabel: 'Extra class',
        sessionId: extra.id,
      });
    }

    for (const day of WEEKDAYS) {
      map[day].sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    return map;
  }, [timetable, classes, user, selectedSectionId]);

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="no-print flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E3D2B4] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#165B33]">Timetable</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-[#165B33]/10 text-[#165B33] border border-[#165B33]/30">
              w.e.f: 07/09/2026
            </span>
          </div>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            Official V-Semester Academic Schedule · Department of CSE, VTU Campus, Belagavi
          </p>
        </div>

        {/* CONTROLS: DIVISION SWITCHER & VIEW MODE */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* DIVISION SELECTOR TABS */}
          <div className="inline-flex rounded-md border border-[#E3D2B4] bg-white p-0.5 text-xs shadow-xs">
            {activeSections.map((sec) => {
              const isSelected = selectedSectionId === sec.id;
              const isUserSec = user.sectionId === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setSelectedSectionId(sec.id)}
                  className={`px-3 py-1.5 rounded font-medium transition-colors flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#165B33] text-white shadow-xs'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  <span>{sec.displayName} (Room {sec.defaultClassroom})</span>
                  {isUserSec && (
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded-full font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-[#DF6A24]/10 text-[#DF6A24]'
                      }`}
                    >
                      Enrolled
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* VIEW MODE TOGGLE */}
          <div className="inline-flex rounded-md border border-[#E3D2B4] bg-[#FFFDF8] p-0.5 text-xs shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode('official')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
                viewMode === 'official'
                  ? 'bg-[#DF6A24] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              <span>Official VTU Document</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('interactive')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold transition-colors ${
                viewMode === 'interactive'
                  ? 'bg-[#DF6A24] text-white shadow-xs'
                  : 'text-[#6B5A4C] hover:text-[#241710]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Weekly Schedule</span>
            </button>
          </div>
        </div>
      </div>

      {/* STUDENT BATCH NOTICE BANNER */}
      {user.role === 'student' && studentBatch && (
        <div className="no-print rounded-lg border border-[#DF6A24]/30 bg-[#FFFDF8] p-3 text-xs flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#DF6A24] text-white font-bold text-xs">
              {studentBatch}
            </span>
            <div>
              <span className="font-bold text-[#241710]">
                {user.name} ({user.identifier})
              </span>
              <span className="text-[#6B5A4C] ml-1.5">
                assigned to <strong>Batch {studentBatch}</strong> for Computer Networks Lab & Computational Statistics Lab.
              </span>
            </div>
          </div>
          <div className="text-[11px] text-[#6B5A4C] font-medium">
            {selectedSectionId === 'sec-csbs-a' ? (
              studentBatch === 'B1' ? (
                <span>Monday: BCS502 in N2 Lab · Tuesday: BCBL504 in Old Re Lab</span>
              ) : (
                <span>Monday: BCBL504 in Old Re Lab · Tuesday: BCS502 in N2 Lab</span>
              )
            ) : studentBatch === 'B1' ? (
              <span>Wednesday: BCS502 in N2 Lab · Thursday: BCBL504 in Old Re Lab</span>
            ) : (
              <span>Wednesday: BCBL504 in Old Re Lab · Thursday: BCS502 in N2 Lab</span>
            )}
          </div>
        </div>
      )}

      {/* MAIN VIEW MODE: OFFICIAL VTU TIMETABLE MATRIX */}
      {viewMode === 'official' ? (
        <OfficialVTUTimetableDocument
          sectionId={selectedSectionId}
          activeUser={user}
          timetable={timetable}
          classes={classes}
          onSelectSession={onOpenSessionForAttendance}
        />
      ) : (
        /* SECONDARY VIEW MODE: INTERACTIVE DAILY CARD SCHEDULE */
        <div className="space-y-4">
          {/* MOBILE DAILY TIMETABLE VIEW */}
          <div className="md:hidden space-y-4">
            <div className="grid grid-cols-6 gap-1 rounded border border-[#E3D2B4] bg-[#FFFDF8] p-1">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setMobileDay(day)}
                  className={`rounded py-2 text-xs font-medium text-center ${
                    mobileDay === day
                      ? 'bg-[#DF6A24] text-white'
                      : 'text-[#6B5A4C] hover:text-[#241710]'
                  }`}
                >
                  {SHORT_DAY_LABELS[day]}
                </button>
              ))}
            </div>

            <div className="rounded-md border border-[#E3D2B4] bg-white divide-y divide-[#E3D2B4]">
              {slotsByDay[mobileDay].length === 0 ? (
                <div className="p-6 text-center text-sm text-[#6B5A4C]">
                  No classes scheduled on {mobileDay}.
                </div>
              ) : (
                slotsByDay[mobileDay].map((slot) => (
                  <div key={slot.id} className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {slot.subjectCode && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-mono font-semibold text-[#DF6A24]">
                              {slot.subjectCode}
                            </span>
                            {slot.batch && slot.batch !== 'All' && (
                              <span className="text-[10px] px-1 py-0.2 rounded font-bold bg-[#165B33]/10 text-[#165B33]">
                                Batch {slot.batch}
                              </span>
                            )}
                          </div>
                        )}
                        <div
                          className={`text-sm font-semibold ${
                            slot.statusLabel === 'Cancelled'
                              ? 'line-through text-[#6B5A4C]'
                              : 'text-[#165B33]'
                          }`}
                        >
                          {slot.subjectName}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-[#241710] tabular-nums whitespace-nowrap">
                        {slot.startTime} – {slot.endTime}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#6B5A4C]">
                      <span>
                        {slot.classroom} · {slot.secondaryLabel}
                      </span>
                      {slot.statusLabel !== 'Regular' && (
                        <span
                          className={
                            slot.statusLabel === 'Extra class'
                              ? 'font-medium text-[#DF6A24]'
                              : slot.statusLabel === 'Rescheduled'
                              ? 'font-medium text-[#B45309]'
                              : 'text-[#6B5A4C]'
                          }
                        >
                          {slot.statusLabel}
                        </span>
                      )}
                    </div>

                    {(user.role === 'faculty' || user.role === 'admin') && slot.sessionId && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => onOpenSessionForAttendance(slot.sessionId!)}
                          className="text-xs font-medium text-[#DF6A24] hover:underline"
                        >
                          Mark attendance
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* DESKTOP 6-COLUMN WEEKLY TIMETABLE GRID */}
          <div className="hidden md:block overflow-x-auto rounded-md border border-[#E3D2B4] bg-white shadow-xs">
            <div className="grid grid-cols-6 divide-x divide-[#E3D2B4] min-w-[920px]">
              {WEEKDAYS.map((day) => (
                <div key={day} className="flex flex-col">
                  <div className="border-b border-[#E3D2B4] bg-[#165B33] px-3.5 py-3 text-xs font-semibold text-white">
                    {day}
                  </div>

                  <div className="p-2.5 space-y-2.5 flex-1 bg-[#FFFDF8]">
                    {slotsByDay[day].length === 0 ? (
                      <div className="py-6 text-center text-xs text-[#6B5A4C]">No classes</div>
                    ) : (
                      slotsByDay[day].map((slot) => {
                        const isMyBatch =
                          studentBatch && slot.batch && slot.batch === studentBatch;
                        return (
                          <div
                            key={slot.id}
                            className={`rounded border p-3 space-y-1 bg-white transition-all ${
                              slot.statusLabel === 'Extra class'
                                ? 'border-[#DF6A24]'
                                : isMyBatch
                                ? 'border-[#165B33] ring-1 ring-[#165B33]/30 bg-[#165B33]/5'
                                : 'border-[#E3D2B4]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] font-mono font-semibold text-[#DF6A24]">
                                  {slot.subjectCode}
                                </span>
                                {slot.batch && slot.batch !== 'All' && (
                                  <span className="text-[10px] px-1 py-0.2 rounded font-bold bg-[#165B33]/10 text-[#165B33]">
                                    {slot.batch}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-semibold text-[#165B33] tabular-nums">
                                {slot.startTime}–{slot.endTime}
                              </span>
                            </div>

                            <div
                              className={`text-xs font-semibold leading-snug ${
                                slot.statusLabel === 'Cancelled'
                                  ? 'line-through text-[#6B5A4C]'
                                  : 'text-[#241710]'
                              }`}
                            >
                              {slot.subjectName}
                            </div>

                            <div className="text-[11px] text-[#6B5A4C]">{slot.classroom}</div>
                            <div className="text-[11px] text-[#6B5A4C] truncate">
                              {slot.secondaryLabel}
                            </div>

                            {slot.statusLabel !== 'Regular' && (
                              <div
                                className={`text-[11px] pt-0.5 ${
                                  slot.statusLabel === 'Extra class'
                                    ? 'font-medium text-[#DF6A24]'
                                    : slot.statusLabel === 'Rescheduled'
                                    ? 'font-medium text-[#B45309]'
                                    : 'text-[#6B5A4C]'
                                }`}
                              >
                                {slot.statusLabel}
                              </div>
                            )}

                            {(user.role === 'faculty' || user.role === 'admin') && slot.sessionId && (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => onOpenSessionForAttendance(slot.sessionId!)}
                                  className="text-[11px] font-medium text-[#DF6A24] hover:underline"
                                >
                                  Mark attendance
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
