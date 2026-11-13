import {
  AttendanceRecord,
  ClassSession,
  InstitutionalPolicy,
  OverallAttendanceSummary,
  RecommendationItem,
  SubjectAttendanceComputed,
  SubjectItem,
  SubjectStanding,
  TimetableEntry,
} from './types.ts';

export function calculateConsecutiveClassesNeeded(
  attended: number,
  conducted: number,
  targetPercentage: number
): {
  classesNeeded: number;
  unreachable100Percent: boolean;
  alreadyMet: boolean;
  resultingAttended: number;
  resultingConducted: number;
  resultingPercentage: number | null;
} {
  const clampedTarget = Math.max(0, Math.min(100, targetPercentage));
  const targetBps = Math.round(clampedTarget * 100);

  if (conducted === 0) {
    if (targetBps === 0) {
      return {
        classesNeeded: 0,
        unreachable100Percent: false,
        alreadyMet: true,
        resultingAttended: 0,
        resultingConducted: 0,
        resultingPercentage: null,
      };
    }
    return {
      classesNeeded: 1,
      unreachable100Percent: false,
      alreadyMet: false,
      resultingAttended: 1,
      resultingConducted: 1,
      resultingPercentage: 100,
    };
  }

  const currentBps = (attended * 10000) / conducted;
  if (currentBps >= targetBps) {
    return {
      classesNeeded: 0,
      unreachable100Percent: false,
      alreadyMet: true,
      resultingAttended: attended,
      resultingConducted: conducted,
      resultingPercentage: roundOneDecimal((attended / conducted) * 100),
    };
  }

  if (targetBps >= 10000) {
    return {
      classesNeeded: 0,
      unreachable100Percent: true,
      alreadyMet: false,
      resultingAttended: attended,
      resultingConducted: conducted,
      resultingPercentage: roundOneDecimal((attended / conducted) * 100),
    };
  }

  const numerator = targetBps * conducted - 10000 * attended;
  const denominator = 10000 - targetBps;
  const needed = Math.max(0, Math.ceil(numerator / denominator));
  const finalAttended = attended + needed;
  const finalConducted = conducted + needed;

  return {
    classesNeeded: needed,
    unreachable100Percent: false,
    alreadyMet: false,
    resultingAttended: finalAttended,
    resultingConducted: finalConducted,
    resultingPercentage: roundOneDecimal((finalAttended / finalConducted) * 100),
  };
}

export function calculateSafeMissMargin(
  attended: number,
  conducted: number,
  targetPercentage: number
): number {
  if (conducted === 0 || targetPercentage <= 0) return 0;
  const targetBps = Math.round(Math.min(100, targetPercentage) * 100);
  if ((attended * 10000) / conducted < targetBps) return 0;
  if (targetBps >= 10000) return 0;
  const maxMisses = Math.floor((10000 * attended - targetBps * conducted) / targetBps);
  return Math.max(0, maxMisses);
}

export function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function projectScenario(
  attended: number,
  conducted: number,
  upcomingAttend: number,
  upcomingMiss: number
): {
  projectedAttended: number;
  projectedConducted: number;
  projectedPercentage: number | null;
} {
  const safeAttend = Math.max(0, Math.floor(upcomingAttend));
  const safeMiss = Math.max(0, Math.floor(upcomingMiss));
  const totalConducted = conducted + safeAttend + safeMiss;
  const totalAttended = attended + safeAttend;

  if (totalConducted === 0) {
    return {
      projectedAttended: 0,
      projectedConducted: 0,
      projectedPercentage: null,
    };
  }

  return {
    projectedAttended: totalAttended,
    projectedConducted: totalConducted,
    projectedPercentage: roundOneDecimal((totalAttended / totalConducted) * 100),
  };
}

