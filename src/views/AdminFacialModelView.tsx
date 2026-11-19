import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  BrainCircuit,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileCheck2,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Square,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client.ts';
import {
  EnrolledSubjectRecord,
  FaceQualityMetrics,
  InstitutionalPolicy,
  ModelCalibrationReport,
  ModelVersionRecord,
  TrainingJobStatus,
  UserProfile,
} from '../shared/types.ts';

interface AdminFacialModelViewProps {
  user: UserProfile;
  policy: InstitutionalPolicy;
}

type TabType = 'enrollment' | 'dataset' | 'training' | 'models_calibration';

export const AdminFacialModelView: React.FC<AdminFacialModelViewProps> = ({ user, policy }) => {
  const [activeTab, setActiveTab] = useState<TabType>('enrollment');
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Enrollment State
  const [enrolledSubjects, setEnrolledSubjects] = useState<EnrolledSubjectRecord[]>([]);
  const [allStudents, setAllStudents] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<UserProfile | null>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState<boolean>(false);

  // Modal capture state
  const [consentConfirmed, setConsentConfirmed] = useState<boolean>(false);
  const [capturedImages, setCapturedImages] = useState<
    Array<{
      base64: string;
      angleLabel: string;
      lightingLabel: string;
      qualityScore?: number;
    }>
  >([]);
  const [selectedAngle, setSelectedAngle] = useState<string>('Frontal');
  const [selectedLighting, setSelectedLighting] = useState<string>('Normal Indoor');
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [qualityTesting, setQualityTesting] = useState<boolean>(false);
  const [lastQualityReport, setLastQualityReport] = useState<FaceQualityMetrics | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Robust callback ref ensures video element receives media stream immediately when mounted
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  }, []);

  // Ensure webcam stream is attached if element mounts after state transition
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraActive]);

  // Training & Model Registry State
  const [trainingStatus, setTrainingStatus] = useState<TrainingJobStatus | null>(null);
  const [epochs, setEpochs] = useState<number>(20);
  const [batchSize, setBatchSize] = useState<number>(16);
  const [learningRate, setLearningRate] = useState<number>(0.0003);
  const [modelVersions, setModelVersions] = useState<ModelVersionRecord[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string>('');
  const [calibrationReport, setCalibrationReport] = useState<ModelCalibrationReport | null>(null);
  const [evaluating, setEvaluating] = useState<boolean>(false);
  const [preparingData, setPreparingData] = useState<boolean>(false);

  const pollIntervalRef = useRef<number | null>(null);

  // Load initial data
  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [subjectsRes, studentsRes, modelsRes, trainRes, calibRes] = await Promise.all([
        api.getFacialSubjects().catch(() => ({ count: 0, subjects: [] })),
        api.getUsers({ role: 'student' }).catch(() => ({ users: [] })),
        api.getModelRegistry().catch(() => ({
          activeVersionId: 'arcface-v1-official-webface600k',
          previousActiveVersionId: null,
          versions: [],
          lastUpdated: '',
        })),
        api.getModelTrainingStatus().catch(() => null),
        api.getCachedCalibrationReport().catch(() => null),
      ]);

      setEnrolledSubjects(subjectsRes.subjects || []);
      setAllStudents(studentsRes.users || []);
      setModelVersions(modelsRes.versions || []);
      setActiveVersionId(modelsRes.activeVersionId || '');
      setTrainingStatus(trainRes);
      setCalibrationReport(calibRes);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load facial recognition status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Polling training status when training is running
  useEffect(() => {
    if (trainingStatus?.state === 'training' || trainingStatus?.state === 'preparing') {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = window.setInterval(async () => {
          try {
            const st = await api.getModelTrainingStatus();
            setTrainingStatus(st);
            if (st.state === 'completed' || st.state === 'failed' || st.state === 'stopped') {
              clearInterval(pollIntervalRef.current!);
              pollIntervalRef.current = null;
              loadData();
            }
          } catch {
            // ignore polling errors
          }
        }, 1500);
      }
    } else if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [trainingStatus?.state, loadData]);

  // Camera Management for Enrollment
  const startEnrollCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setErrorMsg('Unable to access webcam. You can also upload sample photos directly.');
    }
  };

  const stopEnrollCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const captureFrameFromWebcam = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.92);

    setQualityTesting(true);
    try {
      const qReport = await api.testFaceImageQuality(base64, selectedAngle);
      setLastQualityReport(qReport);

      if (!qReport.passed) {
        setErrorMsg(`Sample rejected: ${qReport.failureReason}`);
        return;
      }

      setCapturedImages((prev) => [
        ...prev,
        {
          base64,
          angleLabel: selectedAngle,
          lightingLabel: selectedLighting,
          qualityScore: Math.round(qReport.sharpnessScore),
        },
      ]);
      setSuccessMsg(`Sample captured successfully (${selectedAngle}, ${selectedLighting})!`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Quality check failed.');
    } finally {
      setQualityTesting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rawDataUrl = reader.result as string;
        // Normalize any image format (PNG, WebP, JPEG) to JPEG data URL via offscreen canvas
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 640;
          canvas.height = img.naturalHeight || 480;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.92);

          setQualityTesting(true);
          try {
            const qReport = await api.testFaceImageQuality(base64, selectedAngle);
            setLastQualityReport(qReport);
            if (qReport.passed) {
              setCapturedImages((prev) => [
                ...prev,
                {
                  base64,
                  angleLabel: selectedAngle,
                  lightingLabel: selectedLighting,
                  qualityScore: Math.round(qReport.sharpnessScore),
                },
              ]);
              setSuccessMsg(`File ${file.name} validated and added!`);
            } else {
              setErrorMsg(`File ${file.name} rejected: ${qReport.failureReason}`);
            }
          } catch (err) {
            setErrorMsg(`Failed to test quality for ${file.name}`);
          } finally {
            setQualityTesting(false);
          }
        };
        img.onerror = () => {
          setErrorMsg(`Unable to process image file ${file.name}.`);
        };
        img.src = rawDataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSaveEnrollment = async () => {
    if (!selectedStudent) {
      setErrorMsg('Please select a student.');
      return;
    }
    if (!consentConfirmed) {
      setErrorMsg('Explicit informed consent is required by policy.');
      return;
    }
    if (capturedImages.length === 0) {
      setErrorMsg('Please capture or upload at least one valid facial sample.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.enrollFacialSubject({
        subjectId: selectedStudent.identifier,
        displayName: selectedStudent.name,
        imagesBase64: capturedImages.map((c) => c.base64),
        sampleLabels: capturedImages.map((c) => ({
          angleLabel: c.angleLabel,
          lightingLabel: c.lightingLabel,
          qualityScore: c.qualityScore,
        })),
        consentConfirmed: true,
        mode: 'append',
      });

      setSuccessMsg(`Successfully enrolled ${res.subject.displayName} (${res.subject.subjectId}) with ${res.subject.samples.length} consented samples! 512-D ArcFace template encrypted at rest.`);
      setIsEnrollModalOpen(false);
      stopEnrollCamera();
      setCapturedImages([]);
      setConsentConfirmed(false);
      setSelectedStudent(null);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Enrollment failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId: string) => {
    if (!confirm(`Are you sure you want to remove the facial biometric reference for ${subjectId}? The student will not be able to mark attendance until re-enrolled.`)) {
      return;
    }
    setLoading(true);
    try {
      await api.deleteFacialSubject(subjectId);
      setSuccessMsg(`Facial reference for ${subjectId} deleted.`);
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete facial reference.');
    } finally {
      setLoading(false);
    }
  };

  // Dataset Prep
  const handlePrepareDataset = async () => {
    setPreparingData(true);
    setErrorMsg(null);
    try {
      const res = await api.prepareDataset({ seed: 42, minImagesPerPerson: 2 });
      if (res.ok) {
        setSuccessMsg(res.message);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Dataset preparation failed.');
    } finally {
      setPreparingData(false);
    }
  };

  // Fine-Tuning Execution
  const handleStartTraining = async () => {
    setErrorMsg(null);
    try {
      const res = await api.startModelTraining({
        epochs,
        batchSize,
        learningRate,
        seed: 42,
      });
      if (res.ok) {
        setSuccessMsg(res.message);
        const st = await api.getModelTrainingStatus();
        setTrainingStatus(st);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start fine-tuning.');
    }
  };

  const handleStopTraining = async () => {
    try {
      await api.stopModelTraining();
      setSuccessMsg('Training termination requested.');
      const st = await api.getModelTrainingStatus();
      setTrainingStatus(st);
    } catch (err) {
      setErrorMsg('Failed to stop training.');
    }
  };

  // Evaluation & Calibration
  const handleRunEvaluation = async (onnxPath?: string) => {
    setEvaluating(true);
    setErrorMsg(null);
    try {
      const res = await api.evaluateModel({ onnxPath });
      if (res.ok && res.report) {
        setCalibrationReport(res.report);
        setSuccessMsg(`Evaluation completed! Evaluated ${res.report.testSampleCount} test samples (${res.report.genuinePairsEvaluated} genuine & ${res.report.impostorPairsEvaluated} impostor pairs). Optimal threshold: ${res.report.bestThreshold} (EER: ${(res.report.bestEer * 100).toFixed(2)}%).`);
      } else {
        setErrorMsg(res.message || 'Evaluation failed.');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      setEvaluating(false);
    }
  };

  // Deployment & Rollback
  const handleDeployModel = async (versionId: string) => {
    if (!confirm('Deploy this model version to production for live student attendance verification?')) return;
    setLoading(true);
    try {
      const res = await api.deployModel(versionId);
      if (res.ok) {
        setSuccessMsg(res.message);
        await loadData();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to deploy model.');
    } finally {
      setLoading(false);
    }
  };

  const handleRollbackModel = async () => {
    if (!confirm('Roll back to the previous model version?')) return;
    setLoading(true);
    try {
      const res = await api.rollbackModel();
      if (res.ok) {
        setSuccessMsg(res.message);
        await loadData();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = allStudents.filter((s) => {
    const q = searchTerm.toLowerCase();
    return (
      s.identifier.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.sectionDisplayName || '').toLowerCase().includes(q)
    );
  });

  const enrolledSubjectIds = new Set(enrolledSubjects.map((s) => s.subjectId));

  return (
    <div className="space-y-6 pb-12">
      {/* Header with VTU Institutional Styling */}
      <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-[#165B33] text-white flex items-center justify-center shrink-0 shadow-sm">
              <BrainCircuit className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-display text-[#165B33]">
                  Facial Recognition & AI Model Platform
                </h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#165B33]/10 text-[#165B33] border border-[#165B33]/20">
                  ArcFace 512-D
                </span>
              </div>
              <p className="text-xs text-[#241710]/70 mt-1">
                Institutional Biometric Enrollment, Pretrained MobileFaceNet Inference, Real Consent Management & PyTorch Fine-Tuning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#E3D2B4] bg-white text-[#241710] hover:bg-[#FAF3E3] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Global Notifications */}
        {errorMsg && (
          <div className="mt-4 p-3 rounded-md bg-[#FEF3F2] border border-[#FECDCA] text-[#B42318] text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button type="button" onClick={() => setErrorMsg(null)} className="text-[#B42318] hover:text-[#7A271A]">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mt-4 p-3 rounded-md bg-[#EDF7ED] border border-[#C8E6C9] text-[#1E4620] text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button type="button" onClick={() => setSuccessMsg(null)} className="text-[#1E4620] hover:text-[#0E2810]">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mt-6 flex flex-wrap border-b border-[#E3D2B4] gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('enrollment')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'enrollment'
                ? 'border-[#DF6A24] text-[#DF6A24]'
                : 'border-transparent text-[#241710]/70 hover:text-[#241710]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Consented Student Enrollment ({enrolledSubjects.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('dataset')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'dataset'
                ? 'border-[#DF6A24] text-[#DF6A24]'
                : 'border-transparent text-[#241710]/70 hover:text-[#241710]'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Labelled Dataset Management</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('training')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'training'
                ? 'border-[#DF6A24] text-[#DF6A24]'
                : 'border-transparent text-[#241710]/70 hover:text-[#241710]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Model Training & Fine-Tuning</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('models_calibration')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'models_calibration'
                ? 'border-[#DF6A24] text-[#DF6A24]'
                : 'border-transparent text-[#241710]/70 hover:text-[#241710]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Calibration & Model Versions</span>
          </button>
        </div>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: CONSENTED STUDENT ENROLLMENT                                   */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'enrollment' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-4">
              <div className="text-xs text-[#241710]/70">Total Enrolled Students</div>
              <div className="text-2xl font-bold font-display text-[#165B33] mt-1">
                {enrolledSubjects.length}
              </div>
              <div className="text-[11px] text-[#241710]/60 mt-0.5">
                Out of {allStudents.length} institutional students
              </div>
            </div>

            <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-4">
              <div className="text-xs text-[#241710]/70">Biometric Template Storage</div>
              <div className="text-2xl font-bold font-display text-[#DF6A24] mt-1">
                AES-256-GCM
              </div>
              <div className="text-[11px] text-[#241710]/60 mt-0.5">
                Encrypted at rest with PBKDF2/SHA-256 key
              </div>
            </div>

            <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-4">
              <div className="text-xs text-[#241710]/70">Active Verification Model</div>
              <div className="text-lg font-bold font-display text-[#165B33] mt-1 truncate">
                InsightFace MobileFaceNet
              </div>
              <div className="text-[11px] text-[#241710]/60 mt-0.5">
                512-D L2 Embeddings · WebFace600K
              </div>
            </div>
          </div>

          {/* Student Enrollment Table */}
          <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[#E3D2B4] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-[#241710]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search student USN, name, section..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-[#E3D2B4] bg-white text-[#241710] focus:outline-none focus:border-[#DF6A24]"
                />
              </div>

              <div className="text-xs text-[#241710]/70">
                Showing {filteredStudents.length} students
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF3E3] text-[#241710]/80 font-semibold border-b border-[#E3D2B4]">
                  <tr>
                    <th className="px-4 py-3">USN</th>
                    <th className="px-4 py-3">Student Name</th>
                    <th className="px-4 py-3">Section</th>
                    <th className="px-4 py-3">Facial Reference Status</th>
                    <th className="px-4 py-3">Samples</th>
                    <th className="px-4 py-3">Consent Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3D2B4]">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-[#241710]/60">
                        No students matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((st) => {
                      const enrolled = enrolledSubjects.find(
                        (e) => e.subjectId === st.identifier || e.subjectId === st.id
                      );

                      return (
                        <tr key={st.id} className="hover:bg-[#FAF3E3]/50 transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-[#165B33]">
                            {st.identifier}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#241710]">
                            {st.name}
                          </td>
                          <td className="px-4 py-3 text-[#241710]/70">
                            {st.sectionDisplayName || 'Section A'}
                          </td>
                          <td className="px-4 py-3">
                            {enrolled ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EDF7ED] text-[#165B33] border border-[#C8E6C9]">
                                <UserCheck className="w-3 h-3" />
                                Enrolled
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFF4E5] text-[#B54708] border border-[#FEDF89]">
                                <AlertTriangle className="w-3 h-3" />
                                Not Enrolled
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            {enrolled ? (
                              <span>{enrolled.samples?.length || enrolled.embeddings?.length || 1} samples</span>
                            ) : (
                              <span className="text-[#241710]/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {enrolled?.consentConfirmed ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#165B33]">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Verified ({new Date(enrolled.consentRecordedAt || Date.now()).toLocaleDateString()})
                              </span>
                            ) : (
                              <span className="text-[11px] text-[#241710]/40">Pending consent</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedStudent(st);
                                  setIsEnrollModalOpen(true);
                                  setConsentConfirmed(Boolean(enrolled?.consentConfirmed));
                                  setCapturedImages([]);
                                }}
                                className="px-2.5 py-1 text-[11px] font-medium rounded border border-[#165B33] bg-[#165B33] text-white hover:bg-[#124b2a] transition-colors"
                              >
                                {enrolled ? 'Update Reference' : 'Enroll Student'}
                              </button>

                              {enrolled && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSubject(enrolled.subjectId)}
                                  title="Delete facial reference"
                                  className="p-1 rounded text-[#B42318] hover:bg-[#FEF3F2] transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Enrollment Modal */}
          {isEnrollModalOpen && selectedStudent && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#241710]/60 backdrop-blur-xs">
              <div className="w-full max-w-2xl bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-[#E3D2B4] flex items-center justify-between bg-[#165B33] text-white">
                  <div>
                    <h2 className="text-sm font-bold font-display">
                      Enroll Consented Facial Reference
                    </h2>
                    <p className="text-xs text-white/80">
                      {selectedStudent.name} · USN: {selectedStudent.identifier}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEnrollModalOpen(false);
                      stopEnrollCamera();
                    }}
                    className="p-1 rounded text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 overflow-y-auto space-y-4 flex-1">
                  {/* Mandatory Consent Checkbox */}
                  <div className="p-3 rounded-md bg-[#FAF3E3] border border-[#E3D2B4]">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentConfirmed}
                        onChange={(e) => setConsentConfirmed(e.target.checked)}
                        className="mt-0.5 rounded text-[#165B33] focus:ring-[#165B33]"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-[#165B33]">
                          Mandatory Student Consent Verification
                        </span>
                        <p className="text-[#241710]/75 mt-0.5">
                          I certify that {selectedStudent.name} ({selectedStudent.identifier}) has given explicit consent for biometric template creation and verification solely for attendance records. Data will never be sold or shared.
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Sample Attributes */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#241710] mb-1">
                        Pose / Angle Label
                      </label>
                      <select
                        value={selectedAngle}
                        onChange={(e) => setSelectedAngle(e.target.value)}
                        className="w-full text-xs rounded border border-[#E3D2B4] p-1.5 bg-white"
                      >
                        <option value="Frontal">Frontal (Neutral)</option>
                        <option value="Turn Left ~15°">Turn Left ~15°</option>
                        <option value="Turn Right ~15°">Turn Right ~15°</option>
                        <option value="Slight Tilt Up">Slight Tilt Up</option>
                        <option value="Slight Tilt Down">Slight Tilt Down</option>
                        <option value="With Spectacles">With Spectacles (if worn)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#241710] mb-1">
                        Lighting Condition Label
                      </label>
                      <select
                        value={selectedLighting}
                        onChange={(e) => setSelectedLighting(e.target.value)}
                        className="w-full text-xs rounded border border-[#E3D2B4] p-1.5 bg-white"
                      >
                        <option value="Normal Indoor">Normal Indoor Classroom</option>
                        <option value="Bright / Daylight">Bright / Daylight</option>
                        <option value="Low-Light Ambient">Low-Light Ambient</option>
                      </select>
                    </div>
                  </div>

                  {/* Camera / Upload Section */}
                  <div className="border border-[#E3D2B4] rounded-lg p-3 bg-white">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-[#165B33]">
                        Capture or Upload Genuine Samples
                      </span>
                      <div className="flex items-center gap-2">
                        {!isCameraActive ? (
                          <button
                            type="button"
                            onClick={startEnrollCamera}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#165B33] text-white hover:bg-[#124b2a]"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>Start Webcam</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={stopEnrollCamera}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#B42318] text-white hover:bg-[#911b12]"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Stop Webcam</span>
                          </button>
                        )}
                        <label className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[#E3D2B4] bg-[#FAF3E3] text-[#241710] hover:bg-[#E3D2B4] cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload Photos</span>
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    {isCameraActive && (
                      <div className="relative aspect-4/3 w-full max-w-sm mx-auto bg-black rounded overflow-hidden mb-3">
                        <video ref={setVideoRef} playsInline autoPlay muted className="w-full h-full object-cover -scale-x-100" />
                        <div className="absolute inset-0 border-2 border-dashed border-[#DF6A24]/70 rounded-full m-8 pointer-events-none" />
                        <div className="absolute bottom-2 inset-x-0 flex justify-center">
                          <button
                            type="button"
                            onClick={captureFrameFromWebcam}
                            disabled={qualityTesting}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#DF6A24] text-white text-xs font-bold shadow-md hover:bg-[#c95817] disabled:opacity-50"
                          >
                            <Camera className="w-4 h-4" />
                            <span>{qualityTesting ? 'Validating...' : 'Capture Frame'}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quality Gate Status */}
                    {lastQualityReport && (
                      <div className={`p-2.5 rounded text-xs mb-3 ${lastQualityReport.passed ? 'bg-[#EDF7ED] text-[#165B33]' : 'bg-[#FEF3F2] text-[#B42318]'}`}>
                        <div className="font-semibold flex items-center gap-1">
                          {lastQualityReport.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          Quality Gate: {lastQualityReport.passed ? 'PASSED' : 'REJECTED'}
                        </div>
                        <div className="text-[11px] mt-1 grid grid-cols-3 gap-2">
                          <div>Sharpness: {Math.round(lastQualityReport.sharpnessScore)} (min 20)</div>
                          <div>Luminance: {Math.round(lastQualityReport.luminanceScore)}</div>
                          <div>Resolution: {Math.round(lastQualityReport.interOcularPx)}px</div>
                        </div>
                        {lastQualityReport.failureReason && (
                          <div className="text-[11px] font-medium mt-1">Reason: {lastQualityReport.failureReason}</div>
                        )}
                      </div>
                    )}

                    {/* Captured Images Strip */}
                    <div>
                      <div className="text-xs font-medium text-[#241710] mb-2 flex items-center justify-between">
                        <span>Captured Samples ({capturedImages.length})</span>
                        <span className="text-[11px] text-[#241710]/60">Minimum 1 sample; 3-5 recommended across angles</span>
                      </div>
                      {capturedImages.length === 0 ? (
                        <div className="text-center py-6 text-xs text-[#241710]/50 border border-dashed border-[#E3D2B4] rounded">
                          No samples captured yet. Use the webcam or upload files above.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {capturedImages.map((img, idx) => (
                            <div key={idx} className="relative group border border-[#E3D2B4] rounded overflow-hidden bg-black">
                              <img src={img.base64} alt={`Sample ${idx + 1}`} className="w-full h-20 object-cover" />
                              <div className="absolute inset-x-0 bottom-0 bg-black/70 text-white p-1 text-[9px] truncate">
                                {img.angleLabel}
                              </div>
                              <button
                                type="button"
                                onClick={() => setCapturedImages((prev) => prev.filter((_, i) => i !== idx))}
                                className="absolute top-1 right-1 p-0.5 rounded bg-red-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-[#E3D2B4] flex items-center justify-end gap-2 bg-[#FAF3E3]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEnrollModalOpen(false);
                      stopEnrollCamera();
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded border border-[#E3D2B4] bg-white text-[#241710] hover:bg-[#FAF3E3]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEnrollment}
                    disabled={!consentConfirmed || capturedImages.length === 0 || loading}
                    className="px-4 py-1.5 text-xs font-semibold rounded bg-[#165B33] text-white hover:bg-[#124b2a] disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {loading ? 'Processing & Encrypting...' : 'Save & Encrypt Biometrics'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 2: LABELLED DATASET MANAGEMENT                                   */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'dataset' && (
        <div className="space-y-6">
          <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-5">
            <h2 className="text-sm font-bold font-display text-[#165B33]">
              Consented Dataset Preparation & Zero-Leakage Splitting
            </h2>
            <p className="text-xs text-[#241710]/75 mt-1">
              Prepares raw student captures from <code className="bg-[#FAF3E3] px-1 py-0.5 rounded text-[11px]">training/data/raw/</code> with InsightFace 5-point landmark alignment into standardized 112×112 RGB tensors. Deduplicates identical image SHA-256 hashes to guarantee no data leakage between splits.
            </p>

            <div className="mt-4 p-4 rounded-md bg-[#FAF3E3] border border-[#E3D2B4] flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-[#165B33]">
                  Split Ratios: 70% Train · 15% Validation · 15% Held-Out Test
                </div>
                <div className="text-[11px] text-[#241710]/70 mt-0.5">
                  Controlled with deterministic seed 42. Verification consent verified via consent_manifest.json.
                </div>
              </div>

              <button
                type="button"
                onClick={handlePrepareDataset}
                disabled={preparingData}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded bg-[#165B33] text-white hover:bg-[#124b2a] disabled:opacity-50 transition-colors shadow-sm shrink-0"
              >
                <Database className={`w-3.5 h-3.5 ${preparingData ? 'animate-spin' : ''}`} />
                <span>{preparingData ? 'Aligning & Splitting...' : 'Prepare & Align Dataset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 3: MODEL TRAINING & FINE-TUNING                                   */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'training' && (
        <div className="space-y-6">
          {/* Important Distinction Banner */}
          <div className="bg-[#FFF4E5] border border-[#FEDF89] rounded-lg p-4 text-[#B54708] text-xs">
            <div className="flex items-center gap-2 font-bold text-sm text-[#B54708]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Normal Student Enrollment vs. Genuine PyTorch Fine-Tuning</span>
            </div>
            <p className="mt-1 text-[#241710]/80">
              <strong>Normal Student Enrollment</strong> extracts 512-D ArcFace embeddings using the active pretrained model without training or changing neural weights.
              <br />
              <strong>Model Fine-Tuning</strong> is genuine backpropagation on the MobileFaceNet backbone using Additive Angular Margin loss (ArcFace: scale=64.0, margin=0.50) to adapt to campus cameras and lighting.
            </p>
          </div>

          {/* Hyperparameters & Controls */}
          <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-5">
            <h2 className="text-sm font-bold font-display text-[#165B33] flex items-center justify-between">
              <span>PyTorch ArcFace Fine-Tuning Configuration</span>
              <span className="text-xs font-normal text-[#241710]/70">
                Hardware: <strong className="text-[#165B33]">{trainingStatus?.device || 'Apple Silicon MPS'}</strong>
              </span>
            </h2>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#241710] mb-1">
                  Epochs (1 – 100)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={epochs}
                  disabled={trainingStatus?.state === 'training'}
                  onChange={(e) => setEpochs(parseInt(e.target.value, 10) || 20)}
                  className="w-full text-xs rounded border border-[#E3D2B4] p-2 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#241710] mb-1">
                  Batch Size (8, 16, 32)
                </label>
                <input
                  type="number"
                  min={4}
                  max={64}
                  value={batchSize}
                  disabled={trainingStatus?.state === 'training'}
                  onChange={(e) => setBatchSize(parseInt(e.target.value, 10) || 16)}
                  className="w-full text-xs rounded border border-[#E3D2B4] p-2 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#241710] mb-1">
                  Learning Rate
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={learningRate}
                  disabled={trainingStatus?.state === 'training'}
                  onChange={(e) => setLearningRate(parseFloat(e.target.value) || 0.0003)}
                  className="w-full text-xs rounded border border-[#E3D2B4] p-2 bg-white"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[#E3D2B4] pt-4">
              <div className="text-xs text-[#241710]/70">
                Loss Function: <strong>Additive Angular Margin (ArcFace)</strong> · Margin: <strong>0.50</strong> · Scale: <strong>64.0</strong>
              </div>

              <div className="flex items-center gap-2">
                {trainingStatus?.state === 'training' ? (
                  <button
                    type="button"
                    onClick={handleStopTraining}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded bg-[#B42318] text-white hover:bg-[#911b12] transition-colors shadow-sm"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Stop Training</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartTraining}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded bg-[#165B33] text-white hover:bg-[#124b2a] transition-colors shadow-sm"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Start Fine-Tuning</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Training Progress & Metrics */}
          {trainingStatus && (
            <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    trainingStatus.state === 'training' ? 'bg-[#DF6A24] animate-ping' :
                    trainingStatus.state === 'completed' ? 'bg-[#165B33]' : 'bg-gray-400'
                  }`} />
                  <h3 className="text-sm font-bold font-display text-[#165B33] uppercase">
                    Status: {trainingStatus.state}
                  </h3>
                </div>

                <div className="text-xs text-[#241710]/70 font-mono">
                  Epoch {trainingStatus.currentEpoch} / {trainingStatus.totalEpochs || 20}
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Current Loss</div>
                  <div className="text-lg font-bold font-mono text-[#241710] mt-0.5">
                    {trainingStatus.currentLoss !== null ? trainingStatus.currentLoss.toFixed(4) : '—'}
                  </div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Best Val EER</div>
                  <div className="text-lg font-bold font-mono text-[#165B33] mt-0.5">
                    {trainingStatus.bestValEer !== null ? `${(trainingStatus.bestValEer * 100).toFixed(2)}%` : '—'}
                  </div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Best Threshold</div>
                  <div className="text-lg font-bold font-mono text-[#DF6A24] mt-0.5">
                    {trainingStatus.bestValThreshold !== null ? trainingStatus.bestValThreshold.toFixed(3) : '—'}
                  </div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Dataset Identities</div>
                  <div className="text-lg font-bold font-mono text-[#241710] mt-0.5">
                    {trainingStatus.datasetIdentities || 0}
                  </div>
                </div>
              </div>

              {/* Live Terminal Log Stream */}
              <div className="mt-4">
                <div className="text-xs font-semibold text-[#241710] mb-1">
                  Training Engine Output Logs
                </div>
                <div className="bg-[#1C1613] text-[#FAF3E3] font-mono text-[11px] p-3 rounded-md h-52 overflow-y-auto space-y-1">
                  {trainingStatus.logs && trainingStatus.logs.length > 0 ? (
                    trainingStatus.logs.map((log, i) => (
                      <div key={i} className="leading-relaxed">
                        {log}
                      </div>
                    ))
                  ) : (
                    <div className="text-white/40">Waiting for training process to initialize...</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 4: CALIBRATION & MODEL VERSIONS                                  */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === 'models_calibration' && (
        <div className="space-y-6">
          {/* Active Model & Benchmark Banner */}
          <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold font-display text-[#165B33]">
                    Model Evaluation, FAR/FRR Calibration & Safe Rollback
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#165B33] text-white">
                    Active in Production
                  </span>
                </div>
                <p className="text-xs text-[#241710]/70 mt-1">
                  Evaluates true False Acceptance Rate (FAR), False Rejection Rate (FRR), and Equal Error Rate (EER) across threshold sweep [0.20 .. 0.75] on real test data.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRunEvaluation()}
                  disabled={evaluating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-[#DF6A24] text-white hover:bg-[#c95817] disabled:opacity-50 transition-colors shadow-sm shrink-0"
                >
                  <Sliders className={`w-3.5 h-3.5 ${evaluating ? 'animate-spin' : ''}`} />
                  <span>{evaluating ? 'Computing Metrics...' : 'Benchmark Active Model'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRollbackModel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-[#B42318] text-[#B42318] hover:bg-[#FEF3F2] transition-colors shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Roll Back</span>
                </button>
              </div>
            </div>
          </div>

          {/* Calibration Report Summary */}
          {calibrationReport && (
            <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg p-5">
              <h3 className="text-xs font-bold font-display text-[#165B33] uppercase mb-3">
                Held-Out Test Set Metrics & Calibration Sweep
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Optimal Threshold</div>
                  <div className="text-xl font-bold font-mono text-[#DF6A24] mt-0.5">
                    {calibrationReport.bestThreshold.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[#241710]/60 mt-0.5">Recommended for attendance</div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Equal Error Rate (EER)</div>
                  <div className="text-xl font-bold font-mono text-[#165B33] mt-0.5">
                    {(calibrationReport.bestEer * 100).toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-[#241710]/60 mt-0.5">FAR = FRR cross point</div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Genuine Pairs Tested</div>
                  <div className="text-xl font-bold font-mono text-[#241710] mt-0.5">
                    {calibrationReport.genuinePairsEvaluated}
                  </div>
                  <div className="text-[10px] text-[#241710]/60 mt-0.5">Same-subject comparisons</div>
                </div>

                <div className="p-3 rounded bg-[#FAF3E3] border border-[#E3D2B4]">
                  <div className="text-[11px] text-[#241710]/70">Impostor Pairs Tested</div>
                  <div className="text-xl font-bold font-mono text-[#241710] mt-0.5">
                    {calibrationReport.impostorPairsEvaluated}
                  </div>
                  <div className="text-[10px] text-[#241710]/60 mt-0.5">Different-subject comparisons</div>
                </div>
              </div>

              {/* Calibration Threshold Table */}
              {calibrationReport.curve && calibrationReport.curve.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FAF3E3] text-[#241710]/80 font-semibold border-b border-[#E3D2B4]">
                      <tr>
                        <th className="px-3 py-2">Cosine Threshold</th>
                        <th className="px-3 py-2">FAR (False Acceptance)</th>
                        <th className="px-3 py-2">FRR (False Rejection)</th>
                        <th className="px-3 py-2">TAR (True Acceptance)</th>
                        <th className="px-3 py-2">Attendance Security Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3D2B4]">
                      {calibrationReport.curve.map((row, i) => {
                        const isRecommended = Math.abs(row.threshold - calibrationReport.bestThreshold) < 0.01;
                        return (
                          <tr key={i} className={isRecommended ? 'bg-[#EDF7ED]/70 font-semibold text-[#165B33]' : 'hover:bg-[#FAF3E3]/40'}>
                            <td className="px-3 py-1.5 font-mono">
                              {row.threshold.toFixed(2)}
                              {isRecommended && <span className="ml-2 text-[10px] bg-[#165B33] text-white px-1.5 py-0.5 rounded">RECOMMENDED</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-red-600">{(row.far * 100).toFixed(2)}%</td>
                            <td className="px-3 py-1.5 font-mono text-amber-600">{(row.frr * 100).toFixed(2)}%</td>
                            <td className="px-3 py-1.5 font-mono text-emerald-600">{((1 - row.frr) * 100).toFixed(2)}%</td>
                            <td className="px-3 py-1.5 text-[11px]">
                              {row.far < 0.001 ? 'High Institutional Security (FAR < 0.1%)' : row.far < 0.01 ? 'Standard Classroom (FAR < 1%)' : 'Permissive'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Model Registry Version History */}
          <div className="bg-[#FFFDF8] border border-[#E3D2B4] rounded-lg overflow-hidden shadow-sm">
            <div className="p-4 border-b border-[#E3D2B4] bg-[#FAF3E3]">
              <h3 className="text-xs font-bold font-display text-[#165B33] uppercase">
                Model Versions & Deployment Rollback Registry
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FAF3E3] text-[#241710]/80 font-semibold border-b border-[#E3D2B4]">
                  <tr>
                    <th className="px-4 py-3">Version Name</th>
                    <th className="px-4 py-3">Architecture</th>
                    <th className="px-4 py-3">Trained On</th>
                    <th className="px-4 py-3">Val EER</th>
                    <th className="px-4 py-3">Recommended Threshold</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3D2B4]">
                  {modelVersions.map((ver) => (
                    <tr key={ver.id} className="hover:bg-[#FAF3E3]/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-[#241710]">
                        <div>{ver.versionName}</div>
                        <div className="font-mono text-[10px] text-[#241710]/50">{ver.id}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#165B33]">
                        {ver.backboneArchitecture}
                      </td>
                      <td className="px-4 py-3 text-[#241710]/70">
                        {ver.trainedOn}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {(ver.valEer * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 font-mono text-[#DF6A24]">
                        {ver.recommendedThreshold.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        {ver.status === 'active' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EDF7ED] text-[#165B33] border border-[#C8E6C9]">
                            Active
                          </span>
                        ) : ver.status === 'candidate' ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]">
                            Candidate
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700">
                            Standby
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {ver.status !== 'active' && (
                            <button
                              type="button"
                              onClick={() => handleDeployModel(ver.id)}
                              className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#165B33] text-white hover:bg-[#124b2a] transition-colors"
                            >
                              Deploy Version
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRunEvaluation(ver.onnxPath)}
                            disabled={evaluating}
                            className="px-2 py-1 text-[11px] font-medium rounded border border-[#E3D2B4] text-[#241710] hover:bg-[#FAF3E3] transition-colors"
                          >
                            Evaluate
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
