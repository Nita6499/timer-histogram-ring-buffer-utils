/**
 * Timer Histogram Ring Buffer utility.
 *
 * Stores fixed-size latency samples in a circular buffer and computes
 * percentiles without unbounded memory growth.
 */
export class RingBufferHistogram {
    /**
     * @param {Object} options
     * @param {number} options.size - Maximum number of samples retained. When the
     *   buffer fills, the oldest sample is overwritten on the next record() call.
     *   Fixed size is the whole point of this library: a raw growing array would
     *   leak memory for long-running timers, and a fixed-width bucket histogram
     *   would lose precision for out-of-range or sparse workloads.
     * @param {() => number} [options.clock] - Optional monotonic clock function
     *   returning the current time in ms. Used only by time(). Tests pass a fake
     *   to keep behaviour deterministic. Defaults to Date.now.
     */
    constructor(options) {
        if (!options || typeof options !== 'object') {
            throw new TypeError('options is required');
        }
        const size = options.size;
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || Math.floor(size) !== size) {
            throw new TypeError('options.size must be a positive integer');
        }
        this._size = size;
        this._buffer = new Array(size).fill(0);
        this._head = 0;       // index where the NEXT sample will be written
        this._count = 0;      // number of valid samples (capped at size)
        this._sum = 0;        // running sum so mean() is O(1)
        this._clock = typeof options.clock === 'function' ? options.clock : Date.now;
    }

    /**
     * Record an explicit latency value (milliseconds, or whatever unit the
     * caller chooses — the library is unit-agnostic).
     *
     * Non-finite values (NaN, Infinity, -Infinity) are rejected because they
     * silently corrupt percentiles: a single NaN makes every sort comparison
     * meaningless, and Infinity skews max() toward a value the caller almost
     * certainly did not intend to measure.
     *
     * @param {number} value
     * @returns {void}
     */
    record(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError('value must be a finite number');
        }
        if (this._count < this._size) {
            // Buffer not yet full: append without overwriting.
            this._buffer[this._head] = value;
            this._sum += value;
            this._count++;
        } else {
            // Buffer full: subtract the value we are about to overwrite, then
            // replace it. Keeping a running sum avoids an O(n) rescan on every
            // record for mean().
            const old = this._buffer[this._head];
            this._buffer[this._head] = value;
            this._sum += value - old;
        }
        this._head = (this._head + 1) % this._size;
    }

    /**
     * Convenience: read the clock, record the elapsed time since start, and
     * return the elapsed value in ms. Useful for timing synchronous code.
     *
     * @param {number} start - A timestamp previously obtained from startTimer()
     *   or the same clock function.
     * @returns {number} The elapsed value that was recorded.
     */
    recordElapsed(start) {
        if (typeof start !== 'number' || !Number.isFinite(start)) {
            throw new TypeError('start must be a finite number');
        }
        const now = this._clock();
        const elapsed = now - start;
        this.record(elapsed);
        return elapsed;
    }

    /**
     * Read the clock. Pair with recordElapsed() for timing.
     * @returns {number}
     */
    startTimer() {
        return this._clock();
    }

    /**
     * Snapshot of valid samples in insertion order (oldest first). The ring
     * buffer's logical contents do not match its physical array once it wraps,
     * so callers should use this method rather than poking at internals.
     *
     * Returns a defensive copy so mutations to the returned array cannot
     * corrupt the live buffer.
     *
     * @returns {number[]}
     */
    samples() {
        if (this._count < this._size) {
            return this._buffer.slice(0, this._count);
        }
        return this._buffer.slice(this._head).concat(this._buffer.slice(0, this._head));
    }

    /**
     * Number of valid samples currently held (0..size).
     * @returns {number}
     */
    count() {
        return this._count;
    }

    /**
     * Arithmetic mean of valid samples. O(1) thanks to the running sum.
     * Returns 0 when empty (documented choice — returning NaN would force every
     * caller to guard, and 0 is the sensible neutral value for "no data yet").
     * @returns {number}
     */
    mean() {
        if (this._count === 0) return 0;
        return this._sum / this._count;
    }

    /**
     * Minimum recorded sample. Returns 0 when empty, matching mean()'s
     * "no data" convention so downstream aggregation does not need two
     * different guards.
     * @returns {number}
     */
    min() {
        if (this._count === 0) return 0;
        if (this._count < this._size) {
            let m = Infinity;
            for (let i = 0; i < this._count; i++) {
                if (this._buffer[i] < m) m = this._buffer[i];
            }
            return m;
        }
        let m = this._buffer[0];
        for (let i = 1; i < this._size; i++) {
            if (this._buffer[i] < m) m = this._buffer[i];
        }
        return m;
    }

    /**
     * Maximum recorded sample. Returns 0 when empty (same convention as
     * min/mean).
     * @returns {number}
     */
    max() {
        if (this._count === 0) return 0;
        if (this._count < this._size) {
            let m = -Infinity;
            for (let i = 0; i < this._count; i++) {
                if (this._buffer[i] > m) m = this._buffer[i];
            }
            return m;
        }
        let m = this._buffer[0];
        for (let i = 1; i < this._size; i++) {
            if (this._buffer[i] > m) m = this._buffer[i];
        }
        return m;
    }

    /**
     * Nearest-rank percentile.
     *
     * Returns the smallest sample that is >= the requested fraction of the
     * data. Interpretation chosen (and the only one implemented): "the p-th
     * percentile is the value at rank ceil(p/100 * n) in the sorted list."
     * This is the definition used by NumPy's default and by most monitoring
     * tools; it does not interpolate between adjacent samples, so the result
     * is always a value that was actually recorded.
     *
     * Edge cases:
     *   - p out of (0, 100] throws RangeError. p=0 is rejected because the
     *     nearest-rank method is undefined there.
     *   - Empty histogram throws RangeError. Returning 0 here would be
     *     indistinguishable from a real zero-latency sample.
     *
     * @param {number} p - Percentile in (0, 100]. 50 yields the median.
     * @returns {number}
     */
    percentile(p) {
        if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 100) {
            throw new RangeError('p must be a finite number in (0, 100]');
        }
        if (this._count === 0) {
            throw new RangeError('no samples recorded');
        }
        const n = this._count;
        const sorted = this.samples().sort((a, b) => a - b);
        const rank = Math.ceil((p / 100) * n);
        const idx = Math.min(rank, n) - 1; // rank is 1-based; index is 0-based
        return sorted[idx];
    }

    /**
     * Median — shorthand for percentile(50).
     * @returns {number}
     */
    median() {
        return this.percentile(50);
    }

    /**
     * Remove all samples and reset aggregate state. The underlying array is
     * refilled with zeros so the object is ready for immediate reuse.
     */
    reset() {
        this._buffer.fill(0);
        this._head = 0;
        this._count = 0;
        this._sum = 0;
    }
}
