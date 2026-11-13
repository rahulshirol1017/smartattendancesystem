import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { api } from '../api/client.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { WorkflowStatusIndicator } from '../components/StatusIndicator.tsx';
import {
  AttendanceCorrectionRequest,
  AttendanceRecord,
  ClassSession,
  InstitutionalPolicy,
  SubjectItem,
  UserProfile,
} from '../shared/types.ts';

interface CorrectionsViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
  subjects: SubjectItem[];
  classes: ClassSession[];
  records: AttendanceRecord[];
  corrections: AttendanceCorrectionRequest[];
  preselectedRecordId?: string | null;
  onClearPreselectedRecord?: () => void;
  onRefreshWorkspace: () => Promise<void>;
}

const EVIDENCE_DOCUMENT_TYPES = [
  'Medical Certificate',
  'Official VTU / College Duty Letter',
  'Signed Lab / Class Register',
  'Event Participation Certificate',
] as const;

function formatShortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const CorrectionsView: React.FC<CorrectionsViewProps> = ({
  user,
  policy,
  subjects,
  classes,
  records,
  corrections,
  preselectedRecordId,
  onClearPreselectedRecord,
  onRefreshWorkspace,
}) => {
  const canReview = policy.approvalPermissions.includes(user.role);

  const [showNewForm, setShowNewForm] = useState<boolean>(Boolean(preselectedRecordId));
  const [selectedRecordId, setSelectedRecordId] = useState<string>(preselectedRecordId || '');
  const [requestedStatus, setRequestedStatus] = useState<'Present' | 'Excused'>('Excused');
  const [documentCategory, setDocumentCategory] = useState<string>(EVIDENCE_DOCUMENT_TYPES[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [selectedRequestId, setSelectedRequestId] = useState<string>(
    () => corrections[0]?.id || ''
  );
  const [resubmitFiles, setResubmitFiles] = useState<File[]>([]);
  const [withdrawTargetId, setWithdrawTargetId] = useState<string | null>(null);

  const [previewDoc, setPreviewDoc] = useState<{
    name: string;
    blobUrl: string;
    mimeType: string;
  } | null>(null);

  const eligibleRecords = useMemo(() => {
    if (user.role !== 'student') return [];
    const sessionMap = new Map<string, ClassSession>(classes.map((c) => [c.id, c]));
    const subjectMap = new Map<string, SubjectItem>(subjects.map((s) => [s.id, s]));

    return records
      .filter((r) => r.status === 'Absent' && !r.pendingRequestId)
      .map((r) => {
        const cls = sessionMap.get(r.classId);
        const subj = subjectMap.get(r.subjectId);
        if (!cls || !subj) return null;
        return { record: r, session: cls, subject: subj };
      })
      .filter(
        (
          x
        ): x is { record: AttendanceRecord; session: ClassSession; subject: SubjectItem } =>
          Boolean(x)
      )
      .sort((a, b) => b.session.date.localeCompare(a.session.date));
  }, [user.role, records, classes, subjects]);

  useEffect(() => {
    if (preselectedRecordId) {
      setSelectedRecordId(preselectedRecordId);
      setShowNewForm(true);
      if (onClearPreselectedRecord) onClearPreselectedRecord();
    } else if (!selectedRecordId && eligibleRecords.length > 0) {
      setSelectedRecordId(eligibleRecords[0].record.id);
    }
  }, [preselectedRecordId, eligibleRecords, selectedRecordId, onClearPreselectedRecord]);

  const sortedCorrections = useMemo(
    () => [...corrections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [corrections]
  );

  const activeRequest = useMemo(
    () =>
      sortedCorrections.find((c) => c.id === selectedRequestId) || sortedCorrections[0] || null,
    [sortedCorrections, selectedRequestId]
  );

  const handleSubmitEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecordId) return;
    if (files.length === 0) {
      setFeedback({ type: 'error', text: 'Attach at least one supporting document (PDF/JPG/PNG).' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('attendanceRecordId', selectedRecordId);
      fd.append('requestedStatus', requestedStatus);
      fd.append('reason', documentCategory);
      fd.append('documentCategory', documentCategory);
      for (const f of files) {
        fd.append('evidence', f);
      }
      const res = await api.submitCorrection(fd);
      await onRefreshWorkspace();
      setSelectedRequestId(res.request.id);
      setShowNewForm(false);
      setFiles([]);
      setFeedback({ type: 'success', text: 'Evidence uploaded for verification.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not upload evidence.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewDecision = async (
    decision: 'Additional Evidence Requested' | 'Approved' | 'Rejected'
  ) => {
    if (!activeRequest) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await api.reviewCorrection(activeRequest.id, decision, decision);
      await onRefreshWorkspace();
      setFeedback({
        type: 'success',
        text:
          decision === 'Approved'
            ? 'Evidence verified and attendance updated.'
            : decision === 'Rejected'
            ? 'Submission rejected.'
            : 'Document requested.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update verification status.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmitEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRequest) return;
    if (resubmitFiles.length === 0) {
      setFeedback({ type: 'error', text: 'Select a document file to upload.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('documentCategory', documentCategory);
      for (const f of resubmitFiles) {
        fd.append('evidence', f);
      }
      await api.resubmitCorrection(activeRequest.id, fd);
      await onRefreshWorkspace();
      setResubmitFiles([]);
      setFeedback({ type: 'success', text: 'Updated document uploaded.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not upload document.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEvidence = async (requestId: string, fileId: string, fileName: string) => {
    try {
      const { blobUrl, mimeType } = await api.fetchEvidenceBlobUrl(requestId, fileId);
      setPreviewDoc({ name: fileName, blobUrl, mimeType });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not open attached document.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E3D2B4] pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#165B33]">
            {user.role === 'student' ? 'Evidence Upload' : 'Evidence Verification'}
          </h1>
          <p className="mt-1 text-sm text-[#6B5A4C]">
            {user.role === 'student'
              ? 'Upload official supporting proof (PDF, JPG, or PNG) for absent sessions.'
              : 'Inspect uploaded student documents and verify attendance updates.'}
          </p>
        </div>

        {user.role === 'student' && (
          <button
            type="button"
            onClick={() => setShowNewForm((prev) => !prev)}
            className="inline-flex items-center gap-2 self-start rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526]"
          >
            <Upload className="w-4 h-4" />
            <span>{showNewForm ? 'Close' : 'Upload Evidence'}</span>
          </button>
        )}
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

      {/* STUDENT EVIDENCE UPLOAD FORM — STRICTLY DOCUMENT PROOF ONLY, NO TEXT EXPLANATIONS */}
      {user.role === 'student' && showNewForm && (
        <form
          onSubmit={handleSubmitEvidence}
          className="rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4 max-w-3xl"
        >
          <h2 className="text-base font-semibold text-[#165B33]">Submit Documentary Evidence</h2>

          {eligibleRecords.length === 0 ? (
            <p className="text-sm text-[#6B5A4C]">
              No absent sessions available for evidence upload.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                    Absent Class Session
                  </label>
                  <select
                    value={selectedRecordId}
                    onChange={(e) => setSelectedRecordId(e.target.value)}
                    className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                  >
                    {eligibleRecords.map(({ record, session, subject }) => (
                      <option key={record.id} value={record.id}>
                        {formatShortDate(session.date)} · {subject.code} {subject.name} (
                        {session.startTime}–{session.endTime})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                    Requested Status
                  </label>
                  <select
                    value={requestedStatus}
                    onChange={(e) => setRequestedStatus(e.target.value as 'Present' | 'Excused')}
                    className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                  >
                    <option value="Excused">Excused (Medical / Official VTU Duty)</option>
                    <option value="Present">Present (Signed Lab / Class Register)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                    Evidence Document Type
                  </label>
                  <select
                    value={documentCategory}
                    onChange={(e) => setDocumentCategory(e.target.value)}
                    className="w-full rounded border border-[#E3D2B4] bg-white px-3 py-2 text-sm text-[#241710] focus:border-[#165B33] focus:outline-none"
                  >
                    {EVIDENCE_DOCUMENT_TYPES.map((docType) => (
                      <option key={docType} value={docType}>
                        {docType}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#6B5A4C] mb-1">
                    Supporting Document File (PDF, JPG, PNG — Required)
                  </label>
                  <input
                    type="file"
                    multiple
                    required
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    className="block w-full text-xs text-[#6B5A4C] file:mr-3 file:rounded file:border file:border-[#E3D2B4] file:bg-[#FAF3E3] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#241710]"
                  />
                </div>
              </div>

              <div className="pt-1 flex items-center gap-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-[#165B33] px-4 py-2 text-sm font-medium text-white hover:bg-[#104526] disabled:opacity-50"
                >
                  {submitting ? 'Uploading…' : 'Submit Evidence'}
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {/* SUBMISSIONS TABLE + EVIDENCE VERIFICATION PANEL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 overflow-x-auto rounded-md border border-[#E3D2B4] bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3D2B4] bg-[#FFFDF8] text-xs font-semibold text-[#6B5A4C]">
                {user.role !== 'student' && <th className="py-3 px-4">Student</th>}
                <th className="py-3 px-4">Course & Session</th>
                <th className="py-3 px-4">Document Type</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3D2B4] text-sm">
              {sortedCorrections.length === 0 ? (
                <tr>
                  <td
                    colSpan={user.role !== 'student' ? 4 : 3}
                    className="py-8 px-4 text-center text-[#6B5A4C]"
                  >
                    No evidence submissions recorded.
                  </td>
                </tr>
              ) : (
                sortedCorrections.map((req) => {
                  const isSelected = activeRequest?.id === req.id;
                  const docLabel = req.evidenceFiles[0]?.documentCategory || req.reason;
                  return (
                    <tr
                      key={req.id}
                      onClick={() => setSelectedRequestId(req.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#DF6A24]/10' : 'hover:bg-[#FAF3E3]/55'
                      }`}
                    >
                      {user.role !== 'student' && (
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-[#241710]">{req.studentName}</div>
                          <div className="text-xs text-[#6B5A4C] font-mono">
                            {req.studentIdentifier} · {req.sectionDisplayName}
                          </div>
                        </td>
                      )}
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-[#241710]">
                          {req.subjectCode} · {req.subjectName}
                        </div>
                        <div className="text-xs text-[#6B5A4C]">
                          {formatShortDate(req.classDate)} · {req.classPeriod}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#241710]">{docLabel}</td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <WorkflowStatusIndicator status={req.workflowStatus} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {activeRequest && (
          <div className="lg:col-span-5 rounded-md border border-[#E3D2B4] bg-white p-5 space-y-4">
            <div className="border-b border-[#E3D2B4] pb-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#165B33]">
                  {activeRequest.subjectCode} · {activeRequest.subjectName}
                </h2>
                <WorkflowStatusIndicator status={activeRequest.workflowStatus} />
              </div>
              <p className="text-xs text-[#6B5A4C]">
                {formatShortDate(activeRequest.classDate)} · {activeRequest.classPeriod}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              {user.role !== 'student' && (
                <div className="col-span-2">
                  <dt className="text-[#6B5A4C]">Student</dt>
                  <dd className="mt-0.5 text-sm font-medium text-[#241710]">
                    {activeRequest.studentName} ({activeRequest.studentIdentifier} ·{' '}
                    {activeRequest.sectionDisplayName})
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[#6B5A4C]">Current Status</dt>
                <dd className="mt-0.5 text-sm font-medium text-[#B42318]">
                  {activeRequest.originalStatus}
                </dd>
              </div>
              <div>
                <dt className="text-[#6B5A4C]">Requested Status</dt>
                <dd className="mt-0.5 text-sm font-medium text-[#165B33]">
                  {activeRequest.requestedStatus}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[#6B5A4C]">Document Category</dt>
                <dd className="mt-0.5 text-sm text-[#241710]">
                  {activeRequest.evidenceFiles[0]?.documentCategory || activeRequest.reason}
                </dd>
              </div>
            </dl>

            {/* Attached Evidence Files */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-[#165B33]">
                Uploaded Evidence ({activeRequest.evidenceFiles.length})
              </div>
              {activeRequest.evidenceFiles.length === 0 ? (
                <div className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs text-[#6B5A4C]">
                  No document attached.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {activeRequest.evidenceFiles.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() =>
                        handleOpenEvidence(activeRequest.id, file.id, file.originalName)
                      }
                      className="w-full flex items-center justify-between rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3 py-2 text-xs text-[#165B33] hover:bg-[#FAF3E3]"
                    >
                      <span className="inline-flex items-center gap-2 truncate">
                        <FileText className="w-3.5 h-3.5 shrink-0 text-[#DF6A24]" />
                        <span className="truncate font-medium text-[#241710]">
                          {file.originalName}
                        </span>
                      </span>
                      <span className="font-semibold text-[#DF6A24] shrink-0 ml-2">
                        Open Proof
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* STUDENT ADDITIONAL DOCUMENT UPLOAD (FILE ONLY — NO TEXT EXPLANATION) */}
            {user.role === 'student' &&
              (activeRequest.workflowStatus === 'Additional Evidence Requested' ||
                (activeRequest.workflowStatus === 'Rejected' && policy.allowAppeals)) && (
                <form
                  onSubmit={handleResubmitEvidence}
                  className="border-t border-[#E3D2B4] pt-4 space-y-3"
                >
                  <div className="text-xs font-semibold text-[#165B33]">
                    Upload Replacement / Additional Document
                  </div>
                  <input
                    type="file"
                    multiple
                    required
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => setResubmitFiles(Array.from(e.target.files || []))}
                    className="block w-full text-xs text-[#6B5A4C] file:mr-3 file:rounded file:border file:border-[#E3D2B4] file:bg-[#FAF3E3] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[#241710]"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded bg-[#165B33] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#104526] disabled:opacity-50"
                  >
                    Upload Document
                  </button>
                </form>
              )}

            {user.role === 'student' &&
              (activeRequest.workflowStatus === 'Submitted' ||
                activeRequest.workflowStatus === 'Under Review' ||
                activeRequest.workflowStatus === 'Additional Evidence Requested') && (
                <div className="border-t border-[#E3D2B4] pt-3">
                  <button
                    type="button"
                    onClick={() => setWithdrawTargetId(activeRequest.id)}
                    className="text-xs font-medium text-[#B42318] hover:underline"
                  >
                    Withdraw submission
                  </button>
                </div>
              )}

            {/* FACULTY / ADMIN DIRECT EVIDENCE VERIFICATION ACTIONS (NO PROSE NOTES) */}
            {canReview &&
              activeRequest.workflowStatus !== 'Approved' &&
              activeRequest.workflowStatus !== 'Rejected' &&
              activeRequest.workflowStatus !== 'Withdrawn' && (
                <div className="border-t border-[#E3D2B4] pt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleReviewDecision('Approved')}
                    className="rounded bg-[#165B33] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#104526] disabled:opacity-50"
                  >
                    Approve Evidence
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleReviewDecision('Additional Evidence Requested')}
                    className="rounded border border-[#E3D2B4] bg-[#FFFDF8] px-3.5 py-1.5 text-xs font-medium text-[#241710] hover:bg-[#FAF3E3] disabled:opacity-50"
                  >
                    Request Clearer Proof
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleReviewDecision('Rejected')}
                    className="rounded border border-[#B42318]/40 bg-white px-3.5 py-1.5 text-xs font-medium text-[#B42318] hover:bg-[#FAF3E3] disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(withdrawTargetId)}
        title="Withdraw evidence submission?"
        description="This closes the submission and leaves the recorded attendance status unchanged."
        confirmLabel="Withdraw"
        variant="danger"
        busy={submitting}
        onCancel={() => setWithdrawTargetId(null)}
        onConfirm={async () => {
          if (!withdrawTargetId) return;
          setSubmitting(true);
          try {
            await api.withdrawCorrection(withdrawTargetId);
            await onRefreshWorkspace();
            setWithdrawTargetId(null);
            setFeedback({ type: 'success', text: 'Submission withdrawn.' });
          } catch (err) {
            setFeedback({
              type: 'error',
              text: err instanceof Error ? err.message : 'Could not withdraw submission.',
            });
          } finally {
            setSubmitting(false);
          }
        }}
      />

      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#241710]/55 p-4">
          <div className="w-full max-w-3xl rounded-md border border-[#E3D2B4] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#E3D2B4] bg-[#FFFDF8] px-4 py-3">
              <span className="text-sm font-semibold text-[#165B33] truncate">
                {previewDoc.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(previewDoc.blobUrl);
                  setPreviewDoc(null);
                }}
                className="rounded p-1 text-[#6B5A4C] hover:bg-[#FAF3E3]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-[#FAF3E3] max-h-[75vh] overflow-auto flex justify-center">
              {previewDoc.mimeType.startsWith('image/') ? (
                <img
                  src={previewDoc.blobUrl}
                  alt={previewDoc.name}
                  className="max-h-[68vh] object-contain rounded border border-[#E3D2B4] bg-white"
                />
              ) : (
                <iframe
                  src={previewDoc.blobUrl}
                  title={previewDoc.name}
                  className="w-full h-[68vh] rounded border border-[#E3D2B4] bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
