/**
 * semantic-release configuration, run by .github/workflows/release.yml on pushes to main.
 *
 * The app is private and deployed as a container image, so nothing is published to npm: a release
 * is a git tag, a GitHub release and the image tagged by release.yml. The committed package.json
 * version is not used; the version comes from the latest git tag.
 */
module.exports = {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    // Reports the released version as a release.yml step output; runs that release nothing set
    // nothing. Commands are lodash templates: '${...}' is a semantic-release value.
    [
      "@semantic-release/exec",
      {
        successCmd:
          'if [ -n "$GITHUB_OUTPUT" ]; then echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"; fi',
      },
    ],
    "@semantic-release/github",
  ],
};
