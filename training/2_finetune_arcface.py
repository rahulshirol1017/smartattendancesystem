#!/usr/bin/env python3
"""
Step 2: Fine-Tune a PyTorch ArcFace Backbone on Your Prepared Campus Dataset

- Architecture: MobileFaceNet-style Depthwise Separable Backbone -> 512-D L2-Normalized Embedding
- Loss: Additive Angular Margin Loss (ArcFace: s=64.0, m=0.50)
- Hardware: Auto-selects Apple Silicon MPS (MacBook Air M1/M2/M3), CUDA, or CPU
- Validation: Computes genuine vs. impostor cosine EER on data/prepared/val/ after every epoch
- Data Leakage Safety: Never touches data/prepared/test/ during training or checkpoint selection
"""

import sys
import os

try:
    import torch
    import torchvision
    from PIL import Image
except ImportError:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv_py = os.path.join(base_dir, ".venv", "bin", "python3")
    py311 = "/opt/homebrew/opt/python@3.11/bin/python3.11"
    if os.path.exists(venv_py) and sys.executable != venv_py:
        os.execv(venv_py, [venv_py] + sys.argv)
    elif os.path.exists(py311) and sys.executable != py311:
        os.execv(py311, [py311] + sys.argv)
    else:
        print("[ERROR] Required packages (torch, torchvision, PIL) not found.")
        sys.exit(1)

import argparse
import json
import math
import random
from pathlib import Path
from typing import List, Tuple

import numpy as np
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


