const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content-script.js'), 'utf8');
const engine = source.slice(source.indexOf('const HEADING_SELECTORS'), source.indexOf('function startImmersive()'));

function dispatch(items) {
  const sent = [];
  const context = vm.createContext({
    sent,
    items,
    window: { innerHeight: 800 },
    setTimeout: jest.fn(() => 1),
    clearTimeout: jest.fn()
  });
  vm.runInContext(engine, context);
  vm.runInContext(`
    immersiveEnabled = true;
    isCurrentImmersiveWork = () => true;
    translateBatch = async batch => { sent.push(batch.map(({ text }) => text)); };
    translateQueue = items.map(({ text, top = 0 }) => ({
      text,
      works: [{ el: { getBoundingClientRect: () => ({ top, bottom: top + 20 }) } }]
    }));
    drain();
  `, context);
  return sent.map(batch => Array.from(batch));
}

test('dispatches a small initial batch and at most three concurrent batches', () => {
  const sent = dispatch(Array.from({ length: 30 }, (_, index) => ({ text: 'Paragraph ' + index })));
  expect(sent.map(batch => batch.length)).toEqual([2, 6, 6]);
});

test('caps aggregate characters while allowing a long paragraph to run alone', () => {
  const sent = dispatch([
    { text: 'a'.repeat(1300) },
    { text: 'b'.repeat(7000) },
    ...Array.from({ length: 4 }, () => ({ text: 'c'.repeat(2000) }))
  ]);
  expect(sent.map(batch => batch.map(text => text.length))).toEqual([[1300], [7000], [2000, 2000, 2000]]);
});

test('sends visible paragraphs before preloaded off-screen paragraphs', () => {
  const sent = dispatch([
    { text: 'Preloaded below', top: 1000 },
    { text: 'Visible one', top: 50 },
    { text: 'Visible two', top: 100 }
  ]);
  expect(sent[0]).toEqual(['Visible one', 'Visible two']);
});
