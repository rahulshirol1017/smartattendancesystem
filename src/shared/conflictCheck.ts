import {
  ClassSession,
  ConflictDetail,
  TimetableEntry,
  UserProfile,
} from './types.ts';

export function parseTimeToMinutes(hhmm: string): number {
  const [hStr, mStr] = (hhmm || '').split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h * 60 + m;
}

export function timesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const sA = parseTimeToMinutes(startA);
  const eA = parseTimeToMinutes(endA);
  const sB = parseTimeToMinutes(startB);
  const eB = parseTimeToMinutes(endB);
  if (sA < 0 || eA <= sA || sB < 0 || eB <= sB) return false;
  return sA < eB && sB < eA;
}

export function getWeekdayFromDate(
  dateStr: string
): 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday' {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const names: Array<
    'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'
  > = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[d.getUTCDay()] || 'Monday';
}

export function validateTimetableEntryConflicts(params: {
  candidate: {
    id?: string;
    sectionId: string;
    facultyId: string;
    dayOfWeek: TimetableEntry['dayOfWeek'];
    startTime: string;
    endTime: string;
    classroom: string;
    batch?: 'B1' | 'B2' | 'All';
  };
  existingTimetable: TimetableEntry[];
  facultyUser?: UserProfile | null;
  checkRooms: boolean;
}): ConflictDetail[] {
  const { candidate, existingTimetable, facultyUser, checkRooms } = params;
  const conflicts: ConflictDetail[] = [];

  const sMin = parseTimeToMinutes(candidate.startTime);
  const eMin = parseTimeToMinutes(candidate.endTime);
  if (sMin < 0 || eMin <= sMin) {
    conflicts.push({
      type: 'INVALID_TIME',
      message: 'End time must be strictly after start time.',
    });
    return conflicts;
  }

  for (const entry of existingTimetable) {
    if (entry.status !== 'Active') continue;
    if (candidate.id && entry.id === candidate.id) continue;
    if (entry.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!timesOverlap(candidate.startTime, candidate.endTime, entry.startTime, entry.endTime)) {
      continue;
    }

    if (entry.facultyId === candidate.facultyId) {
      conflicts.push({
        type: 'FACULTY_BUSY',
        message: `${entry.facultyName} is already scheduled on ${entry.dayOfWeek} (${entry.startTime}–${entry.endTime}) for ${entry.sectionDisplayName} — ${entry.subjectCode}.`,
      });
    }

    if (entry.sectionId === candidate.sectionId) {
      const cBatch = candidate.batch || 'All';
      const eBatch = entry.batch || 'All';
      const isDistinctLabBatch = cBatch !== 'All' && eBatch !== 'All' && cBatch !== eBatch;
      if (!isDistinctLabBatch) {
        conflicts.push({
          type: 'SECTION_BUSY',
          message: `Section ${entry.sectionDisplayName} already has ${entry.subjectCode} (${entry.subjectName}) scheduled on ${entry.dayOfWeek} (${entry.startTime}–${entry.endTime}).`,
        });
      }
    }

    if (
      checkRooms &&
      candidate.classroom.trim() &&
      entry.classroom.trim().toLowerCase() === candidate.classroom.trim().toLowerCase()
    ) {
      conflicts.push({
        type: 'ROOM_BUSY',
        message: `Classroom ${entry.classroom} is already booked on ${entry.dayOfWeek} (${entry.startTime}–${entry.endTime}) for ${entry.sectionDisplayName}.`,
      });
    }
  }

  if (facultyUser?.unavailableSlots) {
    for (const slot of facultyUser.unavailableSlots) {
      if (slot.dayOfWeek && slot.dayOfWeek === candidate.dayOfWeek) {
        if (timesOverlap(candidate.startTime, candidate.endTime, slot.startTime, slot.endTime)) {
          conflicts.push({
            type: 'FACULTY_UNAVAILABLE',
            message: `${facultyUser.name} is marked unavailable on ${slot.dayOfWeek} (${slot.startTime}–${slot.endTime}): ${slot.reason}.`,
          });
        }
      }
    }
  }

  return conflicts;
}

