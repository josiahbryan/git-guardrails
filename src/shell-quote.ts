/**
 * Render an argv as a copy-pasteable, unambiguous command line for diagnostics.
 *
 * The BLOCKED diagnostic re-displays the command that was rejected. Joining the
 * raw argv with spaces is misleading: a multi-line `-m "<msg>"` value bleeds
 * across lines and a trailing `-- <pathspec>` ends up visually glued to the last
 * line of the message, so a reader can't tell where one argument ends and the
 * next begins. Shell-quoting each token keeps every argument a single visible
 * unit (a multi-line message becomes one quoted token) and the result is
 * paste-back-able into a shell.
 */

// Characters that never need quoting in a POSIX shell. Anything outside this
// set (whitespace, newlines, quotes, globs, $, etc.) forces quoting. `~` and
// `^` are included because they are common in git refs (HEAD~1, HEAD^) and are
// not shell-special in a non-word-initial position (every reconstructed token
// here follows `git`/another token, so a leading `~` is never word-initial).
const SAFE_UNQUOTED = /^[A-Za-z0-9_@%+=:,./~^-]+$/;

/** POSIX-shell-quote a single argument. */
export function shellQuote(arg: string): string {
  if (SAFE_UNQUOTED.test(arg)) return arg;
  // Single-quote the whole token and escape any embedded single quote as '\''.
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Render a git argv as a quoted, copy-pasteable `git ...` command line. */
export function formatGitCommand(args: string[]): string {
  return ['git', ...args.map(shellQuote)].join(' ');
}
