#!/usr/bin/env python3
"""
CT-CLIP 3D Chest CT Disease Prediction Script
==============================================
Run zero-shot pathology prediction on a single 3D CT scan (.nii, .nii.gz, .npz, .npy)
using the pretrained CT-CLIP foundation model.

Usage Examples:
    python main.py --image path/to/scan.nii.gz
    python main.py -i path/to/scan.nii.gz --model models/CT-CLIP_v2.pt --top-k 5
    python main.py -i path/to/scan.nii.gz --save-csv results.csv --save-json results.json
"""

import os
import sys
import argparse
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure local modules are discoverable
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR / "transformer_maskgit"))
sys.path.insert(0, str(SCRIPT_DIR / "CT_CLIP"))

from transformer_maskgit import CTViT
from transformers import BertTokenizer, BertModel
from ct_clip import CTCLIP

# The 18 standard clinical pathologies from the CT-RATE / CT-CLIP benchmark
DEFAULT_PATHOLOGIES = [
    "Medical material",
    "Arterial wall calcification",
    "Cardiomegaly",
    "Pericardial effusion",
    "Coronary artery wall calcification",
    "Hiatal hernia",
    "Lymphadenopathy",
    "Emphysema",
    "Atelectasis",
    "Lung nodule",
    "Lung opacity",
    "Pulmonary fibrotic sequela",
    "Pleural effusion",
    "Mosaic attenuation pattern",
    "Peribronchial thickening",
    "Consolidation",
    "Bronchiectasis",
    "Interlobular septal thickening",
]


def parse_args():
    parser = argparse.ArgumentParser(
        description="CT-CLIP: Predict chest pathologies from a 3D CT Scan (.nii, .nii.gz, .npz)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-i", "--image",
        type=str,
        required=True,
        help="Path to the 3D CT scan file (.nii, .nii.gz, .npz, .npy)",
    )
    parser.add_argument(
        "-m", "--model",
        type=str,
        default=str(SCRIPT_DIR / "models" / "CT-CLIP_v2.pt"),
        help="Path to the pretrained CT-CLIP weights (.pt file)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["auto", "cuda", "cpu"],
        help="Computation device ('cuda', 'cpu', or 'auto')",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.5,
        help="Probability threshold to classify a finding as positive",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=0,
        help="Display only top K findings with highest probability (0 for all)",
    )
    parser.add_argument(
        "--custom-pathologies",
        type=str,
        nargs="+",
        default=None,
        help="Optional custom list of pathologies/prompts to evaluate instead of the standard 18",
    )
    parser.add_argument(
        "--save-csv",
        type=str,
        default=None,
        help="Optional path to save prediction results as a CSV file",
    )
    parser.add_argument(
        "--save-json",
        type=str,
        default=None,
        help="Optional path to save prediction results as a JSON file",
    )
    parser.add_argument(
        "--z-spacing",
        type=float,
        default=None,
        help="Override Z voxel spacing in mm (default: auto-detected from NIfTI header or 1.5)",
    )
    parser.add_argument(
        "--xy-spacing",
        type=float,
        default=None,
        help="Override XY voxel spacing in mm (default: auto-detected from NIfTI header or 0.75)",
    )
    return parser.parse_args()


def load_ct_model(model_path: str, device: torch.device):
    """Build CTCLIP architecture and load weights."""
    print(f"[*] Initializing tokenizer and text encoder (microsoft/BiomedVLP-CXR-BERT-specialized)...")
    tokenizer = BertTokenizer.from_pretrained(
        "microsoft/BiomedVLP-CXR-BERT-specialized",
        do_lower_case=True
    )
    text_encoder = BertModel.from_pretrained("microsoft/BiomedVLP-CXR-BERT-specialized")
    text_encoder.resize_token_embeddings(len(tokenizer))

    print(f"[*] Initializing 3D Vision Transformer (CTViT)...")
    image_encoder = CTViT(
        dim=512,
        codebook_size=8192,
        image_size=480,
        patch_size=20,
        temporal_patch_size=10,
        spatial_depth=4,
        temporal_depth=4,
        dim_head=32,
        heads=8,
    )

    print(f"[*] Assembling CT-CLIP model...")
    clip = CTCLIP(
        image_encoder=image_encoder,
        text_encoder=text_encoder,
        dim_image=294912,
        dim_text=768,
        dim_latent=512,
        extra_latent_projection=False,
        use_mlm=False,
        downsample_image_embeds=False,
        use_all_token_embeds=False,
    )

    print(f"[*] Loading pretrained weights from: {model_path} ...")
    clip.load(model_path, map_location=device.type)
    clip.to(device)
    clip.eval()
    print(f"[+] Model loaded successfully on {device}!\n")
    return clip, tokenizer


