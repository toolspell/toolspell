// Author trust for issues and PRs. Write access and bots are trusted; everyone else is vouched,
// denounced, or unvouched by .github/VOUCHED.td on the default branch, so a PR cannot vouch for
// itself. vouch.yml labels authors with it and closes what denounced authors open; pr-limits.cjs
// uses it to decide who the limits apply to.
// Adapted from T3 Code's pr-vouch.yml and issue-vouch.yml (MIT). T3 Code runs the
// mitchellh/vouch action for PRs and its own parser for issues; one parser here keeps both agreeing.
const VOUCHED_PATH = ".github/VOUCHED.td";
const LABELS = {
  trusted: "vouch:trusted",
  unvouched: "vouch:unvouched",
  denounced: "vouch:denounced",
};
const MANAGED = new Set(Object.values(LABELS));
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);
// `github:login`, or `-github:login reason` to denounce.
const ENTRY = /^(-?)github:([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})(?:\s.*)?$/;

// Fails closed: a typo must not silently drop a denouncement, and a login listed both ways has no
// right answer.
function parseVouchList(text) {
  const vouched = new Set();
  const denounced = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = ENTRY.exec(line);
    if (!match) throw new Error(`${VOUCHED_PATH}: malformed entry "${line}"`);
    const login = match[2].toLowerCase();
    const [listed, other] = match[1] ? [denounced, vouched] : [vouched, denounced];
    if (other.has(login))
      throw new Error(`${VOUCHED_PATH}: ${login} is both vouched and denounced`);
    listed.add(login);
  }
  return { vouched, denounced };
}

// Without a ref the contents API reads the default branch.
async function loadVouchList(github, context) {
  const { data } = await github.rest.repos.getContent({ ...context.repo, path: VOUCHED_PATH });
  return parseVouchList(Buffer.from(data.content, "base64").toString("utf8"));
}

/** One of "bot", "collaborator", "denounced", "vouched", "unvouched", in that precedence. */
async function trustOf({ github, context, list, user }) {
  if (user.type === "Bot" || user.login.endsWith("[bot]")) return "bot";
  let permission = "none";
  try {
    ({
      data: { permission },
    } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...context.repo,
      username: user.login,
    }));
  } catch (error) {
    // A deleted account reads as nobody; any other failure stops the run before it labels.
    if (error.status !== 404) throw error;
  }
  if (WRITE_PERMISSIONS.has(permission)) return "collaborator";
  const login = user.login.toLowerCase();
  if (list.denounced.has(login)) return "denounced";
  if (list.vouched.has(login)) return "vouched";
  return "unvouched";
}

/** PRs always carry one vouch label. Issues are labeled only when trusted or denounced. */
function labelFor(trust, isPullRequest) {
  if (trust === "denounced") return LABELS.denounced;
  if (trust === "unvouched") return isPullRequest ? LABELS.unvouched : undefined;
  return LABELS.trusted;
}

function guideLink(context, anchor) {
  return `https://github.com/${context.repo.owner}/${context.repo.repo}/blob/main/CONTRIBUTING.md#${anchor}`;
}

async function syncLabel(github, context, item, next) {
  const current = item.labels.map((label) => label.name).filter((name) => MANAGED.has(name));
  for (const name of current) {
    if (name === next) continue;
    try {
      await github.rest.issues.removeLabel({ ...context.repo, issue_number: item.number, name });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (next && !current.includes(next)) {
    await github.rest.issues.addLabels({
      ...context.repo,
      issue_number: item.number,
      labels: [next],
    });
  }
}

// Only a newly opened item closes. One filed before its author was denounced may already be in
// progress, so sweeps leave those to maintainers, and someone else reopening it keeps it open.
function closesOnOpen(context, item) {
  if (!["issues", "pull_request_target"].includes(context.eventName)) return false;
  const { action, sender } = context.payload;
  if (action === "opened") return true;
  return action === "reopened" && sender.login.toLowerCase() === item.user.login.toLowerCase();
}

async function closeDenounced(github, context, item) {
  const isPullRequest = Boolean(item.pull_request) || context.eventName === "pull_request_target";
  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: item.number,
    body: `Closing: ${item.user.login} is banned from contributing here, so this ${isPullRequest ? "PR" : "issue"} will not be ${isPullRequest ? "reviewed" : "triaged"}. See [bans](${guideLink(context, "bans")}).`,
  });
  await github.rest.issues.update({
    ...context.repo,
    issue_number: item.number,
    state: "closed",
    ...(isPullRequest ? {} : { state_reason: "not_planned" }),
  });
}

async function targets(github, context) {
  const { payload } = context;
  if (context.eventName === "pull_request_target") return [payload.pull_request];
  if (context.eventName === "issues" || context.eventName === "issue_comment") {
    return [payload.issue];
  }
  return github.paginate(github.rest.issues.listForRepo, {
    ...context.repo,
    state: "open",
    per_page: 100,
  });
}

async function run({ github, context, core }) {
  const list = await loadVouchList(github, context);
  const trustByLogin = new Map();
  for (const item of await targets(github, context)) {
    const isPullRequest = Boolean(item.pull_request) || context.eventName === "pull_request_target";
    const login = item.user.login.toLowerCase();
    if (!trustByLogin.has(login)) {
      trustByLogin.set(login, await trustOf({ github, context, list, user: item.user }));
    }
    const trust = trustByLogin.get(login);
    await syncLabel(github, context, item, labelFor(trust, isPullRequest));
    core.info(`#${item.number} (${item.user.login}): ${trust}`);
    if (trust === "denounced" && closesOnOpen(context, item)) {
      await closeDenounced(github, context, item);
      core.info(`#${item.number}: closed, ${item.user.login} is denounced.`);
    }
  }
}

module.exports = { LABELS, closesOnOpen, labelFor, loadVouchList, parseVouchList, run, trustOf };
