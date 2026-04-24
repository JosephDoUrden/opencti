import { describe, expect, it } from 'vitest';
import { wait } from '../../../src/database/utils';
import { InterruptibleTimer } from '../../../src/manager/interruptible-timer';

describe('interruptible time test coverage', () => {
  it('should interruption works', async () => {
    const startTime = Date.now();

    const timer = new InterruptibleTimer();

    const veryLongButStoppableAction = async () => {
      console.time('1minute stuff');
      await timer.start(60_000); // blocked for 1 minute
      console.timeEnd('1minute stuff');
    };

    const stoppingAction = async () => {
      console.time('500ms stuff');
      await wait(500);
      timer.interrupt(); // resolves immediately after 500ms instead of 1 minute
      console.timeEnd('500ms stuff');
    };
    const allPromises = [];
    allPromises.push(veryLongButStoppableAction());
    allPromises.push(stoppingAction());
    await Promise.all(allPromises);

    // Stop action should end timer, so it should last a little more than 1s
    const totalTime = Date.now() - startTime;
    expect(totalTime).toBeLessThan(2_000);
    expect(totalTime).toBeGreaterThan(200);
  });
});
