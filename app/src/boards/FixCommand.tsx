// When a board needs a command run (sign in to GitHub, grant project access, install gh), BRAIN2 types
// it into the built-in terminal for the user: they see exactly what runs and answer any prompts there.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { useApp } from "../store";
import { useTerminals } from "../terminal/store";

const shellQuote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const commandText = (argv: string[]) => argv.map(shellQuote).join(" ");

/** Runs ``argv`` in the "Boards" terminal (opened and shown) and resolves with its exit code. */
export async function runInTerminal(argv: string[]): Promise<number> {
  const term = await useTerminals.getState().showKey("boards", "Boards");
  if (!term) throw new Error("Could not open a terminal");
  // Listen before starting: the job can finish before the request returns.
  const done = new Map<string, number>();
  let wanted: string | null = null;
  let resolve!: (code: number) => void;
  const finished = new Promise<number>((r) => (resolve = r));
  const onJob = (e: Event) => {
    const { job_id, code } = (e as CustomEvent<{ job_id: string; code: number }>).detail;
    if (job_id === wanted) resolve(code);
    else done.set(job_id, code);
  };
  window.addEventListener("brain2:terminal-job", onJob);
  try {
    const { job_id } = await api.terminalRun(term.id, argv);
    wanted = job_id;
    if (done.has(job_id)) resolve(done.get(job_id)!);
    return await finished;
  } finally {
    window.removeEventListener("brain2:terminal-job", onJob);
  }
}

/** An error with an optional "Run it for me" button; ``onFixed`` runs after the command succeeds. */
export function FixableError({ message, command, onFixed, onRetry, onRun }: {
  message: string;
  command?: string[];
  onFixed: () => void;
  onRetry?: () => void;
  /** Take over running the command (e.g. a dialog that must close so the terminal can be used). */
  onRun?: (command: string[]) => void;
}) {
  const [running, setRunning] = useState(false);
  const run = async () => {
    if (!command) return;
    if (onRun) return onRun(command);
    setRunning(true);
    try {
      const code = await runInTerminal(command);
      if (code === 0) onFixed();
      else useApp.getState().toast(`The command stopped with exit code ${code}. Check the terminal below.`, "error");
    } catch (e) {
      useApp.getState().toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="fixable-error">
      <p className="danger-text small">{message}</p>
      {command && (
        <>
          <code className="fix-command">{commandText(command)}</code>
          <p className="muted tiny">
            BRAIN2 runs this in the built-in terminal so you can follow it and answer any prompts (like opening GitHub in your browser).
          </p>
        </>
      )}
      <div className="row">
        {command && (
          <button className="btn btn-primary btn-small" onClick={run} disabled={running}>
            <Icon name={running ? "hourglass_top" : "terminal"} size={16} /> {running ? "Running in the terminal…" : "Run it for me"}
          </button>
        )}
        {onRetry && (
          <button className="btn btn-small" onClick={onRetry} disabled={running}>
            <Icon name="refresh" size={16} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