export function validateSessionConflicts(params: {
  candidate: {
    id?: string;
    sectionId: string;
    date: string;
    startTime: string;
    endTime: string;
    classroom: string;
    actualFacultyId: string;
    originalSessionId?: string;
    batch?: 'B1' | 'B2' | 'All';
  };
  existingSessions: ClassSession[];
  existingTimetable: TimetableEntry[];
  facultyUser?: UserProfile | null;
  checkRooms: boolean;
}): ConflictDetail[] {
  const { candidate, existingSessions, existingTimetable, facultyUser, checkRooms } = params;
  const conflicts: ConflictDetail[] = [];

  const sMin = parseTimeToMinutes(candidate.startTime);
  const eMin = parseTimeToMinutes(candidate.endTime);
  if (sMin < 0 || eMin <= sMin) {
    conflicts.push({
      type: 'INVALID_TIME',
      message: 'Session end time must be after start time.',
    });
    return conflicts;
  }

  if (candidate.originalSessionId) {
    const orig = existingSessions.find((s) => s.id === candidate.originalSessionId);
    if (orig && (orig.status === 'Conducted' || orig.attendanceSubmitted)) {
      conflicts.push({
        type: 'ORIGINAL_CONDUCTED',
        message: `Original class session (${orig.date}, ${orig.period}) has already been marked as Conducted and cannot be rescheduled.`,
      });
    }
  }

  // 1. Check specific ClassSessions on that exact date
  const cancelledTimetableIdsOnDate = new Set<string>();
  for (const s of existingSessions) {
    if (s.date !== candidate.date) continue;
    if (s.status === 'Cancelled' || s.status === 'Rescheduled') {
      if (s.timetableEntryId) cancelledTimetableIdsOnDate.add(s.timetableEntryId);
      continue;
    }
    if (s.approvalStatus === 'Rejected') continue;
    if (candidate.id && s.id === candidate.id) continue;
    if (candidate.originalSessionId && s.id === candidate.originalSessionId) continue;

    if (!timesOverlap(candidate.startTime, candidate.endTime, s.startTime, s.endTime)) {
      continue;
    }

    if (s.facultyId === candidate.actualFacultyId) {
      conflicts.push({
        type: 'FACULTY_BUSY',
        message: `${s.facultyName} already has a ${s.sessionType.toLowerCase()} session on ${s.date} (${s.startTime}–${s.endTime}) with ${s.sectionDisplayName} (${s.subjectCode || s.topic}).`,
      });
    }

    if (s.sectionId === candidate.sectionId) {
      const cBatch = candidate.batch || 'All';
      const sBatch = s.batch || 'All';
      const isDistinctLabBatch = cBatch !== 'All' && sBatch !== 'All' && cBatch !== sBatch;
      if (!isDistinctLabBatch) {
        conflicts.push({
          type: 'SECTION_BUSY',
          message: `Section ${s.sectionDisplayName} already has a scheduled session on ${s.date} (${s.startTime}–${s.endTime}).`,
        });
      }
    }

    if (
      checkRooms &&
      candidate.classroom.trim() &&
      s.classroom.trim().toLowerCase() === candidate.classroom.trim().toLowerCase()
    ) {
      conflicts.push({
        type: 'ROOM_BUSY',
        message: `Classroom ${s.classroom} is already occupied on ${s.date} (${s.startTime}–${s.endTime}) by ${s.sectionDisplayName}.`,
      });
    }
  }

  // 2. Check recurring weekly TimetableEntries on that weekday (unless cancelled/rescheduled on that date)
  const weekday = getWeekdayFromDate(candidate.date);
  if (weekday !== 'Sunday') {
    for (const tt of existingTimetable) {
      if (tt.status !== 'Active') continue;
      if (tt.dayOfWeek !== weekday) continue;
      if (cancelledTimetableIdsOnDate.has(tt.id)) continue;
      // Also check if a session already instantiated this timetable slot and was handled above
      const instantiated = existingSessions.find(
        (s) => s.date === candidate.date && s.timetableEntryId === tt.id
      );
      if (instantiated) continue;

      if (!timesOverlap(candidate.startTime, candidate.endTime, tt.startTime, tt.endTime)) {
        continue;
      }

      if (tt.facultyId === candidate.actualFacultyId) {
        conflicts.push({
          type: 'FACULTY_BUSY',
          message: `${tt.facultyName} has regular timetable class ${tt.subjectCode} (${tt.sectionDisplayName}) on ${weekday}s at ${tt.startTime}–${tt.endTime}.`,
        });
      }

      if (tt.sectionId === candidate.sectionId) {
        const cBatch = candidate.batch || 'All';
        const ttBatch = tt.batch || 'All';
        const isDistinctLabBatch = cBatch !== 'All' && ttBatch !== 'All' && cBatch !== ttBatch;
        if (!isDistinctLabBatch) {
          conflicts.push({
            type: 'SECTION_BUSY',
            message: `${tt.sectionDisplayName} has regular timetable class ${tt.subjectCode} on ${weekday}s at ${tt.startTime}–${tt.endTime}.`,
          });
        }
      }

      if (
        checkRooms &&
        candidate.classroom.trim() &&
        tt.classroom.trim().toLowerCase() === candidate.classroom.trim().toLowerCase()
      ) {
        conflicts.push({
          type: 'ROOM_BUSY',
          message: `Classroom ${tt.classroom} has regular timetable class ${tt.subjectCode} (${tt.sectionDisplayName}) on ${weekday}s at ${tt.startTime}–${tt.endTime}.`,
        });
      }
    }
  }

  // 3. Check Faculty unavailability slots
  if (facultyUser?.unavailableSlots) {
    for (const slot of facultyUser.unavailableSlots) {
      const matchesDate = Boolean(slot.date && slot.date === candidate.date);
      const matchesDay = Boolean(!slot.date && slot.dayOfWeek && slot.dayOfWeek === weekday);
      if (
        (matchesDate || matchesDay) &&
        timesOverlap(candidate.startTime, candidate.endTime, slot.startTime, slot.endTime)
      ) {
        conflicts.push({
          type: 'FACULTY_UNAVAILABLE',
          message: `${facultyUser.name} is unavailable (${slot.startTime}–${slot.endTime}): ${slot.reason}.`,
        });
      }
    }
  }

  return conflicts;
}
