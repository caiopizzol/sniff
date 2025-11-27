/* eslint-env node */

const branch = process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_BRANCH;

const config = {
  branches: [
    {
      name: 'stable',
      channel: 'latest', // Only stable gets @latest
    },
    {
      name: 'main',
      prerelease: 'next',
      channel: 'next',
    },
  ],
  tagFormat: 'core-v${version}',
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    // Use pnpm plugin to properly handle workspace:* protocol
    [
      '@anolilab/semantic-release-pnpm',
      {
        publishBranch: branch,
        pkgRoot: '.',
      },
    ],
  ],
};

// Only add changelog and git plugins for non-prerelease branches
const isPrerelease = config.branches.some(
  (b) => typeof b === 'object' && b.name === branch && b.prerelease,
);

if (!isPrerelease) {
  // Git plugin comes AFTER npm
  config.plugins.push([
    '@semantic-release/git',
    {
      assets: ['package.json'],
      message:
        'chore(release): @sniff-dev/core ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    },
  ]);
}

// GitHub plugin comes last
config.plugins.push('@semantic-release/github');

module.exports = config;