export function computeSubjectAttendance(
  subject: SubjectItem,
  sessions: ClassSession[],
  records: AttendanceRecord[],
  timetable: TimetableEntry[],
  policy: InstitutionalPolicy,
  sectionIdFilter?: string
): SubjectAttendanceComputed {
  const sessionMap = new Map<string, ClassSession>();
  let cancelledCount = 0;
  let rescheduledCount = 0;
  let extraConductedCount = 0;

  for (const s of sessions) {
    if (s.subjectId !== subject.id) continue;
    if (sectionIdFilter && s.sectionId !== sectionIdFilter) continue;
    sessionMap.set(s.id, s);
    if (s.status === 'Cancelled') {
      cancelledCount += 1;
    } else if (s.status === 'Rescheduled') {
      rescheduledCount += 1;
    } else if (
      s.status === 'Conducted' &&
      (s.sessionType === 'Extra' || s.sessionType === 'Replacement')
    ) {
      extraConductedCount += 1;
    }
  }

  let conductedUnits = 0;
  let attendedUnits = 0;
  let missedCount = 0;
  let excusedCount = 0;
  let pendingCorrections = 0;
  let approvedCorrections = 0;

  const seenClassIds = new Set<string>();
  const subjectRecords = records.filter((r) => r.subjectId === subject.id);

  for (const rec of subjectRecords) {
    // Prevent accidental duplicate counting if multiple records ever existed
    if (seenClassIds.has(rec.classId)) continue;

    // Note: if student transferred sections, historical records still point to their original class session
    const cls = sessionMap.get(rec.classId) || sessions.find((s) => s.id === rec.classId);
    if (!cls) continue;

    // Scheduled, Confirmed, or Rescheduled (not conducted) sessions never receive conducted counts
    if (
      cls.status === 'Scheduled' ||
      cls.status === 'Confirmed' ||
      cls.status === 'Rescheduled'
    ) {
      continue;
    }

    if (cls.status === 'Cancelled' && policy.cancelledClassPolicy === 'exclude_from_conducted') {
      continue;
    }

    seenClassIds.add(rec.classId);

    const weight =
      policy.calculationMethod === 'weighted_hours' ? Math.max(1, cls.durationHours || 1) : 1;

    if (rec.pendingRequestId) {
      pendingCorrections += 1;
    }
    if (rec.status === 'Corrected') {
      approvedCorrections += 1;
    }

    if (rec.status === 'Present') {
      conductedUnits += weight;
      attendedUnits += weight;
    } else if (rec.status === 'Corrected') {
      conductedUnits += weight;
      if (rec.effectivePresent) {
        attendedUnits += weight;
      } else {
        missedCount += weight;
      }
    } else if (rec.status === 'Excused') {
      excusedCount += weight;
      if (policy.excusedAbsencePolicy === 'count_as_attended') {
        conductedUnits += weight;
        attendedUnits += weight;
      } else if (policy.excusedAbsencePolicy === 'count_as_missed') {
        conductedUnits += weight;
        missedCount += weight;
      }
    } else {
      conductedUnits += weight;
      missedCount += weight;
    }
  }

  const requiredPercentage = subject.attendanceRequirement || policy.defaultMinimumPercentage;
  const regularWeeklySlots = timetable.filter(
    (t) =>
      t.subjectId === subject.id &&
      t.status === 'Active' &&
      (!sectionIdFilter || t.sectionId === sectionIdFilter) &&
      t.upcomingStatus !== 'Cancelled' &&
      t.upcomingStatus !== 'Rescheduled'
  ).length;

  const extraUpcomingThisWeek = sessions.filter(
    (s) =>
      s.subjectId === subject.id &&
      (!sectionIdFilter || s.sectionId === sectionIdFilter) &&
      (s.sessionType === 'Extra' || s.sessionType === 'Replacement') &&
      (s.status === 'Scheduled' || s.status === 'Confirmed') &&
      s.approvalStatus === 'Approved'
  ).length;

  const scheduledThisWeek = regularWeeklySlots + extraUpcomingThisWeek;

  if (conductedUnits === 0) {
    return {
      subject,
      conducted: 0,
      attended: 0,
      missed: 0,
      excused: excusedCount,
      cancelled: cancelledCount,
      rescheduledCount,
      extraConductedCount,
      pendingCorrections,
      approvedCorrections,
      percentage: null,
      requiredPercentage,
      differenceFromRequired: null,
      classesNeededToRecover: 0,
      maxSafeMisses: 0,
      standing: 'Insufficient Data',
      scheduledThisWeek,
      projectedIfAttendWeek: scheduledThisWeek > 0 ? 100 : null,
    };
  }

  const rawPct = (attendedUnits / conductedUnits) * 100;
  const percentage = roundOneDecimal(rawPct);
  const differenceFromRequired = roundOneDecimal(rawPct - requiredPercentage);

  const recovery = calculateConsecutiveClassesNeeded(
    attendedUnits,
    conductedUnits,
    requiredPercentage
  );
  const maxSafeMisses = calculateSafeMissMargin(
    attendedUnits,
    conductedUnits,
    requiredPercentage
  );

  let standing: SubjectStanding = 'On Track';
  if (rawPct < requiredPercentage) {
    standing = 'At Risk';
  } else if (rawPct < requiredPercentage + policy.warningBufferPercentage || maxSafeMisses === 0) {
    standing = 'Needs Attention';
  }

  const weekProj = projectScenario(attendedUnits, conductedUnits, scheduledThisWeek, 0);

  return {
    subject,
    conducted: conductedUnits,
    attended: attendedUnits,
    missed: missedCount,
    excused: excusedCount,
    cancelled: cancelledCount,
    rescheduledCount,
    extraConductedCount,
    pendingCorrections,
    approvedCorrections,
    percentage,
    requiredPercentage,
    differenceFromRequired,
    classesNeededToRecover: recovery.classesNeeded,
    maxSafeMisses,
    standing,
    scheduledThisWeek,
    projectedIfAttendWeek: weekProj.projectedPercentage,
  };
}

