#!/usr/bin/env python3
"""gemma4 MLX ベンチマーク（bench_gemma4.py の Ollama 版と対になる MLX 版）。

計測（Ollama 版と同一プロンプト・temp0.3・max_tokens1024・seed42）:
  - prompt 処理速度 prompt_tps  (Ollama prompt_eval ~ TTFT に対応)
  - 生成速度 generation_tps     (Ollama eval_count/eval_duration に対応)
  - ピークメモリ / 総レイテンシ

モデル別ローダ:
  - e4b   : フルマルチモーダル(vision+audio)のため mlx-vlm。
            audio/vision 余剰weightは load_weights(strict=False) で破棄しテキスト経路のみ使用。
  - 26b-a4b: テキスト専用なので mlx-lm。

usage: python3 tests/model_bench/bench_gemma4_mlx.py
"""
import json
import time

import mlx.core as mx
import mlx.nn as nn

MAX_TOKENS = 1024
TEMP = 0.3

PROMPTS = [
    {"id": "conv_empathy", "label": "会話/共感",
     "prompt": "今日は疲れたよ。明日も朝から会議が3つある。\n親しい秘書として2文以内で短く返して。"},
    {"id": "reasoning", "label": "推論",
     "prompt": "次の問いに答えて、理由も一行で。\n太郎は花子より背が高い。花子は次郎より背が高い。一番背が高いのは誰？"},
    {"id": "summarize", "label": "要約",
     "prompt": "次を30字以内の日本語で要約して:\n『四半期の売上は前年同期比12%増となったが、円安による原材料高で営業利益率は2ポイント低下した。来期は価格改定で利益率の回復を見込む。』"},
    {"id": "instruction", "label": "指示追従",
     "prompt": "次の3つの予定を、開始時刻の早い順に『HH:MM タイトル』の形式で箇条書きにして。それ以外は出力しない。\n- 15:00 顧客MTG\n- 09:30 朝会\n- 13:00 ランチ面談"},
    {"id": "knowledge", "label": "知識",
     "prompt": "ストルバイト結石の猫の食事で気をつける点を3つ、簡潔に箇条書きで。"},
]


# ---- e4b: mlx-vlm（strict=False で余剰weightを破棄） ----
def bench_vlm(repo):
    from mlx_vlm.utils import load_model, load_processor, get_model_path
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template

    _orig = nn.Module.load_weights
    nn.Module.load_weights = lambda self, w, strict=True: _orig(self, w, strict=False)
    try:
        mp = get_model_path(repo)
        model = load_model(mp, lazy=False)
        proc = load_processor(mp)
    finally:
        nn.Module.load_weights = _orig

    def gen(prompt):
        f = apply_chat_template(proc, model.config, prompt, num_images=0)
        mx.reset_peak_memory()
        t0 = time.time()
        res = generate(model, proc, f, max_tokens=MAX_TOKENS, temperature=TEMP, verbose=False)
        wall = time.time() - t0
        txt = res if isinstance(res, str) else getattr(res, "text", str(res))
        return {
            "wall": wall,
            "prompt_tps": float(getattr(res, "prompt_tps", 0.0) or 0.0),
            "gen_tps": float(getattr(res, "generation_tps", 0.0) or 0.0),
            "out_tokens": int(getattr(res, "generation_tokens", 0) or 0),
            "peak_mem_gb": mx.get_peak_memory() / 1e9,
            "response": (txt or "").strip(),
        }

    gen("こんにちは")  # warmup
    return gen


# ---- 26b: mlx-lm ----
def bench_lm(repo):
    from mlx_lm import load, stream_generate
    from mlx_lm.sample_utils import make_sampler

    model, tok = load(repo)
    sampler = make_sampler(temp=TEMP)

    def gen(prompt):
        text = tok.apply_chat_template([{"role": "user", "content": prompt}], add_generation_prompt=True)
        mx.reset_peak_memory()
        t0 = time.time()
        last, out = None, []
        for r in stream_generate(model, tok, text, max_tokens=MAX_TOKENS, sampler=sampler):
            out.append(r.text)
            last = r
        wall = time.time() - t0
        return {
            "wall": wall,
            "prompt_tps": float(getattr(last, "prompt_tps", 0.0)),
            "gen_tps": float(getattr(last, "generation_tps", 0.0)),
            "out_tokens": int(getattr(last, "generation_tokens", 0)),
            "peak_mem_gb": mx.get_peak_memory() / 1e9,
            "response": "".join(out).strip(),
        }

    gen("こんにちは")  # warmup
    return gen


MODELS = [
    ("gemma-4-e4b-4bit", "mlx-community/gemma-4-e4b-it-4bit", bench_vlm),
    ("gemma-4-26b-a4b-4bit(OptiQ)", "mlx-community/gemma-4-26B-A4B-it-OptiQ-4bit", bench_lm),
]


def main():
    results = {}
    for label, repo, runner in MODELS:
        print(f"\n{'='*60}\nMODEL: {label}  ({repo})\n{'='*60}", flush=True)
        mx.random.seed(42)
        try:
            gen = runner(repo)
        except Exception as e:
            print(f"  [skip] load failed: {type(e).__name__}: {str(e)[:120]}", flush=True)
            results[label] = None
            continue
        results[label] = {}
        for p in PROMPTS:
            mx.random.seed(42)
            try:
                r = gen(p["prompt"])
            except Exception as e:
                print(f"  [{p['id']}] ERROR: {type(e).__name__}: {str(e)[:120]}", flush=True)
                continue
            results[label][p["id"]] = r
            ans = r["response"] or "(空)"
            print(f"  [{p['label']:6}] {r['gen_tps']:6.1f} tok/s  prompt {r['prompt_tps']:7.1f} tok/s  "
                  f"total {r['wall']:5.2f}s  out {r['out_tokens']}tok  mem {r['peak_mem_gb']:.2f}GB", flush=True)
            print(f"           ans-> {ans[:100].replace(chr(10),' / ')}", flush=True)
        mx.clear_cache()

    print(f"\n\n{'#'*60}\n# MLX SUMMARY  (平均 生成tok/s / 平均 prompt tok/s / 平均 total / peak mem)\n{'#'*60}")
    print(f"{'model':30} {'gen tok/s':>10} {'prompt t/s':>11} {'avg total':>10} {'peak mem':>10}")
    for label, _, _ in MODELS:
        rr = results.get(label)
        if not rr:
            print(f"{label:30} {'N/A':>10}")
            continue
        vals = list(rr.values())
        avg_g = sum(v["gen_tps"] for v in vals) / len(vals)
        avg_p = sum(v["prompt_tps"] for v in vals) / len(vals)
        avg_t = sum(v["wall"] for v in vals) / len(vals)
        peak = max(v["peak_mem_gb"] for v in vals)
        print(f"{label:30} {avg_g:10.1f} {avg_p:11.1f} {avg_t:9.2f}s {peak:8.2f}GB")

    with open("tests/model_bench/results_gemma4_mlx.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nfull results -> tests/model_bench/results_gemma4_mlx.json")


if __name__ == "__main__":
    main()
