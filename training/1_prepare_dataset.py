#!/usr/bin/env python3
"""
Step 1: Dataset Quality Filtering, 5-Point ArcFace Alignment (112x112) & Leakage-Free Split

Reads real, consented raw photos from:
  data/raw/<person_id>/*.jpg|png

Requires a consent manifest (data/raw/consent_manifest.json) listing each
person_id with {"consented": true, "consent_date": "YYYY-MM-DD"} so unconsented
data is never processed.

Uses our local InsightFace SCRFD model (public/models/scrfd_det_500m.onnx) via ONNX Runtime
for fast, 100% offline detection and Umeyama 5-point affine alignment.

Outputs aligned 112x112 RGB images into:
  data/prepared/train/<person_id>/
  data/prepared/val/<person_id>/
  data/prepared/test/<person_id>/
"""

import sys
import os

try:
    import cv2
    import onnxruntime as ort
    import numpy as np
except ImportError:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv_py = os.path.join(base_dir, ".venv", "bin", "python3")
    py311 = "/opt/homebrew/opt/python@3.11/bin/python3.11"
    if os.path.exists(venv_py) and sys.executable != venv_py:
        os.execv(venv_py, [venv_py] + sys.argv)
    elif os.path.exists(py311) and sys.executable != py311:
        os.execv(py311, [py311] + sys.argv)
    else:
        print("[ERROR] Required packages (cv2, onnxruntime, numpy) not found.")
        sys.exit(1)

import argparse
import hashlib
import json
import random
import shutil
from pathlib import Path
from typing import Dict, List, Tuple

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

# Canonical InsightFace 5-point facial landmark reference (112x112)
ARCFACE_DST_5PTS = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


def image_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class LocalScrfdDetector:
    def __init__(self, model_path: Path):
        self.sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name
        self.output_names = [out.name for out in self.sess.get_outputs()]
        self.input_size = 640

    def detect(self, img_bgr: np.ndarray, conf_thresh: float = 0.5) -> List[Dict]:
        h, w = img_bgr.shape[:2]
        im_ratio = h / w
        if im_ratio > 1:
            new_h = 640
            new_w = max(1, round(new_h / im_ratio))
        else:
            new_w = 640
            new_h = max(1, round(new_w * im_ratio))
        det_scale = new_h / h

        resized = cv2.resize(img_bgr, (new_w, new_h))
        padded = np.zeros((640, 640, 3), dtype=np.uint8)
        padded[:new_h, :new_w] = resized

        blob = padded.astype(np.float32)
        blob = (blob - 127.5) / 128.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

        raw_outs = self.sess.run(None, {self.input_name: blob})
        out_map = dict(zip(self.output_names, raw_outs))

        cfg = [
            {'stride': 8, 'score': '443', 'bbox': '446', 'kps': '449'},
            {'stride': 16, 'score': '468', 'bbox': '471', 'kps': '474'},
            {'stride': 32, 'score': '493', 'bbox': '496', 'kps': '499'},
        ]

        detections = []
        for level in cfg:
            stride = level['stride']
            scores = out_map.get(level['score'])
            bboxes = out_map.get(level['bbox'])
            kpss = out_map.get(level['kps'])
            if scores is None or bboxes is None or kpss is None:
                continue

            feat_h, feat_w = self.input_size // stride, self.input_size // stride
            num_anchors = 2

            for r in range(feat_h):
                cy = r * stride
                for c in range(feat_w):
                    cx = c * stride
                    for a in range(num_anchors):
                        idx = (r * feat_w + c) * num_anchors + a
                        score = float(scores[idx, 0])
                        if score < conf_thresh:
                            continue

                        b = bboxes[idx]
                        x1 = max(0.0, min(float(w), (cx - b[0] * stride) / det_scale))
                        y1 = max(0.0, min(float(h), (cy - b[1] * stride) / det_scale))
                        x2 = max(0.0, min(float(w), (cx + b[2] * stride) / det_scale))
                        y2 = max(0.0, min(float(h), (cy + b[3] * stride) / det_scale))

                        k = kpss[idx].reshape(-1, 2)
                        kps = (np.array([[cx, cy]]) + k * stride) / det_scale

                        detections.append({
                            "box": [x1, y1, x2, y2],
                            "score": score,
                            "kps": kps,
                        })

        if not detections:
            return []

        # Sort by score descending
        detections.sort(key=lambda d: d["score"], reverse=True)
        kept = []
        for cand in detections:
            box_a = cand["box"]
            area_a = max(0.0, box_a[2] - box_a[0]) * max(0.0, box_a[3] - box_a[1])
            suppressed = False
            for prev in kept:
                box_b = prev["box"]
                ix1 = max(box_a[0], box_b[0])
                iy1 = max(box_a[1], box_b[1])
                ix2 = min(box_a[2], box_b[2])
                iy2 = min(box_a[3], box_b[3])
                iw = max(0.0, ix2 - ix1)
                ih = max(0.0, iy2 - iy1)
                inter = iw * ih
                area_b = max(0.0, box_b[2] - box_b[0]) * max(0.0, box_b[3] - box_b[1])
                union = area_a + area_b - inter
                if union > 0 and (inter / union) > 0.4:
                    suppressed = True
                    break
            if not suppressed:
                kept.append(cand)

        return kept

        boxes = [d["box"] for d in detections]
        scores = [d["score"] for d in detections]
        indices = cv2.dnn.NMSBoxes(boxes, scores, conf_thresh, 0.4)
        if len(indices) == 0:
            return []

        selected = []
        for i in indices.flatten():
            selected.append(detections[i])
        return selected


