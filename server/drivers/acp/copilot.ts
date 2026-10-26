// GitHub Copilot CLI over ACP (`copilot --acp --stdio`), billed to the signed-in Copilot plan.
// Copilot CLI 1.0.103 advertises its models as the `model` config option, each with `_meta.copilotUsage`
// (the premium-request multiplier), and per-model effort as `reasoning_effort`; session/set_config_option
// validates and confirms both. Its own `allow_all` option stays at its `off` default: the ACP broker answers
// every permission request.
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ModelCatalog, ProviderErrorCode } from "../../contracts.ts";
import { createAcpDriver, type AccountErrorCode, type AcpConfig, type AcpSupport } from "./core.ts";
import { AcpDiscoveryRpcError, discoverAcpModels, DISCOVERY_CLIENT_NAME, type AcpDiscoveryOptions } from "./custom-model-catalog.ts";
import { offeredModels } from "./config-options.ts";

const AUTO = "auto";
const MODELS: ModelCatalog = { default: AUTO, options: [{ id: AUTO, label: "Auto" }] };
const SPAWN_ARGS = ["--acp", "--stdio"];
const SIGN_IN = "copilot login";
const LOGIN_NOTE = `GitHub Copilot is not signed in. Run ${SIGN_IN} in a terminal, then check again.`;
/** Precedence order Copilot CLI reads its token from (`copilot login --help`, 1.0.103); each beats the stored login. */
const TOKEN_ENV = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;
const SIGNED_IN_FOR_MS = 5 * 60_000;
const SIGNED_OUT_FOR_MS = 60_000;
/** A probe that failed without the agent's word on the login (timeout, crash, wrong binary) proves nothing. */
const UNPROVEN_FOR_MS = 15_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** "Claude Haiku 4.5 · 0.33x": the multiplier is what a prompt costs in premium requests. */
export function copilotModelLabel(model: { id: string; label: string }, sessionNew: unknown): string {
  const configOptions = record(sessionNew)?.configOptions;
  const option = Array.isArray(configOptions)
    ? configOptions.map(record).find((entry) => entry?.type === "select" && (entry.id === "model" || entry.category === "model"))
    : undefined;
  const values = Array.isArray(option?.options) ? option.options.map(record) : [];
  const usage = record(values.find((value) => value?.value === model.id)?._meta)?.copilotUsage;
  return typeof usage === "string" && /^\d+(?:\.\d+)?x$/.test(usage) ? `${model.label} · ${usage}` : model.label;
}

/** Copilot CLI 1.0.103 keeps every ACP session, even an empty one closed with session/close, under
 * `<COPILOT_HOME>/session-state/<id>`, where it would sit in the person's `copilot --resume` list. Only a
 * folder whose workspace.yaml names this discovery's own temporary cwd and client is removed. */
