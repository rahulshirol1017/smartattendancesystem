import React from 'react';
import {
  AttendanceStatus,
  ClassSessionStatus,
  CorrectionWorkflowStatus,
  SubjectStanding,
} from '../shared/types.ts';

export const StandingIndicator: React.FC<{ standing: SubjectStanding }> = ({ standing }) => {
  if (standing === 'On Track') {
    return (
      <span className="text-sm font-medium text-[#165B33] whitespace-nowrap shrink-0">
        Eligible
      </span>
    );
  }
  if (standing === 'Needs Attention') {
    return (
      <span className="text-sm font-medium text-[#B45309] whitespace-nowrap shrink-0">
        Borderline
      </span>
    );
  }
  if (standing === 'At Risk') {
    return (
      <span className="text-sm font-semibold text-[#B42318] whitespace-nowrap shrink-0">
        Shortage
      </span>
    );
  }
  return (
    <span className="text-sm text-[#6B5A4C] whitespace-nowrap shrink-0">
      No classes
    </span>
  );
};

export const RecordStatusIndicator: React.FC<{
  status: AttendanceStatus;
  hasPendingCorrection?: boolean;
}> = ({ status, hasPendingCorrection }) => {
  if (hasPendingCorrection) {
    return (
      <span className="text-sm font-medium text-[#B45309] whitespace-nowrap shrink-0">
        {status} · Evidence pending
      </span>
    );
  }

  if (status === 'Present') {
    return (
      <span className="text-sm font-medium text-[#165B33] whitespace-nowrap shrink-0">
        Present
      </span>
    );
  }
  if (status === 'Corrected') {
    return (
      <span className="text-sm font-medium text-[#165B33] whitespace-nowrap shrink-0">
        Present (Verified)
      </span>
    );
  }
  if (status === 'Excused') {
    return (
      <span className="text-sm font-medium text-[#DF6A24] whitespace-nowrap shrink-0">
        Excused
      </span>
    );
  }
  return (
    <span className="text-sm font-medium text-[#B42318] whitespace-nowrap shrink-0">
      Absent
    </span>
  );
};

export const WorkflowStatusIndicator: React.FC<{ status: CorrectionWorkflowStatus }> = ({
  status,
}) => {
  switch (status) {
    case 'Approved':
      return (
        <span className="text-xs font-medium text-[#165B33] whitespace-nowrap shrink-0">
          Approved
        </span>
      );
    case 'Rejected':
      return (
        <span className="text-xs font-medium text-[#B42318] whitespace-nowrap shrink-0">
          Rejected
        </span>
      );
    case 'Additional Evidence Requested':
      return (
        <span className="text-xs font-medium text-[#B45309] whitespace-nowrap shrink-0">
          Evidence needed
        </span>
      );
    case 'Under Review':
      return (
        <span className="text-xs font-medium text-[#DF6A24] whitespace-nowrap shrink-0">
          Under review
        </span>
      );
    case 'Submitted':
      return (
        <span className="text-xs font-medium text-[#DF6A24] whitespace-nowrap shrink-0">
          Submitted
        </span>
      );
    case 'Withdrawn':
      return (
        <span className="text-xs text-[#6B5A4C] whitespace-nowrap shrink-0">
          Withdrawn
        </span>
      );
    default:
      return (
        <span className="text-xs text-[#6B5A4C] whitespace-nowrap shrink-0">
          Draft
        </span>
      );
  }
};

export const ClassSessionStatusIndicator: React.FC<{ status: ClassSessionStatus }> = ({
  status,
}) => {
  if (status === 'Cancelled') {
    return (
      <span className="text-xs text-[#6B5A4C] whitespace-nowrap shrink-0">
        Cancelled
      </span>
    );
  }
  if (status === 'Rescheduled') {
    return (
      <span className="text-xs font-medium text-[#B45309] whitespace-nowrap shrink-0">
        Rescheduled
      </span>
    );
  }
  if (status === 'Conducted') {
    return (
      <span className="text-xs font-medium text-[#165B33] whitespace-nowrap shrink-0">
        Completed
      </span>
    );
  }
  if (status === 'Confirmed') {
    return (
      <span className="text-xs font-medium text-[#DF6A24] whitespace-nowrap shrink-0">
        Confirmed
      </span>
    );
  }
  return (
    <span className="text-xs text-[#6B5A4C] whitespace-nowrap shrink-0">
      Scheduled
    </span>
  );
};
