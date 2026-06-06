#!/usr/bin/env python3
"""gemma4 モデル横断ベンチマーク。

Ollama /api/generate の metrics を使い、各モデルについて
  - prompt_eval (TTFT 近似): prompt_eval_duration
  - generation 速度: eval_count / eval_duration  -> tok/s
  - 総レイテンシ: total_duration
を測定する。出力本文も保存して品質を目視比較できるようにする。

usage: python3 bench_gemma4.py
"""
import json
import sys
import time
import urllib.request

OLLAMA = "http://127.0.0.1:11434/api/generate"

MODELS = [
    "gemma4:e4b",
    "gemma4:12b",
    "gemma4:26b-a4b-it-q4_K_M",
    "gemma4-26b-nothink:latest",
]

# Ember(Mei/Eve/Haru) の実用途を意識した日本語タスク
PROMPTS = [
    {
        "id": "conv_empathy",
        "label": "会話/共感",
        "prompt": "今日は疲れたよ。明日も朝から会議が3つある。\n親しい秘書として2文以内で短く返して。",
    },
    {
        "id": "reasoning",
        "label": "推論",
        "prompt": "次の問いに答えて、理由も一行で。\n太郎は花子より背が高い。花子は次郎より背が高い。一番背が高いのは誰？",
    },
    {
        "id": "summarize",
        "label": "要約",
        "prompt": "次を30字以内の日本語で要約して:\n『四半期の売上は前年同期比12%増となったが、円安による原材料高で営業利益率は2ポイント低下した。来期は価格改定で利益率の回復を見込む。』",
    },
    {
        "id": "instruction",
        "label": "指示追従",
        "prompt": "次の3つの予定を、開始時刻の早い順に『HH:MM タイトル』の形式で箇条書きにして。それ以外は出力しない。\n- 15:00 顧客MTG\n- 09:30 朝会\n- 13:00 ランチ面談",
    },
    {
        "id": "knowledge",
        "label": "知識",
        "prompt": "ストルバイト結石の猫の食事で気をつける点を3つ、簡潔に箇条書きで。",
    },
]

OPTS = {"temperature": 0.3, "num_predict": 1024, "seed": 42}


def run(model, prompt):
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "think": True,          # thinking を別フィールドで受け取る
        "options": OPTS,
    }).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        data = json.loads(r.read())
    wall = time.time() - t0
    ec = data.get("eval_count", 0)
    ed = data.get("eval_duration", 1) / 1e9  # s
    ped = data.get("prompt_eval_duration", 0) / 1e9
    td = data.get("total_duration", 0) / 1e9
    return {
        "wall": wall,
        "tok_s": ec / ed if ed else 0,
        "ttft": ped,
        "total": td,
        "out_tokens": ec,
        "thinking": (data.get("thinking") or "").strip(),
        "response": (data.get("response") or "").strip(),
    }


def main():
    results = {}
    for m in MODELS:
        print(f"\n{'='*60}\nMODEL: {m}\n{'='*60}", flush=True)
        results[m] = {}
        # warmup (モデルロード時間を計測から除外)
        try:
            run(m, "こんにちは")
        except Exception as e:
            print(f"  [skip] load failed: {e}", flush=True)
            results[m] = None
            continue
        for p in PROMPTS:
            try:
                r = run(m, p["prompt"])
            except Exception as e:
                print(f"  [{p['id']}] ERROR: {e}", flush=True)
                continue
            results[m][p["id"]] = r
            think_n = len(r["thinking"])
            ans = r["response"] or "(空: 思考で予算切れ)"
            print(f"  [{p['label']:6}] {r['tok_s']:6.1f} tok/s  ttft {r['ttft']*1000:6.0f}ms  "
                  f"total {r['total']:5.2f}s  out {r['out_tokens']}tok  think {think_n}字", flush=True)
            print(f"           ans-> {ans[:100].replace(chr(10),' / ')}", flush=True)

    # サマリ表
    print(f"\n\n{'#'*60}\n# SUMMARY  (平均 tok/s / 平均 total)\n{'#'*60}")
    print(f"{'model':32} {'avg tok/s':>10} {'avg total':>10}")
    for m in MODELS:
        rr = results.get(m)
        if not rr:
            print(f"{m:32} {'N/A':>10}")
            continue
        vals = [v for v in rr.values()]
        avg_ts = sum(v["tok_s"] for v in vals) / len(vals)
        avg_tot = sum(v["total"] for v in vals) / len(vals)
        print(f"{m:32} {avg_ts:10.1f} {avg_tot:9.2f}s")

    with open("tests/model_bench/results_gemma4.json", "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print("\nfull results + outputs -> tests/model_bench/results_gemma4.json")


if __name__ == "__main__":
    main()