export async function forgetCopilotDiscoverySession({ sessionId, cwd, env }: { sessionId: string; cwd: string; env: Record<string, string | undefined> }): Promise<void> {
  if (!/^[\w-]{1,128}$/.test(sessionId)) return;
  const home = env.COPILOT_HOME || join((process.platform === "win32" ? env.USERPROFILE : env.HOME) || homedir(), ".copilot");
  const folder = join(home, "session-state", sessionId);
  let workspace: string;
  try { workspace = await readFile(join(folder, "workspace.yaml"), "utf8"); } catch { return; }
  const field = (name: string) => new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(workspace)?.[1];
  if (field("cwd") !== cwd || field("client_name") !== DISCOVERY_CLIENT_NAME) return;
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const DISCOVERY: AcpDiscoveryOptions = { default: AUTO, label: copilotModelLabel, forgetSession: forgetCopilotDiscoverySession };

/** COPILOT_HOME holds the CLI's account state and GH_HOST picks the GitHub it signs in to. */
const signInKey = (env: Record<string, string | undefined>, cli: string) => [cli, env.COPILOT_HOME ?? "", env.GH_HOST ?? ""].join("\0");
const signIns = new Map<string, { signedIn: Promise<boolean>; until: number }>();

interface SignInAnswer { signedIn: boolean; forMs: number }

/** Shares one probe between concurrent callers, then keeps its answer for as long as it holds. */
function rememberSignIn(key: string, answer: Promise<SignInAnswer>): Promise<boolean> {
  const signedIn = answer.then((value) => value.signedIn);
  signIns.set(key, { signedIn, until: Number.POSITIVE_INFINITY });
  void answer.then(({ forMs }) => {
    if (signIns.get(key)?.signedIn === signedIn) signIns.set(key, { signedIn, until: Date.now() + forMs });
  });
  return signedIn;
}

/** Only the refusal a turn would also report as a missing login proves one. Any other failure leaves the
 * engine offered, so the turn reports the real error, but is asked again soon. */
const signedInAfter = (discovery: Promise<unknown>): Promise<SignInAnswer> => discovery.then(
  () => ({ signedIn: true, forMs: SIGNED_IN_FOR_MS }),
  (error) => error instanceof AcpDiscoveryRpcError
    && classifyCopilotError({ code: error.code, message: error.rpcMessage }) === "invalid_credentials"
    ? { signedIn: false, forMs: SIGNED_OUT_FOR_MS }
    : { signedIn: true, forMs: UNPROVEN_FOR_MS });

/** A refresh also answers the sign-in question, so the snapshot after it starts nothing. */
export function resolveCopilotModels(env: Record<string, string | undefined>, config: Pick<AcpConfig, "cli">): Promise<ModelCatalog> {
  const catalog = discoverAcpModels(env, config.cli, SPAWN_ARGS, DISCOVERY);
  void rememberSignIn(signInKey(env, config.cli), signedInAfter(catalog));
  return catalog;
}

/** A token in the environment signs in by itself; otherwise the login sits in the OS credential store, which
 * only the CLI reads, so an empty session/new (no prompt, no premium request) answers. */
export function copilotSignedIn(env: Record<string, string | undefined>, config: Pick<AcpConfig, "cli">): Promise<boolean> {
  if (TOKEN_ENV.some((name) => env[name]?.trim())) return Promise.resolve(true);
  const key = signInKey(env, config.cli);
  const cached = signIns.get(key);
  if (cached && cached.until > Date.now()) return cached.signedIn;
  return rememberSignIn(key, signedInAfter(discoverAcpModels(env, config.cli, SPAWN_ARGS, { ...DISCOVERY, variants: false })));
}

/** -32000 is ACP's `auth_required`, but some agents reuse it for other failures; the text must agree. */
export function classifyCopilotError(error: unknown): ProviderErrorCode | undefined {
  const value = record(error);
  const text = `${typeof value?.message === "string" ? value.message : ""}`.toLowerCase();
  return value?.code === -32000 && /auth|log(?:ged)? ?in|sign(?:ed)? ?in|token|credential/.test(text) ? "invalid_credentials" : undefined;
}

export function describeCopilotAccountError(code: AccountErrorCode): string {
  return code === "invalid_credentials" ? LOGIN_NOTE
    : "GitHub Copilot refused this request for the signed-in account. Check its Copilot plan and premium request allowance, then try again.";
}

/** Names compare case-insensitively because Windows environments do. */
function deleteEnv(env: Record<string, string | undefined>, name: string): void {
  for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key];
}

const SUPPORT: AcpSupport = {
  driverKind: "copilotAgent",
  displayName: "GitHub Copilot",
  models: MODELS,
  defaultCli: "copilot",
  nativeSource: "copilot.acp",
  images: true,
  loginNote: LOGIN_NOTE,
  install: {
    command: { darwin: "npm install -g @github/copilot", linux: "npm install -g @github/copilot", win32: "npm install -g @github/copilot" },
    needsNode: true,
    docsUrl: "https://docs.github.com/en/copilot/reference/acp-server",
    signInCommand: SIGN_IN,
  },
  spawnArgs: () => SPAWN_ARGS,
  transformEnv(env, _config, _instanceId, instanceEnvironment) {
    // COPILOT_ALLOW_ALL would approve every tool without asking the broker.
    deleteEnv(env, "COPILOT_ALLOW_ALL");
    // A general GitHub token on the server would outrank the Copilot login; only one set on this engine counts.
    const own = new Set(Object.keys(instanceEnvironment).map((key) => key.toUpperCase()));
    for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) if (!own.has(name)) deleteEnv(env, name);
  },
  resolveModels: (env, config) => resolveCopilotModels(env, config),
  // Every fleet has this instance, and any `copilot` on PATH (VS Code's shim included) would otherwise be started
  // at launch: the catalog comes from the startup cache and refreshes when the engine is picked.
  resolveModelsOnCreate: false,
  selectModel: { configId: "model" },
  modelVariants: true,
  fallbackModel: (sessionConfig, catalogDefault) => {
    const offered = offeredModels(sessionConfig, "model");
    if (offered.includes(catalogDefault)) return catalogDefault;
    return offered.includes(AUTO) ? AUTO : null;
  },
  restartOnMcpChange: true,
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: (env, config) => copilotSignedIn(env, config),
  classifyError: classifyCopilotError,
  describeAccountError: describeCopilotAccountError,
  buildPromptText: (turn) => (turn.system ? `${turn.system}\n\n${turn.text}` : turn.text),
};

export const CopilotAgentDriver = createAcpDriver(SUPPORT);
