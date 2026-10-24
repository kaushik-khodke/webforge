"""Local checkpoint inference and a real, single-machine multi-silo FedAvg runner.

The old project's CT/MRI files contain only small adapter/head updates. Their
full foundation checkpoints are absent, so those modalities are never reported
as runnable here. No accuracy or privacy metric is synthesized.
"""

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import random
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CHECKPOINTS = {
    "cxr-pneumo-cnn": ROOT / "chexnet/models/trained/chexnet_update_hosp-001_1790766306.pth.tar",
    "ct-clip-3d": ROOT / "CT-CLIP/models/trained/ctclip_update_hosp-002_1790766307.pt",
    "cmr-ai-vst": ROOT / "CMR-AI/checkpoints/trained/cmrai_update_hosp-003_1790766371.pth",
    "cardiovascular_vqc": ROOT.parent / "qml/cardiovascular_vqc/best_model.pt",
    "diabetes_vqc": ROOT.parent / "qml/diabetes_vqc/best_model.pt",
    "pulmonary_vqc": ROOT.parent / "qml/pulmonary_vqc/best_model.pt",
}
CLASSES = ["Atelectasis", "Cardiomegaly", "Effusion", "Infiltration", "Mass", "Nodule",
           "Pneumonia", "Pneumothorax", "Consolidation", "Edema", "Emphysema",
           "Fibrosis", "Pleural_Thickening", "Hernia"]
FEDERATED_DIR = ROOT / "federated" / "artifacts"


def catalog():
    models = []
    for slug, name, task in [
        ("cxr-pneumo-cnn", "CheXNet", "14 chest X-ray findings"),
        ("ct-clip-3d", "CT-CLIP", "Chest CT findings"),
        ("cmr-ai-vst", "CMR-AI", "Cardiac MRI findings"),
        ("cardiovascular_vqc", "Cardiovascular VQC", "Cardiovascular classification"),
        ("diabetes_vqc", "Diabetes VQC", "Diabetes classification"),
        ("pulmonary_vqc", "Pulmonary VQC", "Pulmonary classification"),
    ]:
        path = CHECKPOINTS[slug]
        ready = slug == "cxr-pneumo-cnn" and path.is_file()
        quantum = slug.endswith("_vqc")
        models.append({"id": slug, "name": name, "task": task, "checkpoint_present": path.is_file(),
                       "available": ready, "input_modality": "tabular" if quantum else "image" if ready else "medical_volume",
                       "status": "local experimental" if ready else "runtime code needed" if quantum and path.is_file() else "foundation checkpoint missing",
                       "reason": None if ready else ("Local checkpoint is missing." if not path.is_file()
                           else "The matching QML runtime code is missing." if quantum
                           else "Only an update/head file is present; the full foundation checkpoint is required."),
                       "source": path.name})
    return models


def active_checkpoint():
    approved = FEDERATED_DIR / "active.json"
    if approved.is_file():
        metadata = json.loads(approved.read_text(encoding="utf-8"))
        path = FEDERATED_DIR / metadata["filename"]
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == metadata["sha256"]:
            return path, metadata
    return CHECKPOINTS["cxr-pneumo-cnn"], None


def load_xray(device):
    import torch
    from torchvision import models

    path, metadata = active_checkpoint()
    if not path.is_file():
        raise ValueError("The CheXNet checkpoint is missing on this machine.")
    net = models.densenet121(weights=None)
    net.classifier = torch.nn.Sequential(torch.nn.Linear(net.classifier.in_features, 14), torch.nn.Sigmoid())
    state = torch.load(path, map_location="cpu", weights_only=True)
    state = state.get("state_dict", state)
    state = {key.removeprefix("densenet121."): value for key, value in state.items()}
    net.load_state_dict(state, strict=True)
    return net.to(device), path, metadata


def preprocess(image_bytes):
    import numpy as np
    import torch
    from PIL import Image, UnidentifiedImageError
    try:
        image = Image.open(io.BytesIO(image_bytes))
        if image.format not in {"PNG", "JPEG", "WEBP"}:
            raise ValueError("Use a PNG, JPEG, or WebP image.")
        image = image.convert("RGB").resize((224, 224))
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("The supplied image could not be opened.") from error
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
    return torch.from_numpy(array.transpose(2, 0, 1).astype("float32"))


