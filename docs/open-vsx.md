# Publishing XBridge to Open VSX

Open VSX is a separate registry from the Visual Studio Marketplace. XBridge's extension ID is `chaiwithcode.xbridge` in both registries, but the Marketplace publisher account and token do not authorize Open VSX publishing.

## One-time publisher setup

1. Follow the [Open VSX publisher guide](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions): sign in to [open-vsx.org](https://open-vsx.org/) with the GitHub account that owns XBridge, connect the matching Eclipse account, and accept the Open VSX Publisher Agreement.
2. Generate an Open VSX access token in your Open VSX account settings. Add it to this repository's GitHub Actions secrets as `OVSX_PAT`. Do not put the token in the repository, a command argument, or an issue.
3. Merge the `Publish Open VSX` workflow into the repository's default branch. In GitHub Actions, run **Publish Open VSX** with an existing GitHub release tag such as `v1.4.2`. The workflow downloads that release's VSIX, verifies its publisher, name, and version, creates the `chaiwithcode` namespace if necessary, and uploads the exact release artifact. Re-running it skips a duplicate version.
4. Inspect the [XBridge Open VSX listing](https://open-vsx.org/extension/chaiwithcode/xbridge), including the icon, description, README, license, and version. If you want the verified-publisher shield, [claim ownership of the namespace](https://github.com/eclipse-openvsx/openvsx/wiki/Namespace-Access); creating the namespace alone does not grant that status.

The existing `v1.4.2` GitHub release contains `xbridge-1.4.2.vsix`. Its SHA-256 is `aa68331c49396d0014bae908e4348b0995f995b1d9c67e159d5a5f03add700cc`. Use that release artifact for a first `v1.4.2` submission. A new package built from `develop` includes README screenshots that are not yet on the default branch, so those links would remain unavailable until a later release merges the assets into `main`.

## Future releases

The tag-triggered [release workflow](../.github/workflows/release.yml) builds one VSIX for the GitHub release, the Visual Studio Marketplace, and Open VSX. When `OVSX_PAT` is configured, its Open VSX step publishes the same VSIX after a `v*` tag is pushed. Each registry accepts a given extension version only once; use a new version for updated contents.

The [Open VSX CLI](https://github.com/eclipse-openvsx/openvsx/blob/main/cli/README.md) also supports publishing an already packaged VSIX locally with `OVSX_PAT` set in the environment:

```sh
npx --yes ovsx@1.1.1 publish path/to/xbridge-version.vsix --skip-duplicate
```

The manual GitHub workflow is preferred for a release because it uses the exact VSIX already attached to that release. After publication, verify the version through the listing or the [registry API](https://open-vsx.org/api/chaiwithcode/xbridge).