export function computeOverallSummary(
  subjectMetrics: SubjectAttendanceComputed[]
): OverallAttendanceSummary {
  let totalConducted = 0;
  let totalAttended = 0;
  let totalMissed = 0;
  let totalExcused = 0;
  let totalCancelled = 0;
  let subjectsBelowThreshold = 0;
  let subjectsAtRisk = 0;
  let subjectsNeedingAttention = 0;
  let subjectsOnTrack = 0;

  for (const m of subjectMetrics) {
    totalConducted += m.conducted;
    totalAttended += m.attended;
    totalMissed += m.missed;
    totalExcused += m.excused;
    totalCancelled += m.cancelled;

    if (m.standing === 'At Risk') {
      subjectsBelowThreshold += 1;
      subjectsAtRisk += 1;
    } else if (m.standing === 'Needs Attention') {
      subjectsNeedingAttention += 1;
    } else if (m.standing === 'On Track') {
      subjectsOnTrack += 1;
    }
  }

  const overallPercentage =
    totalConducted > 0 ? roundOneDecimal((totalAttended / totalConducted) * 100) : null;

  let headlineMessage = 'No classes have been recorded for this semester yet.';
  if (overallPercentage !== null) {
    const attentionTotal = subjectsAtRisk + subjectsNeedingAttention;
    if (subjectsAtRisk === 0 && subjectsNeedingAttention === 0) {
      headlineMessage = `Your overall attendance is ${overallPercentage.toFixed(1)}%. You are meeting the configured requirement across all subjects.`;
    } else if (subjectsAtRisk > 0 && subjectsNeedingAttention > 0) {
      headlineMessage = `Your overall attendance is ${overallPercentage.toFixed(1)}%. ${formatCountWord(subjectsAtRisk, 'subject')} ${subjectsAtRisk === 1 ? 'is' : 'are'} below the required level and ${formatCountWord(subjectsNeedingAttention, 'other subject')} ${subjectsNeedingAttention === 1 ? 'is' : 'are'} close to the threshold.`;
    } else if (subjectsAtRisk > 0) {
      headlineMessage = `Your overall attendance is ${overallPercentage.toFixed(1)}%. ${formatCountWord(subjectsAtRisk, 'subject')} ${subjectsAtRisk === 1 ? 'needs' : 'need'} immediate recovery.`;
    } else {
      headlineMessage = `Your overall attendance is ${overallPercentage.toFixed(1)}%. ${formatCountWord(attentionTotal, 'subject')} ${attentionTotal === 1 ? 'is' : 'are'} close to the minimum requirement.`;
    }
  }

  return {
    overallPercentage,
    totalConducted,
    totalAttended,
    totalMissed,
    totalExcused,
    totalCancelled,
    subjectsBelowThreshold,
    subjectsAtRisk,
    subjectsNeedingAttention,
    subjectsOnTrack,
    headlineMessage,
  };
}

function formatCountWord(count: number, noun: string): string {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const numText = count < words.length ? words[count] : String(count);
  return `${numText} ${count === 1 ? noun : `${noun}s`}`;
}