def predict(payload):
    import torch
    if payload.get("model_id") != "cxr-pneumo-cnn":
        raise ValueError("This local model is unavailable; its foundation checkpoint is missing.")
    image = payload.get("image") or {}
    if image.get("mimeType") not in {"image/png", "image/jpeg", "image/webp"}:
        raise ValueError("CheXNet requires a PNG, JPEG, or WebP chest radiograph.")
    try:
        raw = base64.b64decode(image.get("data", ""), validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("Invalid image data.") from error
    if not raw or len(raw) > 10 * 1024 * 1024:
        raise ValueError("The image must be between 1 byte and 10 MB.")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net, path, metadata = load_xray(device)
    net.eval()
    with torch.no_grad():
        values = net(preprocess(raw).unsqueeze(0).to(device))[0].cpu().tolist()
    return {"model": "CheXNet", "model_id": "cxr-pneumo-cnn", "checkpoint": path.name,
            "federated_round": metadata.get("round") if metadata else None,
            "findings": [{"name": name, "score": round(float(score), 6)} for name, score in zip(CLASSES, values)],
            "notice": "Experimental model scores are not a diagnosis and have not been clinically validated in this project."}


def read_site(site):
    """Each site keeps its own image directory and explicit binary labels.csv."""
    manifest = site / "labels.csv"
    if not manifest.is_file():
        return []
    rows = []
    with manifest.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not {"image", "pneumonia"}.issubset(reader.fieldnames or []):
            raise ValueError(f"{site.name}/labels.csv needs image,pneumonia columns.")
        for row in reader:
            relative = Path(row["image"])
            path = (site / relative).resolve()
            if path != site.resolve() and site.resolve() not in path.parents:
                raise ValueError("Image paths must stay within their site directory.")
            if not path.is_file():
                raise ValueError(f"Missing image at site {site.name}: {relative.name}")
            label = str(row["pneumonia"]).strip()
            if label not in {"0", "1"}:
                raise ValueError("Pneumonia labels must be 0 or 1.")
            rows.append((path, int(label)))
    return rows


def sites_at(data_root):
    if not data_root.is_dir():
        return []
    return [{"id": path.name, "count": len(read_site(path))} for path in sorted(data_root.iterdir())
            if path.is_dir() and (path / "labels.csv").is_file()]


def train(payload):
    import copy
    import time
    import torch

    root = Path(payload["data_root"]).resolve()
    rounds = int(payload.get("rounds", 1))
    epochs = int(payload.get("epochs", 1))
    if not 1 <= rounds <= 10 or not 1 <= epochs <= 5:
        raise ValueError("Choose 1–10 rounds and 1–5 local epochs.")
    sites = [(root / item["id"], read_site(root / item["id"])) for item in sites_at(root)]
    sites = [(path, rows) for path, rows in sites if len(rows) >= 4]
    if len(sites) < 2:
        raise ValueError("At least two local sites with four explicitly labeled images each are required.")
    splits = []
    for site, rows in sites:
        rows = list(rows)
        random.Random(int(hashlib.sha256(site.name.encode()).hexdigest()[:8], 16)).shuffle(rows)
        held_out = max(1, len(rows) // 5)
        splits.append((site, rows[held_out:], rows[:held_out]))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net, source, _ = load_xray(device)
    for parameter in net.features.parameters():
        parameter.requires_grad_(False)
    history = []
    for round_number in range(1, rounds + 1):
        global_head = copy.deepcopy(net.classifier.state_dict())
        updates = []
        for site, rows, _ in splits:
            local = copy.deepcopy(net)
            local.classifier.load_state_dict(global_head)
            optimizer = torch.optim.AdamW(local.classifier.parameters(), lr=1e-4)
            local.train()
            losses = []
            for _ in range(epochs):
                for image_path, label in rows:
                    x = preprocess(image_path.read_bytes()).unsqueeze(0).to(device)
                    y = torch.tensor([float(label)], device=device)
                    optimizer.zero_grad()
                    output = local(x)[:, 6]
                    loss = torch.nn.functional.binary_cross_entropy(output, y)
                    loss.backward()
                    optimizer.step()
                    losses.append(float(loss.detach().cpu()))
            updates.append((len(rows), copy.deepcopy(local.classifier.state_dict())))
            print(json.dumps({"event": "site_complete", "round": round_number, "site": site.name,
                              "samples": len(rows), "loss": round(sum(losses) / len(losses), 6)}), flush=True)
            del local
        total = sum(count for count, _ in updates)
        average = {key: sum(state[key].float() * (count / total) for count, state in updates)
                   for key in global_head}
        net.classifier.load_state_dict(average, strict=True)
        net.eval()
        correct = 0
        evaluated = 0
        with torch.no_grad():
            for _, _, validation_rows in splits:
                for image_path, label in validation_rows:
                    score = float(net(preprocess(image_path.read_bytes()).unsqueeze(0).to(device))[0, 6].cpu())
                    correct += int((score >= 0.5) == bool(label))
                    evaluated += 1
        validation_accuracy = correct / evaluated
        # Training loss is reported per site above; no fabricated validation metric.
        history.append({"round": round_number, "sites": len(updates), "training_samples": total,
                        "held_out_samples": evaluated, "held_out_accuracy": round(validation_accuracy, 6)})
        print(json.dumps({"event": "round_complete", **history[-1]}), flush=True)

    FEDERATED_DIR.mkdir(parents=True, exist_ok=True)
    output = FEDERATED_DIR / f"chexnet-fedavg-{int(time.time())}.pth.tar"
    torch.save({"state_dict": {f"densenet121.{key}": value.cpu() for key, value in net.state_dict().items()},
                "rounds": rounds, "sites": [path.name for path, _, _ in splits], "source": source.name}, output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    metadata = {"filename": output.name, "sha256": digest, "round": rounds, "sites": len(splits),
                "training_samples": sum(len(rows) for _, rows, _ in splits), "history": history,
                "evaluation": "local held-out split; no clinical validation", "source": source.name}
    temporary = FEDERATED_DIR / "latest.tmp"
    temporary.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    os.replace(temporary, FEDERATED_DIR / "latest.json")
    print(json.dumps({"event": "completed", "result": metadata}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["catalog", "predict", "sites", "train"])
    args = parser.parse_args()
    try:
        if args.command == "catalog":
            print(json.dumps({"models": catalog()}))
        elif args.command == "predict":
            print(json.dumps(predict(json.load(sys.stdin))))
        elif args.command == "sites":
            print(json.dumps({"sites": sites_at(Path(os.environ.get("FL_DATA_ROOT", str(ROOT / "federated/sites"))))}))
        else:
            train(json.load(sys.stdin))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
