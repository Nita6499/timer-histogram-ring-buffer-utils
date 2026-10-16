# timer-histogram-ring-buffer-utils

Stores fixed-size latency samples in a ring buffer and computes percentiles without unbounded memory growth.

```js
import { RingBufferHistogram } from 'timer-histogram-ring-buffer-utils';

const hist = new RingBufferHistogram({ size: 1024 });

const start = hist.startTimer();
// ... do work ...
const elapsed = hist.recordElapsed(start);

console.log(hist.percentile(99));
console.log(hist.median());
console.log(hist.mean());
```

## Why

Long-running timers that accumulate every sample in a growing array eventually exhaust memory. A fixed-width bucket histogram avoids that, but loses precision when latencies fall outside pre-chosen bounds or are sparse. This library holds a sliding window of the most recent `size` raw samples in a ring buffer, so percentile queries see exact recorded values and memory stays bounded.

Percentiles use the nearest-rank method: the p-th percentile is the value at rank `ceil(p / 100 * n)` in the sorted samples. The result is always a sample that was actually recorded — no interpolation. This matches the default behaviour of NumPy and most monitoring tools, but differs from libraries that linearly interpolate between adjacent ranks.

## Edge cases

- `percentile` throws `RangeError` on an empty histogram. Returning 0 would be indistinguishable from a genuine zero-latency measurement.
- `mean`, `min`, and `max` return 0 on an empty histogram. Choose guards accordingly if 0 is a plausible latency in your workload.
- `record` rejects `NaN`, `Infinity`, and `-Infinity`. A single `NaN` corrupts every sort comparison; `Infinity` skews `max` toward a value you almost certainly did not intend to measure.
- `percentile(0)` is rejected — nearest-rank is undefined there.

## API

Exports one class: `RingBufferHistogram`.

- `new RingBufferHistogram({ size, clock? })` — `size` is a positive integer; `clock` is an optional `() => number` used by `startTimer` / `recordElapsed`, defaulting to `Date.now`.
- `record(value)` — store a finite numeric sample.
- `startTimer()` — read the clock; pair with `recordElapsed`.
- `recordElapsed(start)` — compute `clock() - start`, record it, and return the elapsed value.
- `samples()` — defensive copy of valid samples, oldest first.
- `count()`, `mean()`, `min()`, `max()`.
- `percentile(p)` — `p` in `(0, 100]`.
- `median()` — shorthand for `percentile(50)`.
- `reset()` — clear all samples and internal state.

## Run tests

```
node --test
```
