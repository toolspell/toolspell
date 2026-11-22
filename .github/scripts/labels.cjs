// Creates and updates the repository's labels from .github/labels.json, the one place they are
// defined. It never deletes a label, so GitHub's defaults and hand-made labels survive.
// Adapted from T3 Code's label sync steps in pr-vouch.yml, pr-size.yml and issue-labels.yml (MIT).
const fs = require("node:fs");
const path = require("node:path");

const LABELS_PATH = path.join(__dirname, "..", "labels.json");

function readLabels() {
  return JSON.parse(fs.readFileSync(LABELS_PATH, "utf8"));
}

async function sync({ github, context, core }) {
  for (const label of readLabels()) {
    let existing;
    try {
      ({ data: existing } = await github.rest.issues.getLabel({
        ...context.repo,
        name: label.name,
      }));
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (!existing) {
      await github.rest.issues.createLabel({ ...context.repo, ...label });
      core.info(`created ${label.name}`);
    } else if (
      existing.color !== label.color ||
      (existing.description ?? "") !== label.description
    ) {
      await github.rest.issues.updateLabel({ ...context.repo, ...label });
      core.info(`updated ${label.name}`);
    }
  }
}

module.exports = { readLabels, sync };
