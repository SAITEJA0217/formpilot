# v1 held-out results — what each file is

| File | What it is | Independent? |
| --- | --- | --- |
| `latest.json`, `latest.md` | **The frozen v1 result.** Configuration `6e01e8e`, measured before the payment-field safety fix. Accuracy 82.1%, macro F1 73.1%, 4 missed refusals. | **Yes** |
| `post-safety-fix-rescore.json`, `.md` | The *same corpus* re-scored after the safety fix. Accuracy 83.4%, macro F1 73.2%, **0 missed refusals**. | **No** |

**Why the second file is not an independent result.** The safety fix was made *because* of the four
misses this corpus exposed. Re-scoring the same corpus afterwards measures whether the fix worked —
which it does, 4 → 0 — but the corpus is now a training set for that fix. Quoting 83.4% as an
independent accuracy figure would be exactly the substitution the project has avoided elsewhere.

`latest.json` is therefore never regenerated. `npm run study:heldout` will overwrite it; if you run
it, restore it with `git checkout -- research/heldout/results/latest.json`. The independent
post-fix measurement is `research/heldout-v2/`, on a corpus sampled after the fix was frozen.
