import fs from 'node:fs';

const barrier = process.env.RASEN_DELAYED_WRITER_BARRIER;
const target = process.env.RASEN_DELAYED_WRITER_TARGET;
const marker = process.env.RASEN_DELAYED_WRITER_MARKER;

if (!barrier || !target || !marker) {
  process.stderr.write('delayed writer fixture is missing its bounded paths\n');
  process.exit(2);
}

const deadline = Date.now() + 10_000;
const timer = setInterval(() => {
  if (Date.now() > deadline) {
    clearInterval(timer);
    process.exit(3);
  }
  if (!fs.existsSync(barrier)) return;
  clearInterval(timer);
  fs.writeFileSync(target, 'delayed-teacher-write\n', 'utf8');
  fs.writeFileSync(marker, 'done\n', 'utf8');
}, 5);
