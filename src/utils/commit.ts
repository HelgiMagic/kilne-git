/** Default commit message when the user leaves the field blank. */
export function defaultCommitMessage(): string {
  return `auto: sync from android @ ${new Date().toISOString()}`
}
