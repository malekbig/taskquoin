/** Child process for tui-screen.test.ts: withTerminal over a fake io that writes to stdout, then waits for a real signal. */
import { processSignals, withTerminal, type TtyIO } from '../../src/tui/screen.ts';

const io: TtyIO = {
  write: (s) => { process.stdout.write(s); },
  setRawMode: () => {},
  onData: () => () => {},
  onResize: () => () => {},
  size: () => ({ columns: 80, rows: 24 }),
};

await withTerminal(io, processSignals, async () => {
  process.stdout.write('READY\n');
  setInterval(() => {}, 1000);
  await new Promise(() => {});
});
