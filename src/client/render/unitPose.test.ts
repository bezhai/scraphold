import { describe, expect, it } from 'vitest';
import { FACING_BUCKETS, RECOIL_MS, bucketAngle, facingBucket, poseFrame, steadyBucket } from './unitPose';

const WIDTH = (Math.PI * 2) / FACING_BUCKETS;

describe('facingBucket', () => {
  it('quantizes angles into 16 directions and wraps around', () => {
    expect(FACING_BUCKETS).toBe(16);
    expect(facingBucket(0)).toBe(0);
    expect(facingBucket(Math.PI)).toBe(FACING_BUCKETS / 2);
    expect(facingBucket(-Math.PI / 2)).toBe((FACING_BUCKETS * 3) / 4);
    expect(facingBucket(Math.PI * 2 - 0.01)).toBe(0);
    expect(facingBucket(Math.PI * 4 + Math.PI / 2)).toBe(FACING_BUCKETS / 4);
  });

  it('bucketAngle is the center angle of a bucket', () => {
    expect(bucketAngle(0)).toBe(0);
    expect(bucketAngle(FACING_BUCKETS / 4)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('steadyBucket', () => {
  it('takes the nearest bucket when there is no current facing', () => {
    expect(steadyBucket(null, Math.PI / 2)).toBe(FACING_BUCKETS / 4);
  });

  it('keeps the current bucket for small wobbles across a bucket border', () => {
    expect(steadyBucket(0, WIDTH * 0.6)).toBe(0);
    expect(steadyBucket(0, -WIDTH * 0.6)).toBe(0);
    expect(steadyBucket(1, WIDTH * 0.4)).toBe(1);
  });

  it('turns once the direction is clearly in another bucket, also across the wrap', () => {
    expect(steadyBucket(0, WIDTH * 0.9)).toBe(1);
    expect(steadyBucket(0, Math.PI)).toBe(FACING_BUCKETS / 2);
    expect(steadyBucket(0, Math.PI * 2 - WIDTH * 0.6)).toBe(0);
    expect(steadyBucket(FACING_BUCKETS - 1, -WIDTH * 0.3)).toBe(FACING_BUCKETS - 1);
    expect(steadyBucket(FACING_BUCKETS - 1, WIDTH * 0.1)).toBe(0);
  });
});

describe('poseFrame', () => {
  it('stands idle when not moving and not firing', () => {
    expect(poseFrame(false, null, 1234, 150)).toBe('idle');
  });

  it('recoils right after a shot, even while moving', () => {
    expect(poseFrame(false, 0, 0, 150)).toBe('recoil');
    expect(poseFrame(true, RECOIL_MS - 1, 0, 150)).toBe('recoil');
    expect(poseFrame(false, RECOIL_MS + 1, 0, 150)).toBe('idle');
  });

  it('cycles step A, pass, step B, pass while moving', () => {
    const frames = [0, 150, 300, 450, 600].map((t) => poseFrame(true, null, t, 150));
    expect(frames).toEqual(['stepA', 'idle', 'stepB', 'idle', 'stepA']);
  });
});