export function generatePersonalizedRecommendations(
  subjectMetrics: SubjectAttendanceComputed[]
): RecommendationItem[] {
  const sorted = [...subjectMetrics].sort((a, b) => {
    const rank = (s: SubjectStanding) =>
      s === 'At Risk' ? 0 : s === 'Needs Attention' ? 1 : s === 'On Track' ? 2 : 3;
    if (rank(a.standing) !== rank(b.standing)) return rank(a.standing) - rank(b.standing);
    return (a.percentage ?? 100) - (b.percentage ?? 100);
  });

  return sorted.map((m) => {
    const {
      subject,
      percentage,
      requiredPercentage,
      classesNeededToRecover,
      scheduledThisWeek,
      projectedIfAttendWeek,
      standing,
    } = m;
    const remaining = subject.estimatedRemainingClasses;
    const unreachableInRemaining =
      standing === 'At Risk' && remaining > 0 && classesNeededToRecover > remaining;

    if (standing === 'Insufficient Data' || percentage === null) {
      return {
        id: `rec-${subject.id}`,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        severity: 'info',
        title: `${subject.name} has no conducted classes recorded yet.`,
        explanation:
          scheduledThisWeek > 0
            ? `${scheduledThisWeek} ${scheduledThisWeek === 1 ? 'class is' : 'classes are'} scheduled this week on your section timetable.`
            : 'Attendance percentages will appear automatically once your faculty records the first session.',
        currentPercentage: null,
        requiredPercentage,
        projectedPercentage: projectedIfAttendWeek,
        classesRequired: 0,
        scheduledThisWeek,
        unreachableInRemaining: false,
      };
    }

    if (unreachableInRemaining) {
      return {
        id: `rec-${subject.id}`,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        severity: 'critical',
        title: `Your ${subject.name} attendance is ${percentage.toFixed(1)}% (below ${requiredPercentage}%).`,
        explanation: `Reaching ${requiredPercentage}% requires ${classesNeededToRecover} consecutive classes, which exceeds the estimated ${remaining} remaining scheduled classes. Attend every upcoming class (${scheduledThisWeek} scheduled this week) and consult your faculty advisor or academic office regarding institutional rules.`,
        currentPercentage: percentage,
        requiredPercentage,
        projectedPercentage: projectedIfAttendWeek,
        classesRequired: classesNeededToRecover,
        scheduledThisWeek,
        unreachableInRemaining: true,
      };
    }

    if (standing === 'At Risk') {
      const weekContext =
        scheduledThisWeek > 0 && projectedIfAttendWeek !== null
          ? ` ${scheduledThisWeek} ${scheduledThisWeek === 1 ? 'class is' : 'classes are'} scheduled this week (including any replacement or extra classes); attending ${scheduledThisWeek === 1 ? 'it' : 'all of them'} will raise your projected attendance to ${projectedIfAttendWeek.toFixed(1)}%.`
          : '';
      return {
        id: `rec-${subject.id}`,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        severity: 'critical',
        title: `Your ${subject.name} attendance is ${percentage.toFixed(1)}%. Prioritize upcoming classes for this subject.`,
        explanation: `You are currently ${(requiredPercentage - percentage).toFixed(1)} percentage points below the configured ${requiredPercentage}% threshold. Attend the next ${classesNeededToRecover} consecutive ${classesNeededToRecover === 1 ? 'class' : 'classes'} without missing any to recover to ${requiredPercentage}%, assuming all scheduled classes take place.${weekContext}`,
        currentPercentage: percentage,
        requiredPercentage,
        projectedPercentage: projectedIfAttendWeek,
        classesRequired: classesNeededToRecover,
        scheduledThisWeek,
        unreachableInRemaining: false,
      };
    }

    if (standing === 'Needs Attention') {
      const nextMiss = projectScenario(m.attended, m.conducted, 0, 1);
      const dropText =
        nextMiss.projectedPercentage !== null
          ? ` Missing the next class would bring your attendance to ${nextMiss.projectedPercentage.toFixed(1)}%.`
          : '';
      const weekContext =
        scheduledThisWeek > 0 && projectedIfAttendWeek !== null
          ? ` Attending all ${scheduledThisWeek} scheduled ${scheduledThisWeek === 1 ? 'class' : 'classes'} this week will improve your projected attendance to ${projectedIfAttendWeek.toFixed(1)}%.`
          : '';
      return {
        id: `rec-${subject.id}`,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        severity: 'warning',
        title: `Your attendance in ${subject.name} is ${percentage.toFixed(1)}%, close to the ${requiredPercentage}% requirement.`,
        explanation: `You are above the configured minimum, but have a margin of ${m.maxSafeMisses} missed ${m.maxSafeMisses === 1 ? 'class' : 'classes'} before falling below ${requiredPercentage}%.${dropText}${weekContext}`,
        currentPercentage: percentage,
        requiredPercentage,
        projectedPercentage: projectedIfAttendWeek,
        classesRequired: 0,
        scheduledThisWeek,
        unreachableInRemaining: false,
      };
    }

    const weekContext =
      scheduledThisWeek > 0 && projectedIfAttendWeek !== null
        ? ` ${scheduledThisWeek} ${scheduledThisWeek === 1 ? 'class is' : 'classes are'} scheduled this week (projected ${projectedIfAttendWeek.toFixed(1)}% if all attended).`
        : '';

    return {
      id: `rec-${subject.id}`,
      subjectId: subject.id,
      subjectCode: subject.code,
      subjectName: subject.name,
      severity: 'positive',
      title: `Your ${subject.name} attendance is ${percentage.toFixed(1)}%. Continue attending regularly to maintain your position.`,
      explanation: `You are ${(percentage - requiredPercentage).toFixed(1)} percentage points above the configured ${requiredPercentage}% requirement (${m.attended} of ${m.conducted} classes attended).${weekContext}`,
      currentPercentage: percentage,
      requiredPercentage,
      projectedPercentage: projectedIfAttendWeek,
      classesRequired: 0,
      scheduledThisWeek,
      unreachableInRemaining: false,
    };
  });
}