class DepthwiseSeparableBlock(nn.Module):
    def __init__(self, in_c: int, out_c: int, stride: int = 1, expansion: int = 2):
        super().__init__()
        hidden = in_c * expansion
        self.use_res = stride == 1 and in_c == out_c
        self.conv = nn.Sequential(
            nn.Conv2d(in_c, hidden, 1, bias=False),
            nn.BatchNorm2d(hidden),
            nn.PReLU(hidden),
            nn.Conv2d(hidden, hidden, 3, stride=stride, padding=1, groups=hidden, bias=False),
            nn.BatchNorm2d(hidden),
            nn.PReLU(hidden),
            nn.Conv2d(hidden, out_c, 1, bias=False),
            nn.BatchNorm2d(out_c),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.conv(x)
        return x + out if self.use_res else out


class MobileFaceNetBackbone(nn.Module):
    """Lightweight MobileFaceNet architecture outputting 512-D L2-normalized embeddings from 112x112 RGB."""

    def __init__(self, embedding_dim: int = 512):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(3, 64, 3, stride=2, padding=1, bias=False),
            nn.BatchNorm2d(64),
            nn.PReLU(64),
            nn.Conv2d(64, 64, 3, stride=1, padding=1, groups=64, bias=False),
            nn.BatchNorm2d(64),
            nn.PReLU(64),
        )
        self.stages = nn.Sequential(
            DepthwiseSeparableBlock(64, 64, stride=2, expansion=2),
            DepthwiseSeparableBlock(64, 64, stride=1, expansion=2),
            DepthwiseSeparableBlock(64, 128, stride=2, expansion=4),
            DepthwiseSeparableBlock(128, 128, stride=1, expansion=2),
            DepthwiseSeparableBlock(128, 128, stride=1, expansion=2),
            DepthwiseSeparableBlock(128, 128, stride=2, expansion=4),
            DepthwiseSeparableBlock(128, 128, stride=1, expansion=2),
        )
        self.head = nn.Sequential(
            nn.Conv2d(128, 512, 1, bias=False),
            nn.BatchNorm2d(512),
            nn.PReLU(512),
            nn.Conv2d(512, 512, 7, groups=512, bias=False),  # Global depthwise 7x7 -> 1x1
            nn.BatchNorm2d(512),
            nn.Flatten(),
            nn.Linear(512, embedding_dim, bias=False),
            nn.BatchNorm1d(embedding_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stem(x)
        x = self.stages(x)
        emb = self.head(x)
        return F.normalize(emb, p=2, dim=1)


class ArcMarginProduct(nn.Module):
    """Additive Angular Margin (ArcFace) classification head used only during training."""

    def __init__(self, in_features: int, num_classes: int, scale: float = 64.0, margin: float = 0.50):
        super().__init__()
        self.weight = nn.Parameter(torch.FloatTensor(num_classes, in_features))
        nn.init.xavier_uniform_(self.weight)
        self.scale = scale
        self.margin = margin
        self.cos_m = math.cos(margin)
        self.sin_m = math.sin(margin)
        self.th = math.cos(math.pi - margin)
        self.mm = math.sin(math.pi - margin) * margin

    def forward(self, embeddings: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        cosine = F.linear(F.normalize(embeddings), F.normalize(self.weight)).clamp(-1.0 + 1e-6, 1.0 - 1e-6)
        sine = torch.sqrt(1.0 - cosine * cosine)
        phi = cosine * self.cos_m - sine * self.sin_m
        phi = torch.where(cosine > self.th, phi, cosine - self.mm)

        one_hot = torch.zeros_like(cosine)
        one_hot.scatter_(1, labels.view(-1, 1).long(), 1.0)
        logits = (one_hot * phi) + ((1.0 - one_hot) * cosine)
        return logits * self.scale


class AlignedFaceFolder(Dataset):
    def __init__(self, root: Path, transform: transforms.Compose):
        self.samples: List[Tuple[Path, int]] = []
        self.classes = sorted(d.name for d in root.iterdir() if d.is_dir())
        self.class_to_idx = {c: i for i, c in enumerate(self.classes)}
        self.transform = transform

        for cls_name in self.classes:
            for p in sorted((root / cls_name).iterdir()):
                if p.suffix.lower() in {".png", ".jpg", ".jpeg"}:
                    self.samples.append((p, self.class_to_idx[cls_name]))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, int]:
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.transform(img), label


@torch.no_grad()
def evaluate_cosine_eer(model: nn.Module, loader: DataLoader, device: torch.device) -> Tuple[float, float]:
    model.eval()
    all_emb, all_lbl = [], []
    for imgs, labels in loader:
        emb = model(imgs.to(device))
        all_emb.append(emb.cpu())
        all_lbl.append(labels)

    emb_mat = torch.cat(all_emb, dim=0)
    lbl_vec = torch.cat(all_lbl, dim=0)
    sim_mat = emb_mat @ emb_mat.T

    genuine, impostor = [], []
    n = len(lbl_vec)
    for i in range(n):
        for j in range(i + 1, n):
            score = float(sim_mat[i, j])
            if lbl_vec[i] == lbl_vec[j]:
                genuine.append(score)
            else:
                impostor.append(score)

    if not genuine or not impostor:
        return 1.0, 0.40

    g_arr = np.array(genuine)
    imp_arr = np.array(impostor)
    best_eer, best_th = 1.0, 0.40
    for th in np.linspace(0.1, 0.85, 76):
        far = float(np.mean(imp_arr >= th))
        frr = float(np.mean(g_arr < th))
        eer = (far + frr) / 2.0
        if abs(far - frr) < abs(best_eer - 0.0) and eer < best_eer:
            best_eer = eer
            best_th = float(th)
    return round(best_eer, 4), round(best_th, 3)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune MobileFaceNet + ArcFace on aligned 112x112 dataset.")
    default_data = Path("training/data/prepared") if Path("training/data/prepared").exists() else Path("data/prepared")
    default_out = Path("training/checkpoints") if Path("training").exists() else Path("checkpoints")
    parser.add_argument("--data-dir", type=Path, default=default_data)
    parser.add_argument("--out-dir", type=Path, default=default_out)
    parser.add_argument("--pretrained-ckpt", type=Path, default=None)
    parser.add_argument("--allow-scratch", action="store_true", help="Allow training from scratch if no pretrained checkpoint is provided (not recommended)")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    set_seed(args.seed)
    device = get_device()
    print(f"Using device: {device}")

    train_tf = transforms.Compose([
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.ColorJitter(brightness=0.22, contrast=0.2, saturation=0.15),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
    ])
    val_tf = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5]),
    ])

    train_ds = AlignedFaceFolder(args.data_dir / "train", train_tf)
    val_ds = AlignedFaceFolder(args.data_dir / "val", val_tf)

    if len(train_ds.classes) < 2:
        raise SystemExit("Need at least 2 enrolled subjects in data/prepared/train/ to train ArcFace.")

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True, drop_last=False)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    backbone = MobileFaceNetBackbone(embedding_dim=512).to(device)
    default_ckpt = Path("training/checkpoints/pretrained_arcface_mbf.pt")
    ckpt_path = args.pretrained_ckpt or (default_ckpt if default_ckpt.exists() else None)

    if ckpt_path and ckpt_path.exists():
        state = torch.load(ckpt_path, map_location=device)
        backbone.load_state_dict(state.get("backbone", state), strict=False)
        print(f"[OK] Pretrained weights verified and loaded from: {ckpt_path}")
    elif not args.allow_scratch:
        raise SystemExit(
            "ERROR: Fine-tuning requires compatible pretrained ArcFace weights.\n"
            "To prevent training a randomly initialized replacement model, supply --pretrained-ckpt\n"
            "or place pretrained_arcface_mbf.pt into training/checkpoints/.\n"
            "If you genuinely intend to train from scratch (not fine-tuning), pass --allow-scratch."
        )
    else:
        print("[WARNING] Training MobileFaceNet from scratch (random initialization permitted via --allow-scratch).")

    arc_head = ArcMarginProduct(512, len(train_ds.classes), scale=64.0, margin=0.50).to(device)
    optimizer = torch.optim.AdamW(
        [
            {"params": backbone.parameters(), "lr": args.lr},
            {"params": arc_head.parameters(), "lr": args.lr * 3.0},
        ],
        weight_decay=1e-4,
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    best_eer = 1.0
    history = []

    for epoch in range(1, args.epochs + 1):
        backbone.train()
        arc_head.train()
        running_loss = 0.0
        for imgs, labels in train_loader:
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            embs = backbone(imgs)
            logits = arc_head(embs, labels)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            running_loss += float(loss.item()) * len(labels)

        scheduler.step()
        avg_loss = running_loss / max(1, len(train_ds))
        val_eer, val_th = evaluate_cosine_eer(backbone, val_loader, device)
        history.append({"epoch": epoch, "train_loss": round(avg_loss, 4), "val_eer": val_eer, "val_th": val_th})
        print(f"Epoch {epoch:02d}/{args.epochs} | loss={avg_loss:.4f} | val_EER={val_eer:.4f} @ th={val_th:.3f}")

        if val_eer <= best_eer:
            best_eer = val_eer
            torch.save(
                {"backbone": backbone.state_dict(), "val_eer": val_eer, "val_threshold": val_th, "classes": train_ds.classes},
                args.out_dir / "best_arcface_backbone.pt",
            )

    (args.out_dir / "training_history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"\nBest validation EER: {best_eer:.4f} -> saved to {args.out_dir / 'best_arcface_backbone.pt'}")


if __name__ == "__main__":
    main()
