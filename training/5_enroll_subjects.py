#!/usr/bin/env python3
"""
Step 5: Enroll New People or Update Consented References Without Retraining

Reads real consented images from data/enroll/<subject_id>/*.jpg, aligns each
via InsightFace 5-point warp, extracts 512-D embeddings with your ONNX ArcFace
model, and uploads them via POST /api/recognition/enroll.
"""

import argparse
import os
from pathlib import Path
from typing import List

import numpy as np
import onnxruntime as ort
import requests
from insightface.app import FaceAnalysis
from insightface.utils import face_align
import cv2


def l2_norm(v: np.ndarray) -> List[float]:
    return (v / max(float(np.linalg.norm(v)), 1e-8)).tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description="Enroll consented subjects into the ArcFace server.")
    parser.add_argument("--enroll-dir", type=Path, default=Path("data/enroll"))
    parser.add_argument("--onnx-model", type=Path, default=Path("../public/models/arcface_w600k_mbf.onnx"))
    parser.add_argument("--api-url", type=str, default="http://localhost:3000")
    parser.add_argument("--admin-key", type=str, default=os.getenv("ENROLLMENT_ADMIN_KEY", ""))
    parser.add_argument("--mode", choices=["append", "replace"], default="append")
    args = parser.parse_args()

    if not args.enroll_dir.exists():
        raise SystemExit(f"Enrollment directory not found: {args.enroll_dir}")

    app = FaceAnalysis(name="buffalo_sc", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    sess = ort.InferenceSession(str(args.onnx_model), providers=["CPUExecutionProvider"])
    in_name = sess.get_inputs()[0].name
    out_name = sess.get_outputs()[0].name

    headers = {"Authorization": f"Bearer {args.admin_key}"} if args.admin_key else {}

    for person_dir in sorted(p for p in args.enroll_dir.iterdir() if p.is_dir()):
        subject_id = person_dir.name
        embeddings = []
        for img_path in sorted(person_dir.iterdir()):
            if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            bgr = cv2.imread(str(img_path))
            if bgr is None:
                continue
            faces = app.get(bgr)
            if len(faces) != 1:
                continue
            aligned = face_align.norm_crop(bgr, landmark=faces[0].kps, image_size=112)
            rgb = cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB).astype(np.float32)
            tensor = np.transpose((rgb - 127.5) / 127.5, (2, 0, 1))[None, ...]
            vec = sess.run([out_name], {in_name: tensor})[0][0]
            embeddings.append(l2_norm(vec))

        if not embeddings:
            print(f"[SKIP] {subject_id}: no valid single-face photos found.")
            continue

        resp = requests.post(
            f"{args.api_url.rstrip('/')}/api/recognition/enroll",
            json={
                "subjectId": subject_id,
                "embeddings": embeddings,
                "consentConfirmed": True,
                "mode": args.mode,
            },
            headers=headers,
            timeout=15,
        )
        print(f"[{resp.status_code}] {subject_id}: {resp.text}")


if __name__ == "__main__":
    main()