def align_face_112(img_bgr: np.ndarray, kps: np.ndarray) -> np.ndarray:
    M, _ = cv2.estimateAffinePartial2D(kps.astype(np.float32), ARCFACE_DST_5PTS, method=cv2.LMEDS)
    if M is None:
        # Fallback to standard warp
        M = cv2.getAffineTransform(kps[:3].astype(np.float32), ARCFACE_DST_5PTS[:3])
    aligned = cv2.warpAffine(img_bgr, M, (112, 112), borderValue=0.0)
    return aligned


def check_quality(aligned_bgr: np.ndarray, det_score: float, kps: np.ndarray) -> Tuple[bool, str]:
    if det_score < 0.60:
        return False, f"low detection score ({det_score:.2f})"

    eye_dist = float(np.linalg.norm(kps[0] - kps[1]))
    if eye_dist < 20.0:
        return False, f"low inter-ocular resolution ({eye_dist:.1f}px)"

    gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))
    if brightness < 25.0 or brightness > 240.0:
        return False, f"poor exposure ({brightness:.1f})"

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if sharpness < 20.0:
        return False, f"blurry image (laplacian={sharpness:.1f})"

    return True, "ok"


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare and align consented facial dataset.")
    default_raw = Path("training/data/raw") if Path("training/data/raw").exists() else Path("data/raw")
    default_out = Path("training/data/prepared") if Path("training/data").exists() else Path("data/prepared")
    parser.add_argument("--raw-dir", type=Path, default=default_raw)
    parser.add_argument("--out-dir", type=Path, default=default_out)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--min-images-per-person", type=int, default=3)
    parser.add_argument("--skip-consent-check", action="store_true")
    args = parser.parse_args()

    if not args.raw_dir.exists():
        raise SystemExit(f"Raw dataset directory not found: {args.raw_dir}")

    consent_path = args.raw_dir / "consent_manifest.json"
    consent_map: Dict[str, dict] = {}
    if not args.skip_consent_check:
        if not consent_path.exists():
            raise SystemExit(
                f"Missing {consent_path}. Create consent_manifest.json confirming consent for each subjectId."
            )
        consent_map = json.loads(consent_path.read_text(encoding="utf-8"))

    model_candidates = [
        Path("public/models/scrfd_det_500m.onnx"),
        Path("../public/models/scrfd_det_500m.onnx"),
        Path(__file__).parent.parent / "public/models/scrfd_det_500m.onnx",
    ]
    model_path = next((p for p in model_candidates if p.exists()), None)
    if not model_path:
        raise SystemExit("SCRFD detection model scrfd_det_500m.onnx not found in public/models.")

    detector = LocalScrfdDetector(model_path)

    if args.out_dir.exists():
        shutil.rmtree(args.out_dir)

    for split in ("train", "val", "test"):
        (args.out_dir / split).mkdir(parents=True, exist_ok=True)

    rng = random.Random(args.seed)
    seen_hashes = set()
    summary = {"accepted_subjects": 0, "rejected_images": [], "splits": {"train": 0, "val": 0, "test": 0}}

    for person_dir in sorted(p for p in args.raw_dir.iterdir() if p.is_dir()):
        subject_id = person_dir.name
        if not args.skip_consent_check:
            entry = consent_map.get(subject_id, {})
            if not entry.get("consented", False):
                print(f"[SKIP] {subject_id}: no explicit consent in consent_manifest.json")
                continue

        aligned_samples: List[Tuple[str, np.ndarray]] = []
        for img_path in sorted(person_dir.iterdir()):
            if img_path.suffix.lower() not in IMAGE_EXTS:
                continue

            digest = image_sha256(img_path)
            if digest in seen_hashes:
                summary["rejected_images"].append({"file": str(img_path), "reason": "duplicate hash"})
                continue
            seen_hashes.add(digest)

            img_bgr = cv2.imread(str(img_path))
            if img_bgr is None:
                summary["rejected_images"].append({"file": str(img_path), "reason": "unreadable file"})
                continue

            faces = detector.detect(img_bgr, conf_thresh=0.55)
            if len(faces) != 1:
                summary["rejected_images"].append(
                    {"file": str(img_path), "reason": f"expected 1 face, found {len(faces)}"}
                )
                continue

            face = faces[0]
            aligned = align_face_112(img_bgr, face["kps"])
            ok, reason = check_quality(aligned, float(face["score"]), face["kps"])
            if not ok:
                summary["rejected_images"].append({"file": str(img_path), "reason": reason})
                continue

            aligned_samples.append((img_path.stem, aligned))

        if len(aligned_samples) < args.min_images_per_person:
            print(
                f"[SKIP] {subject_id}: only {len(aligned_samples)} valid images (need >= {args.min_images_per_person})"
            )
            continue

        rng.shuffle(aligned_samples)
        n = len(aligned_samples)
        if n >= 5:
            n_test = 2
            n_val = 1
        elif n >= 4:
            n_test = 2
            n_val = 1
        else:
            n_val = 1
            n_test = 1

        split_buckets = {
            "val": aligned_samples[:n_val],
            "test": aligned_samples[n_val : n_val + n_test],
            "train": aligned_samples[n_val + n_test :],
        }

        for split_name, items in split_buckets.items():
            dest_dir = args.out_dir / split_name / subject_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            for idx, (stem, aligned_img) in enumerate(items):
                out_file = dest_dir / f"{idx:03d}_{stem}.png"
                cv2.imwrite(str(out_file), aligned_img)
                summary["splits"][split_name] += 1

        summary["accepted_subjects"] += 1
        print(
            f"[OK] {subject_id}: train={len(split_buckets['train'])}, val={len(split_buckets['val'])}, test={len(split_buckets['test'])}"
        )

    (args.out_dir / "dataset_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("\nDataset preparation complete:", json.dumps(summary["splits"]))


if __name__ == "__main__":
    main()
