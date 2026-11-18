#!/usr/bin/env python3
"""Nexus Isles — Nexus backend sidecar.

Loads ONE Nexus checkpoint (the owner's own LLM) once, then serves
line-delimited JSON generation requests over stdin/stdout:

    ->  {"id": 1, "prompt": "<plain-text prompt>"}
    <-  {"id": 1, "text": "<raw model output>"}
    <-  {"id": 1, "error": "generation_failed" | "prompt_too_long" | "bad_request"}

The prompt text is framed exactly the way the trainer frames inference
(common.frame, mode "create") and decoded greedily with the model's own
greedy() until <|/call|> or <|end|> — the same path predict.py uses. This
process is a transport: it never parses, repairs, or judges the output.
Errors never echo the prompt back.

Usage:
    nexus_sidecar.py --ckpt <model.pt> --train-dir <nexus-llm/train>
                     [--max-new 96]

The first stdout line is a readiness record:
    {"ready": true, "checkpointSha256": "<hex>", "params": <int>}
"""
import argparse
import hashlib
import json
import sys

ap = argparse.ArgumentParser()
ap.add_argument("--ckpt", required=True)
ap.add_argument("--train-dir", required=True)
ap.add_argument("--max-new", type=int, default=96)
a = ap.parse_args()

sys.path.insert(0, a.train_dir)

import torch  # noqa: E402

from common import BOS, CALL_CLOSE, END, SP, frame  # noqa: E402
from model import Config, NexusLM  # noqa: E402


def main() -> None:
    torch.manual_seed(0)
    with open(a.ckpt, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    ck = torch.load(a.ckpt, map_location="cpu")
    model = NexusLM(Config(**ck["cfg"]))
    model.load_state_dict(ck["state"])
    model.eval()
    ctx_limit = model.c.ctx

    print(json.dumps({"ready": True, "checkpointSha256": digest,
                      "params": model.n_params()}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            prompt = req["prompt"]
            if not isinstance(prompt, str) or not prompt:
                raise ValueError("prompt must be a non-empty string")
            ids = [BOS] + SP.encode(frame(prompt, "create"))
            if len(ids) + 8 > ctx_limit:
                print(json.dumps({"id": req_id, "error": "prompt_too_long"}), flush=True)
                continue
            gen = model.greedy(ids, {CALL_CLOSE, END},
                               max_new=min(a.max_new, ctx_limit - len(ids)))
            print(json.dumps({"id": req_id, "text": SP.decode(gen)}), flush=True)
        except Exception:
            # Never echo the prompt or model internals into the error.
            print(json.dumps({"id": req_id, "error": "generation_failed"}), flush=True)


if __name__ == "__main__":
    main()
