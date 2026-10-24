import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "ml", "local_models.py");
const dataRoot = path.resolve(process.env.FL_DATA_ROOT || path.join(here, "ml", "federated", "sites"));
const artifactDir = path.join(here, "ml", "federated", "artifacts");
const specs = [
  { id: "cxr-pneumo-cnn", name: "CheXNet", task: "14 chest X-ray findings", file: "chexnet/models/trained/chexnet_update_hosp-001_1790766306.pth.tar", description: "Experimental chest X-ray classifier. Scores are not a diagnosis or a clinically validated risk estimate." },
  { id: "ct-clip-3d", name: "CT-CLIP", task: "Chest CT findings", file: "CT-CLIP/models/trained/ctclip_update_hosp-002_1790766307.pt", description: "A CT adapter update is present, but the complete foundation weights are missing." },
  { id: "cmr-ai-vst", name: "CMR-AI", task: "Cardiac MRI findings", file: "CMR-AI/checkpoints/trained/cmrai_update_hosp-003_1790766371.pth", description: "An MRI head update is present, but the complete foundation weights are missing." },
  { id: "cardiovascular_vqc", name: "Cardiovascular VQC", task: "Cardiovascular classification", file: "../qml/cardiovascular_vqc/best_model.pt", description: "The QML checkpoint is present. Its matching TorchLayer circuit implementation is needed before inference.", features: ["age", "trestbps", "chol", "thalach", "oldpeak", "cp"] },
  { id: "diabetes_vqc", name: "Diabetes VQC", task: "Diabetes classification", file: "../qml/diabetes_vqc/best_model.pt", description: "The QML checkpoint is present. Its matching TorchLayer circuit implementation is needed before inference.", features: ["glucose", "blood_pressure", "bmi", "age", "insulin", "diabetes_pedigree"] },
  { id: "pulmonary_vqc", name: "Pulmonary VQC", task: "Pulmonary classification", file: "../qml/pulmonary_vqc/best_model.pt", description: "The QML checkpoint is present. Its matching TorchLayer circuit implementation is needed before inference.", features: ["spo2", "respiratory_rate", "heart_rate", "temperature_f", "systolic_bp", "age"] },
];

export function localCatalog() {
  return specs.map(spec => {
    const checkpointPresent = existsSync(path.join(here, "ml", spec.file));
    const available = spec.id === "cxr-pneumo-cnn" && checkpointPresent;
    const quantum = Boolean(spec.features);
    return { id: spec.id, name: spec.name, task: spec.task, description: spec.description,
      checkpoint_present: checkpointPresent, available, local: true,
      status: available ? "local experimental" : quantum && checkpointPresent ? "runtime code needed" : "foundation checkpoint missing",
      reason: available ? null : !checkpointPresent ? "Local checkpoint is missing." : quantum
        ? "The matching QML circuit and preprocessing implementation was not included with this checkpoint."
        : "Only a partial update is present; full foundation weights are required.",
      input_modality: quantum ? "tabular" : "image", model_type: quantum ? "qml" : "image_classification",
      required_attributes: spec.features || [] };
  });
}

export function localSites() {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => {
    const manifest = path.join(dataRoot, item.name, "labels.csv");
    return { id: item.name, manifest_present: existsSync(manifest) };
  }).filter(item => item.manifest_present);
}

export function activeFederated() {
  const file = path.join(artifactDir, "active.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function activateFederated(metadata) {
  if (!/^chexnet-fedavg-\d+\.pth\.tar$/.test(metadata?.filename || "") ||
      !/^[a-f0-9]{64}$/i.test(metadata?.sha256 || "")) throw new Error("This run has no valid checkpoint artifact.");
  const file = path.join(artifactDir, metadata.filename);
  if (!existsSync(file)) throw new Error("The checkpoint file is missing on this server.");
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (digest !== metadata.sha256) throw new Error("Checkpoint hash verification failed.");
  const temp = path.join(artifactDir, "active.tmp");
  writeFileSync(temp, JSON.stringify(metadata, null, 2));
  renameSync(temp, path.join(artifactDir, "active.json"));
  return metadata;
}

export function runPython(command, payload, { timeout = 120_000, onEvent } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || "python", [script, command], {
      cwd: here, env: { ...process.env, FL_DATA_ROOT: dataRoot }, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    let lastEvent = null;
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 200_000) { child.kill(); return; }
      const lines = output.split("\n");
      output = lines.pop();
      for (const line of lines) {
        try { lastEvent = JSON.parse(line); onEvent?.(lastEvent); }
        catch { /* Ignore progress text from native libraries. */ }
      }
    });
    child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-5000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        let message;
        try { message = JSON.parse(errors.trim().split("\n").at(-1)).error; } catch { /* error below */ }
        reject(new Error(message || `Local model process failed (${code}).`));
      } else resolve(lastEvent);
    });
    child.stdin.end(JSON.stringify(payload || {}));
  });
}

export async function inferLocal(modelId, image) {
  const model = localCatalog().find(item => item.id === modelId);
  if (!model?.available) return { available: false, reason: model?.reason || "Unknown local model." };
  if (!image) return { available: false, reason: "A chest radiograph image is required." };
  try {
    const result = await runPython("predict", { model_id: modelId, image });
    return { available: true, model: model.name, version: result.checkpoint, result };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

export function startFederatedRun(db, runId, rounds, epochs) {
  runPython("train", { data_root: dataRoot, rounds, epochs }, {
    timeout: 2 * 60 * 60 * 1000,
    onEvent: event => {
      if (event.event === "round_complete")
        db.from("training_runs").update({ metrics: { last_round: event.round, sites: event.sites,
          training_samples: event.training_samples, held_out_samples: event.held_out_samples,
          held_out_accuracy: event.held_out_accuracy } }).eq("id", runId)
          .then(({ error }) => { if (error) console.error("Training progress save failed:", error.message); });
    },
  }).then(event => db.from("training_runs").update({ status: "completed", metrics: event.result,
    finished_at: new Date().toISOString() }).eq("id", runId))
    .catch(error => db.from("training_runs").update({ status: "failed", error_summary: String(error.message).slice(0, 500),
      finished_at: new Date().toISOString() }).eq("id", runId))
    .catch(error => console.error("Training status save failed:", error.message));
}
