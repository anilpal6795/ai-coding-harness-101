/**
 * Example 7.1: Raw terminal control
 *
 * Demonstrates raw mode, ANSI escape sequences, and key handling
 * without any framework. The "what's happening underneath" demo.
 *
 * Run with:
 *   npx tsx 01-raw-terminal.ts
 *   (Press 'q' to quit cleanly)
 */

// Enter raw mode
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf-8");

// Hide cursor
process.stdout.write("\x1b[?25l");

// Clear screen, move to top-left
process.stdout.write("\x1b[2J\x1b[H");

// Print header in red
process.stdout.write("\x1b[1;31mRaw terminal demo\x1b[0m\n");
process.stdout.write("\x1b[33mPress keys to see their bytes (q to quit)\x1b[0m\n\n");

let row = 4;

process.stdin.on("data", (data: string) => {
  // Quit on q
  if (data === "q") {
    cleanup();
    process.exit(0);
  }
  // Quit on Ctrl+C
  if (data === "\x03") {
    cleanup();
    process.exit(0);
  }

  // Show what we got
  const bytes = [...data].map(c => `0x${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(" ");
  const interpreted =
    data === "\r" ? "Enter" :
    data === "\x7f" ? "Backspace" :
    data === "\t" ? "Tab" :
    data === "\x1b" ? "Escape" :
    data === "\x1b[A" ? "Up arrow" :
    data === "\x1b[B" ? "Down arrow" :
    data === "\x1b[C" ? "Right arrow" :
    data === "\x1b[D" ? "Left arrow" :
    data.length === 1 && data.charCodeAt(0) < 32 ? `Ctrl+${String.fromCharCode(data.charCodeAt(0) + 96)}` :
    `'${data}'`;

  // Move cursor to row, clear line, write
  process.stdout.write(`\x1b[${row};1H\x1b[K`);
  process.stdout.write(`\x1b[36m${interpreted.padEnd(15)}\x1b[0m bytes: \x1b[2m${bytes}\x1b[0m`);
  row = Math.min(row + 1, process.stdout.rows - 1);
});

function cleanup() {
  process.stdout.write("\x1b[?25h");  // show cursor
  process.stdout.write("\x1b[0m");    // reset attributes
  process.stdout.write("\n\nGoodbye!\n");
  process.stdin.setRawMode(false);
  process.stdin.pause();
}
