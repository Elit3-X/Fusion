import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PIPELINE_FIXTURE_PREFIX = "fusion-pipeline-smoke-";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A local-only repository pair used to exercise git without reaching an operator repository. */
export interface PipelineGitFixture {
  readonly rootDir: string;
  readonly repoDir: string;
  readonly bareOriginDir: string;
  git(args: string[]): string;
  seedFile(name: string, content: string): void;
  createEmptyBranch(branch: string): void;
  cleanup(): void;
}

/*
FNXC:PipelineSmoke 2026-08-23-14:18:
FN-182 needs real git admission and push/fetch paths without a network dependency. Every path
created here is rooted below this fixture's known mkdtemp directory, so cleanup never scans or
mutates the system temp root or an operator checkout.
*/
export function createPipelineGitFixture(): PipelineGitFixture {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), PIPELINE_FIXTURE_PREFIX));
  const repoDir = path.join(rootDir, "project");
  const bareOriginDir = path.join(rootDir, "origin.git");
  mkdirSync(repoDir, { recursive: true });
  git(repoDir, ["init", "-b", "main"]);
  git(repoDir, ["config", "user.email", "pipeline-smoke@example.test"]);
  git(repoDir, ["config", "user.name", "Pipeline Smoke"]);
  writeFileSync(path.join(repoDir, "README.md"), "# pipeline smoke\n", "utf8");
  // FNXC:PipelineSmoke 2026-08-23-14:56: Worktree acquisition writes metadata below .fusion and linked checkouts below .worktrees; ignore both so cleanliness measures task code rather than harness artifacts.
  writeFileSync(path.join(repoDir, ".gitignore"), ".fusion/\n.worktrees/\n", "utf8");
  mkdirSync(path.join(repoDir, ".fusion", "tasks"), { recursive: true });
  git(repoDir, ["add", "."]);
  git(repoDir, ["commit", "-m", "baseline"]);
  git(rootDir, ["init", "--bare", bareOriginDir]);
  git(repoDir, ["remote", "add", "origin", bareOriginDir]);
  git(repoDir, ["push", "-u", "origin", "main"]);

  return {
    rootDir,
    repoDir,
    bareOriginDir,
    git: (args) => git(repoDir, args),
    seedFile: (name, content) => {
      const target = path.join(repoDir, name);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    },
    createEmptyBranch: (branch) => {
      git(repoDir, ["branch", "-f", branch, "main"]);
    },
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}

export const hasGit = spawnSync("git", ["--version"], { stdio: "pipe" }).status === 0;

export function fixturePathsExist(fixture: PipelineGitFixture): boolean {
  return existsSync(fixture.rootDir) && existsSync(fixture.repoDir) && existsSync(fixture.bareOriginDir);
}
