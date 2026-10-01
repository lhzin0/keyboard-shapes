/**
 * npm run detect:layout -- --text="Keychron Q1 75% wired" | --keyboard=reference-65
 *
 * Shows how a layout is detected: from free text, or from the key map of a catalog keyboard.
 */
import { detectLayout, detectLayoutByVoting, detectLayoutFromText } from '../../src/import/LayoutDetector';
import { db } from '../../src/services/database';
import { c, parseArgs } from '../lib/node';

const args = parseArgs(process.argv.slice(2));
const show = (label: string, d: { layout: string; confidence: number; reasons: string[]; candidates: Array<{ layout: string; score: number }> }) => {
  console.log(`${c.bold(label)}  ${d.layout}  ${c.dim(`${Math.round(d.confidence * 100)}%`)}`);
  d.reasons.forEach((r) => console.log(c.dim(`  · ${r}`)));
  if (d.candidates.length > 1) console.log(c.dim(`  candidates: ${d.candidates.map((x) => `${x.layout} (${x.score})`).join(', ')}`));
};

if (typeof args['text'] === 'string') {
  show('first keyword  ', detectLayoutFromText(args['text'] as string));
  show('keyword voting ', detectLayoutByVoting(args['text'] as string));
} else if (typeof args['keyboard'] === 'string') {
  const kb = db.keyboards.find((k) => k.slug === args['keyboard'] || k.id === args['keyboard']);
  if (!kb) {
    console.error(c.fail('keyboard not found'));
    process.exit(1);
  }
  show(`key map of ${kb.slug}`, detectLayout(kb.layout.keys, `${kb.brand} ${kb.model}`));
  console.log(c.dim(`recorded layout: ${kb.layout.name}`));
} else {
  console.error('Usage: npm run detect:layout -- --text="…" | --keyboard=<slug>');
  process.exit(2);
}