def resize_3d_volume(array_tensor: torch.Tensor, current_spacing, target_spacing):
    """
    Resize 3D volume to match target voxel spacing using trilinear interpolation.
    array_tensor shape: (1, 1, D, H, W)
    """
    orig_shape = array_tensor.shape[2:]
    scaling_factors = [
        current_spacing[i] / target_spacing[i] for i in range(len(orig_shape))
    ]
    new_shape = [
        max(1, int(orig_shape[i] * scaling_factors[i])) for i in range(len(orig_shape))
    ]
    resized = F.interpolate(
        array_tensor, size=new_shape, mode="trilinear", align_corners=False
    )
    return resized


def preprocess_ct_image(
    image_path: str,
    device: torch.device,
    z_spacing_override=None,
    xy_spacing_override=None,
) -> torch.Tensor:
    """
    Load and preprocess a 3D CT scan:
    1. Read voxel data and physical spacing
    2. Convert to HU (if slope/intercept present)
    3. Window/clip intensities to [-1000, 1000] HU
    4. Resample to standard target spacing (1.5mm Z, 0.75mm XY)
    5. Normalize by / 1000.0
    6. Crop / Pad to target shape (D=240, H=480, W=480)
    Returns: Tensor of shape (1, 1, 240, 480, 480) on target device.
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"CT scan file not found at: {image_path}")

    print(f"[*] Loading CT scan from: {image_path.name}")

    slope = 1.0
    intercept = 0.0
    z_spacing = 1.5
    xy_spacing = 0.75

    # 1. Load data based on file extension
    if image_path.name.endswith(".nii") or image_path.name.endswith(".nii.gz"):
        import nibabel as nib
        nii = nib.load(str(image_path))
        img_data = nii.get_fdata(dtype=np.float32)

        # Header metadata
        hdr = nii.header
        zooms = hdr.get_zooms()
        if len(zooms) >= 3:
            xy_spacing = float(zooms[0]) if zooms[0] > 0 else 0.75
            z_spacing = float(zooms[2]) if zooms[2] > 0 else 1.5

        # Check slope / intercept if present in header
        s_i = hdr.get_slope_inter()
        if s_i[0] is not None and not np.isnan(s_i[0]) and s_i[0] != 0:
            slope = float(s_i[0])
        if s_i[1] is not None and not np.isnan(s_i[1]):
            intercept = float(s_i[1])

    elif image_path.name.endswith(".npz"):
        npz_file = np.load(str(image_path))
        key = list(npz_file.keys())[0]
        img_data = npz_file[key].astype(np.float32)
    elif image_path.name.endswith(".npy"):
        img_data = np.load(str(image_path)).astype(np.float32)
    else:
        raise ValueError(
            f"Unsupported file format: {image_path.suffix}. Supported: .nii, .nii.gz, .npz, .npy"
        )

    if z_spacing_override is not None:
        z_spacing = float(z_spacing_override)
    if xy_spacing_override is not None:
        xy_spacing = float(xy_spacing_override)

    print(f"    - Input raw shape: {img_data.shape}")
    print(f"    - Voxel spacing: XY={xy_spacing:.3f} mm, Z={z_spacing:.3f} mm")

    # 2. Rescale to HU & Window Clip [-1000, 1000]
    img_data = slope * img_data + intercept
    img_data = np.clip(img_data, -1000.0, 1000.0)

    # 3. Transpose nibabel (X, Y, Z) / (H, W, D) -> (D, H, W)
    if img_data.ndim == 3:
        # Standard nibabel format is (X, Y, Z)
        img_data = img_data.transpose(2, 0, 1)

    # 4. Resample to standard spacing: target (Z=1.5, X=0.75, Y=0.75)
    tensor_5d = torch.tensor(img_data, dtype=torch.float32).unsqueeze(0).unsqueeze(0)
    current_spacing = (z_spacing, xy_spacing, xy_spacing)
    target_spacing = (1.5, 0.75, 0.75)

    resized_5d = resize_3d_volume(tensor_5d, current_spacing, target_spacing)
    img_data = resized_5d[0, 0].numpy()  # (D, H, W)

    # 5. Transpose back to (H, W, D) for standard center crop/pad
    img_data = np.transpose(img_data, (1, 2, 0))  # (H, W, D)

    # 6. Normalize
    img_data = (img_data / 1000.0).astype(np.float32)
    tensor = torch.tensor(img_data, dtype=torch.float32)

    # 7. Crop or pad to target shape (480, 480, 240) -> (H, W, D)
    target_shape = (480, 480, 240)
    dh, dw, dd = target_shape
    h, w, d = tensor.shape

    h_start = max((h - dh) // 2, 0)
    h_end = min(h_start + dh, h)
    w_start = max((w - dw) // 2, 0)
    w_end = min(w_start + dw, w)
    d_start = max((d - dd) // 2, 0)
    d_end = min(d_start + dd, d)

    tensor = tensor[h_start:h_end, w_start:w_end, d_start:d_end]

    pad_h_before = (dh - tensor.size(0)) // 2
    pad_h_after = dh - tensor.size(0) - pad_h_before

    pad_w_before = (dw - tensor.size(1)) // 2
    pad_w_after = dw - tensor.size(1) - pad_w_before

    pad_d_before = (dd - tensor.size(2)) // 2
    pad_d_after = dd - tensor.size(2) - pad_d_before

    tensor = F.pad(
        tensor,
        (pad_d_before, pad_d_after, pad_w_before, pad_w_after, pad_h_before, pad_h_after),
        value=-1.0,
    )

    # 8. Permute back from (H, W, D) to (D, H, W) -> (240, 480, 480)
    tensor = tensor.permute(2, 0, 1)

    # 9. Add batch & channel dims: (1, 1, 240, 480, 480)
    tensor = tensor.unsqueeze(0).unsqueeze(0).to(device)
    print(f"    - Preprocessed tensor shape: {tuple(tensor.shape)} (Ready for CTViT)\n")
    return tensor


@torch.no_grad()
def predict_pathologies(
    model: CTCLIP,
    tokenizer: BertTokenizer,
    image_tensor: torch.Tensor,
    pathologies: list,
    device: torch.device,
) -> list:
    """
    Run fast zero-shot inference:
    1. Extract 3D CT visual embedding ONCE
    2. Extract text embeddings for each (positive, negative) pathology prompt pair
    3. Compute cosine similarity + temperature-scaled softmax
    """
    print("[*] Extracting 3D CT volume visual features...")
    start_time = time.time()

    # Encode 3D Image
    enc_image = model.visual_transformer(image_tensor, return_encoded_tokens=True)
    enc_image = torch.mean(enc_image, dim=1)
    enc_image = enc_image.view(enc_image.shape[0], -1)
    image_latents = model.to_visual_latent(enc_image)
    image_latents = F.normalize(image_latents, dim=-1)  # (1, 512)

    temp = model.temperature.exp()
    img_time = time.time() - start_time
    print(f"[+] 3D visual feature extraction completed in {img_time:.2f}s\n")

    print(f"[*] Evaluating {len(pathologies)} clinical conditions...")
    results = []

    for idx, pathology in enumerate(pathologies, 1):
        # Build positive and negative prompts
        pos_prompt = f"{pathology} is present."
        neg_prompt = f"{pathology} is not present."
        prompts = [pos_prompt, neg_prompt]

        text_tokens = tokenizer(
            prompts,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=512,
        ).to(device)

        text_embeddings = model.text_transformer(
            text_tokens.input_ids,
            attention_mask=text_tokens.attention_mask
        )[0]
        text_embeds = text_embeddings[:, 0, :]  # CLS token
        text_latents = model.to_text_latent(text_embeds)
        text_latents = F.normalize(text_latents, dim=-1)  # (2, 512)

        # Compute cosine similarities with temperature scaling
        # text_latents[0] = Positive, text_latents[1] = Negative
        logits = torch.einsum("d, bd -> b", image_latents[0], text_latents) * temp
        probs = F.softmax(logits, dim=0).cpu().numpy()

        pos_prob = float(probs[0])
        neg_prob = float(probs[1])

        results.append({
            "index": idx,
            "pathology": pathology,
            "probability": pos_prob,
            "probability_percent": pos_prob * 100.0,
            "negative_prob": neg_prob,
        })

    return results


def make_bar(prob: float, width: int = 15) -> str:
    """Create a visual text progress bar for probabilities."""
    filled = int(round(prob * width))
    bar = "[" + "#" * filled + " " * (width - filled) + "]"
    return bar


def print_results_table(results: list, threshold: float = 0.5, top_k: int = 0):
    """Format and print a rich results table."""
    # Sort results by probability descending
    sorted_results = sorted(results, key=lambda x: x["probability"], reverse=True)

    if top_k > 0:
        display_results = sorted_results[:top_k]
        header_title = f"TOP {top_k} FINDINGS (Sorted by Confidence)"
    else:
        display_results = sorted_results
        header_title = "PREDICTION RESULTS (Sorted by Probability)"

    print("=" * 80)
    print(f" {header_title.center(78)}")
    print("=" * 80)
    print(f"{'#':<4} {'Pathology / Abnormality':<36} {'Prob %':<9} {'Confidence Bar':<18} {'Status':<12}")
    print("-" * 80)

    for i, item in enumerate(display_results, 1):
        prob = item["probability"]
        prob_pct = item["probability_percent"]
        bar = make_bar(prob, width=15)
        
        if prob >= threshold:
            status = " [DETECTED]"
        else:
            status = "  Absent"

        print(f"{i:<4} {item['pathology']:<36} {prob_pct:>6.2f}%  {bar} {status:<12}")

    print("=" * 80)
    detected_count = sum(1 for r in results if r["probability"] >= threshold)
    print(f"[*] Summary: {detected_count} / {len(results)} pathologies detected with probability >= {threshold:.2f}\n")


def save_outputs(results: list, csv_path: str = None, json_path: str = None):
    """Save results to CSV or JSON if requested."""
    if csv_path:
        import pandas as pd
        df = pd.DataFrame(results)
        df.to_csv(csv_path, index=False)
        print(f"[+] Saved predictions CSV to: {csv_path}")

    if json_path:
        import json
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"[+] Saved predictions JSON to: {json_path}")


def main():
    args = parse_args()

    # Determine device
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    print("\n" + "=" * 80)
    print("           CT-CLIP 3D CHEST CT ZERO-SHOT PATHOLOGY PREDICTOR            ")
    print("=" * 80)
    print(f"[*] Active Device: {device}")
    print(f"[*] Model Weights: {args.model}")
    print(f"[*] Input Scan:    {args.image}")
    print(f"[*] Threshold:     {args.threshold}")
    print("=" * 80 + "\n")

    # 1. Load Model
    model, tokenizer = load_ct_model(args.model, device)

    # 2. Preprocess CT Scan
    image_tensor = preprocess_ct_image(
        args.image,
        device=device,
        z_spacing_override=args.z_spacing,
        xy_spacing_override=args.xy_spacing,
    )

    # 3. Choose Pathologies
    pathologies = args.custom_pathologies if args.custom_pathologies else DEFAULT_PATHOLOGIES

    # 4. Predict
    t_start = time.time()
    results = predict_pathologies(
        model=model,
        tokenizer=tokenizer,
        image_tensor=image_tensor,
        pathologies=pathologies,
        device=device,
    )
    total_time = time.time() - t_start

    # 5. Display Table
    print_results_table(results, threshold=args.threshold, top_k=args.top_k)
    print(f"[+] Total inference time: {total_time:.2f} seconds\n")

    # 6. Save if requested
    save_outputs(results, csv_path=args.save_csv, json_path=args.save_json)


if __name__ == "__main__":
    main()
