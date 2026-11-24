# Change Log

## 2026-11-23

- Fixed omitted anonymous paragraphs in containers that also contain tagged child paragraphs, including Hacker News post introductions and comments.
- Kept each inline text run separate from child paragraphs, preserving original links, emphasis, node order and event listeners.
- Added browser regression coverage for mixed markup, introductions longer than 6000 characters, dynamic edits, cleanup and restart.

## 2026-11-18

- Added first-screen priority, small initial batches and length-bounded paragraph batches for full-page translation.
- Added per-session in-flight deduplication and a 200-entry translation cache; selection translation stays independent.
- Matched batch responses by paragraph ID, preserving valid translations when other paragraphs fail.
- Added per-paragraph retry controls and a 25-second provider request timeout.
- Added batch API tests and browser checks for caching, retry, stale responses and session restart.
- Validation: 24 unit tests passed. With simulated latency, the same page's 9 distinct texts used 3 requests instead of 9; initial completion was about 242 ms versus 368 ms. These are not live provider latency measurements.
- Kept API keys in browser-local storage; no credentials were added to project files.

## 2026-11-16

- Replaced DeepSeek translation and weekly reviews with Alibaba Cloud Qwen.
- Added coverage for short headings, standalone text blocks, captions and table cells.
- Added dynamic text updates, stale-response protection and browser regression fixtures.
