import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBufferHistogram } from '../src/index.js';

test('constructor rejects non-positive size', () => {
    assert.throws(() => new RingBufferHistogram({ size: 0 }), TypeError);
    assert.throws(() => new RingBufferHistogram({ size: -1 }), TypeError);
    assert.throws(() => new RingBufferHistogram({ size: 1.5 }), TypeError);
    assert.throws(() => new RingBufferHistogram({}), TypeError);
    assert.throws(() => new RingBufferHistogram(), TypeError);
});

test('record and count on a partially filled buffer', () => {
    const h = new RingBufferHistogram({ size: 4 });
    assert.strictEqual(h.count(), 0);
    h.record(10);
    h.record(20);
    h.record(30);
    assert.strictEqual(h.count(), 3);
    assert.deepStrictEqual(h.samples(), [10, 20, 30]);
});

test('ring buffer overwrites oldest sample when full', () => {
    const h = new RingBufferHistogram({ size: 3 });
    h.record(1);
    h.record(2);
    h.record(3);
    h.record(4); // overwrites the 1
    assert.strictEqual(h.count(), 3);
    assert.deepStrictEqual(h.samples(), [2, 3, 4]);
});

test('mean uses running sum and stays correct after wraparound', () => {
    const h = new RingBufferHistogram({ size: 3 });
    h.record(10);
    h.record(20);
    h.record(30);
    assert.strictEqual(h.mean(), 20);
    h.record(40); // evicts 10
    assert.strictEqual(h.mean(), 30); // (20+30+40)/3
});

test('mean returns 0 for empty histogram', () => {
    const h = new RingBufferHistogram({ size: 5 });
    assert.strictEqual(h.mean(), 0);
});

test('min and max reflect valid samples only', () => {
    const h = new RingBufferHistogram({ size: 4 });
    h.record(5);
    h.record(1);
    h.record(9);
    assert.strictEqual(h.min(), 1);
    assert.strictEqual(h.max(), 9);
    // Fill past capacity so the oldest (5) is evicted.
    h.record(2);
    h.record(7);
    assert.strictEqual(h.min(), 1);
    assert.strictEqual(h.max(), 9);
});

test('min and max return 0 for empty histogram', () => {
    const h = new RingBufferHistogram({ size: 3 });
    assert.strictEqual(h.min(), 0);
    assert.strictEqual(h.max(), 0);
});

test('percentile uses nearest-rank on sorted samples', () => {
    const h = new RingBufferHistogram({ size: 100 });
    for (let i = 1; i <= 10; i++) h.record(i);
    // nearest-rank: rank = ceil(p/100 * n)
    assert.strictEqual(h.percentile(50), 5);  // ceil(0.5*10)=5 -> sorted[4]=5
    assert.strictEqual(h.percentile(90), 9);  // ceil(0.9*10)=9 -> sorted[8]=9
    assert.strictEqual(h.percentile(100), 10);
    assert.strictEqual(h.percentile(1), 1);
});

test('percentile rejects out-of-range and empty cases', () => {
    const h = new RingBufferHistogram({ size: 4 });
    assert.throws(() => h.percentile(50), RangeError); // empty
    h.record(42);
    assert.throws(() => h.percentile(0), RangeError);
    assert.throws(() => h.percentile(-1), RangeError);
    assert.throws(() => h.percentile(101), RangeError);
    assert.throws(() => h.percentile(NaN), RangeError);
    assert.throws(() => h.percentile('50'), RangeError);
});

test('record rejects non-finite values', () => {
    const h = new RingBufferHistogram({ size: 4 });
    assert.throws(() => h.record(NaN), TypeError);
    assert.throws(() => h.record(Infinity), TypeError);
    assert.throws(() => h.record(-Infinity), TypeError);
    assert.throws(() => h.record('10'), TypeError);
});

test('recordElapsed uses the injected clock and returns elapsed', () => {
    let t = 1000;
    const h = new RingBufferHistogram({ size: 4, clock: () => t });
    const start = h.startTimer();
    assert.strictEqual(start, 1000);
    t = 1042;
    const elapsed = h.recordElapsed(start);
    assert.strictEqual(elapsed, 42);
    assert.strictEqual(h.count(), 1);
    assert.strictEqual(h.samples()[0], 42);
});

test('reset clears samples and aggregate state', () => {
    const h = new RingBufferHistogram({ size: 3 });
    h.record(1);
    h.record(2);
    h.reset();
    assert.strictEqual(h.count(), 0);
    assert.strictEqual(h.mean(), 0);
    assert.deepStrictEqual(h.samples(), []);
    // Buffer is reusable after reset.
    h.record(99);
    assert.strictEqual(h.count(), 1);
    assert.strictEqual(h.samples()[0], 99);
});

test('samples returns oldest-first after multiple wraparounds', () => {
    const h = new RingBufferHistogram({ size: 3 });
    h.record(1);
    h.record(2);
    h.record(3);
    h.record(4); // wrap once: [4,2,3] head=1
    h.record(5); //          [4,5,3] head=2
    h.record(6); //          [4,5,6] head=0 (full second wrap)
    assert.deepStrictEqual(h.samples(), [4, 5, 6]);
});
