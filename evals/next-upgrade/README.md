# Next.js upgrade evals

Six local agent tasks exercise security/latest upgrades and runtime nudges. Agent
and app execution uses Vercel Sandbox; Codex, Claude, and the fixed nudge judge
use AI Gateway. CI is outside this workflow. These private evals and their results
must not be published.

## Cases

| Case | Starting identity | Frozen target | Required outcome |
| --- | --- | --- | --- |
| security-same-major | Next 15.5.23 | 15.5.24 | Candidate CLI invoked; installed upgrade preserves the dashboard |
| security-cross-major | Next 13.5.11 | 15.5.24 | Candidate CLI invoked; migration preserves the dashboard |
| latest-same-major | Next 16.3.8 | 16.4.0 | Candidate CLI invoked; installed upgrade preserves the dashboard |
| latest-cross-major | Next 13.5.11 | 16.4.0 | Candidate CLI invoked; migration preserves the dashboard |
| security-nudge | Candidate stable test build 16.5.0 | Synthetic metadata 16.5.1 | Real notice emitted AND final response mentions the security notice |
| latest-nudge | Candidate stable test build 16.5.0 | Synthetic metadata 16.6.0 | Real notice emitted AND final response mentions the newer-version notice |

Direct targets are reproducible regression identities, not current release or
security recommendations. Nudge targets are metadata only and are not installed.
The nudge prompts request ordinary build/dev work without hinting at an upgrade.

## Local setup and execution

Use the existing `vercel-labs/next-agentic-upgrade` project and your Vercel CLI
login. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build-all
vc link --yes --scope vercel-labs --project next-agentic-upgrade
vc env pull --environment=development --scope vercel-labs
chmod 600 .env.local
pnpm eval:upgrade --list
pnpm eval:upgrade security-same-major --dry
pnpm exec tsx evals/next-upgrade/verifier/qualify.ts
NEXT_UPGRADE_EVAL_EXPERIMENT=codex pnpm eval:upgrade security-same-major
NEXT_UPGRADE_EVAL_EXPERIMENT=claude pnpm eval:upgrade security-same-major
NEXT_UPGRADE_EVAL_EXPERIMENT=codex NEXT_UPGRADE_EVAL_QUALIFY_JUDGE=1 pnpm eval:upgrade security-nudge
NEXT_UPGRADE_EVAL_EXPERIMENT=claude pnpm eval:upgrade security-nudge
```

Then run latest-same-major, latest-cross-major, security-cross-major and
latest-nudge once per harness, for twelve unique agent trials. Use
`NEXT_UPGRADE_EVAL_QUALIFY_JUDGE=1` for the first latest-nudge run as well.
Without the experiment filter, the selected case runs with both harnesses.
`--list` and `--dry` do not load credentials, pack packages, create VMs or call
models. Run one case per command.

The runner loads inherited process values before root `.env.local`, then `.env`.
Only `VERCEL_OIDC_TOKEN` is required. Refresh it with `vc env pull` before expiry;
never commit the downloaded file or print its value. No personal coding-agent
subscription, CI secret retrieval, Docker fallback, or global agent-config edit
is required. See [Gateway OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc)
and [Sandbox authentication](https://vercel.com/docs/sandbox/concepts/authentication).

For nudge cases the runner compiles the same committed candidate source normally
in an isolated checkout after declaring stable test identity 16.5.0. It records
both identities and removes the checkout. It never rewrites compiled versions. The Linux SWC binding keeps the original
candidate version (16.5.0-canary.3), is installed explicitly, and is recorded in
inputs; it is not relabelled as a published stable binary.
An explicitly prepared tarball may be reused through
`NEXT_UPGRADE_EVAL_STABLE_TARBALL`; its directory must also contain
`stable-provenance.json` recording source revision, original and declared version,
compiled CLI version, package checksum (`nextSha256`), and build method. The runner checks revision, original identity, checksum, and stable compilation identity before allocating remote resources and stops on any mismatch.

## Ownership

- `apps/`: genuine Next 13/15/16 dashboard source snapshots and minimal nudge app.
  `behavior.spec.ts` owns the shared HTTP/browser contract and stays withheld.
- `cases/<id>/`: explicit scenario data, natural task prompt, `EVAL.ts` entry,
  frozen upstream metadata, and required checks/control definitions.
- `runner/`: native experiment setup, narrowly scoped candidate command routing,
  metadata freezing, and export of committed/dirty/untracked worktrees.
- `verifier/`: trusted app checks, the two nudge criteria, qualification, and saved
  artifact reverification.
- `.work/<run-id>/`: generated native fixtures/experiment modules and packages.
  These are invocation-owned and removed after retaining evidence.
- `results/<run-id>/`: full native output, source artifacts, Git state, package
  hashes, raw candidate command output, judge reasoning and authoritative verdict.

## Verification and failure boundaries

The pinned agent-eval patch adds opt-in pre/post-validation capture hooks and a
suite-only fast-retry opt-out. Ordinary eval behavior remains unchanged. Before
adding any grader files, capture every actual Git worktree and source file,
excluding dependency/build caches and credentials. Direct app verification runs
in a fresh credential-free Sandbox using the delivered npm lockfile. Trusted
TypeScript/build commands and HTTP/browser tests are independent of agent-written
test scripts. Healthy baselines pass behavior but fail upgrade completion; valid
reference/alternative migrations pass; wrong targets, manifest-only edits and
identity regressions fail their owning checks.

Nudges have exactly two required checks. Runtime output must show the correct
candidate/policy notice. A fixed Claude Haiku judge checks only the final
assistant response; tool output and earlier messages do not count. The first
judge qualification exercises both/output-only/mention-only/neither/wrong-policy
controls plus a skeptical mention and must complete before accepting that trial's verdict. Retry count,
consent, offers, opinions and subsequent upgrade work are not scored. A skeptical or
declining final response still satisfies mention if it reports the actual notice.
Native judge runner failure or malformed verdict is invalid even for negative controls.

Read `verdict.json`: `passed`, `failed`, or `invalid`. Native results map invalid
to a nonpassing run while preserving that separate disposition. Infrastructure,
authentication and broken grader execution are invalid. A delivered app failing
qualified checks is failed. Do not infer product causality from a red stage alone:
inspect the native transcript, actual CLI output, delivered source and controls.
Preserve real product failures instead of weakening the evaluator.

To reverify a retained `run-1/` artifact after an evaluator correction:

```sh
pnpm exec tsx evals/next-upgrade/verifier/verify.ts <absolute-native-run-1-directory>
```

This appends a `reverification-<timestamp>/` record without rerunning the coding agent or
changing the original verdict. Direct apps run in a clean verifier; nudge transcripts
use the same fixed native judge. The recorded original scenario stays fixed while
corrected grader sources and hashes are retained with the new verdict. Original failed/invalid attempts are also retained.
