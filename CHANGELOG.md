# Changelog

## [0.3.2](https://github.com/corekraft/kore/compare/v0.3.1...v0.3.2) (2026-11-09)


### Documentation

* add platform vision board ([#49](https://github.com/corekraft/kore/issues/49)) ([0ed2575](https://github.com/corekraft/kore/commit/0ed25753a9b78b004d4506ffc19a1480783b98bb))
* record fresh-profile, idempotency, and mirror evidence for step 7 ([#55](https://github.com/corekraft/kore/issues/55)) ([2f4af0c](https://github.com/corekraft/kore/commit/2f4af0c368576d6e742871505624746b364e73c6))

## [0.3.1](https://github.com/corekraft/kore/compare/v0.3.0...v0.3.1) (2026-11-09)


### Bug fixes

* **release:** link each mirror package to the repository before copying into it ([#52](https://github.com/corekraft/kore/issues/52)) ([5dd83df](https://github.com/corekraft/kore/commit/5dd83df06639f69f373c0b93e6f7859e025a3de4))
* skip helm upgrades of unchanged configuration and app releases ([#53](https://github.com/corekraft/kore/issues/53)) ([3d84606](https://github.com/corekraft/kore/commit/3d8460646a0676ce0ec595b9520f61b3f98b146c))

## [0.3.0](https://github.com/corekraft/kore/compare/v0.2.0...v0.3.0) (2026-11-08)


### Features

* **catalog:** require webhook readiness for admission controllers ([47788e0](https://github.com/corekraft/kore/commit/47788e0c3fc46f33067f0628344842bce52566fe))
* check every installed crd has one catalog owner ([78bb7c0](https://github.com/corekraft/kore/commit/78bb7c00d9bde703b3981c8b13481f84ba027810))
* check every installed crd has one catalog owner ([bb13a02](https://github.com/corekraft/kore/commit/bb13a0255c1daa6ff884287018bc2c77a2b9fb40))
* check rollout feasibility and smoke-run kore chart containers ([#51](https://github.com/corekraft/kore/issues/51)) ([112df2f](https://github.com/corekraft/kore/commit/112df2f211db7515b8561cb1b0532616954c9f7b))
* equalize spawned herdr session panes after each split or close ([bb58a7b](https://github.com/corekraft/kore/commit/bb58a7baa739c68e1c8f545c6a1f9b3e710db786))
* equalize spawned herdr session panes after each split or close ([e6b80c3](https://github.com/corekraft/kore/commit/e6b80c3c99d9290b885eabb0445d1dd499cd12ef))
* fail fast on fatal pod states during component install and readiness ([#50](https://github.com/corekraft/kore/issues/50)) ([97292c5](https://github.com/corekraft/kore/commit/97292c5f1579ac5c11ce9a4efe163db528d44340))
* pin every platform image by digest and approve it for mirroring ([#47](https://github.com/corekraft/kore/issues/47)) ([25dcf6b](https://github.com/corekraft/kore/commit/25dcf6b90478b6192fa23f93de99b0a6fa49bcc8))
* **platform:** check webhook configuration readiness ([c2dadcf](https://github.com/corekraft/kore/commit/c2dadcfc98237b19921e1b5277318add68414306))
* **platform:** check webhook configuration readiness ([0a87dfc](https://github.com/corekraft/kore/commit/0a87dfc0fecf795bdcc68bfdff30fc2d728a7cd3))
* **registry:** authenticate and authorize the oci registry behind a proxy sidecar ([#46](https://github.com/corekraft/kore/issues/46)) ([6c2a459](https://github.com/corekraft/kore/commit/6c2a459bf448074d8546a8bfae122045e19503f6))
* **release:** mirror approved platform images with signed digests and a lock ([818b7d5](https://github.com/corekraft/kore/commit/818b7d514b892d71f820dd0e6a4a020a8b2e5418))
* **release:** mirror approved platform images with signed digests and a lock ([df41713](https://github.com/corekraft/kore/commit/df4171381148b0c74e352a3330d31d821a91b628))


### Bug fixes

* silence herdr resize output in the equalize script ([5019158](https://github.com/corekraft/kore/commit/5019158b2fe81aa84ff10de5d3f751b346b457ba))
* trust the v0.2.0 release subject ([7989246](https://github.com/corekraft/kore/commit/79892462eb020ca1828adadbb4ca82be6cf3fc13))
* trust the v0.2.0 release subject ([1f7864d](https://github.com/corekraft/kore/commit/1f7864d7a8a936f665e1a9a9a6d57c83c824e7bf))
* write the equalize script in node so it runs where zsh is absent ([7524c91](https://github.com/corekraft/kore/commit/7524c911ad3a86d09350526fff35570b03e9c19d))


### Documentation

* **adr:** refine 0016 with webhook readiness ([abf8c8a](https://github.com/corekraft/kore/commit/abf8c8a3d88373ddfb8fbb24a97a434f8fe41a5d))
* make it just works a principle and a review check ([#48](https://github.com/corekraft/kore/issues/48)) ([154d7f3](https://github.com/corekraft/kore/commit/154d7f37e8d2e3d5df07e1a28875435d5af7e7c0))
* record step 7 progress from crd ownership, webhook readiness, and mirror work ([#45](https://github.com/corekraft/kore/issues/45)) ([383ee13](https://github.com/corekraft/kore/commit/383ee1397f79ca5b59eb5de9646b3a9fcc651028))

## [0.2.0](https://github.com/corekraft/kore/compare/v0.1.1...v0.2.0) (2026-11-08)


### Features

* enforce image admission in the local environment ([9443d33](https://github.com/corekraft/kore/commit/9443d339a4bff22f8935fb1071e7c87f8e0ef815))
* enforce image admission in the local environment ([bc67002](https://github.com/corekraft/kore/commit/bc6700225e4c230183af2d136103f013cf4fe055))
* enroll application namespaces in image admission in warn mode ([a1020a6](https://github.com/corekraft/kore/commit/a1020a6534828082c76fc2b084019111ec1f2bff))
* enroll application namespaces in image admission in warn mode ([e9fbe3d](https://github.com/corekraft/kore/commit/e9fbe3db8e7b7fba1974c2305626974503fc2de7))


### Bug fixes

* bind reference dashboard panels to their signal's datasource ([c4c1140](https://github.com/corekraft/kore/commit/c4c1140825d397208d5e23737b29ead44e51cc88))
* bind reference dashboard panels to their signal's datasource ([72d21f7](https://github.com/corekraft/kore/commit/72d21f74dd8742f9f5fed79d27ed6fee75368f58))
* repair grafana tempo port and reference dashboard metrics ([72df634](https://github.com/corekraft/kore/commit/72df6346ec5318695481b2d88eedcdc615550bd7))
* repair grafana tempo port and reference dashboard metrics ([7c577ae](https://github.com/corekraft/kore/commit/7c577ae85e7766b9b628bd6e7ff28be4a80f9cf8))
* sign local images in legacy format and derive no-match policy from trust mode ([140fde9](https://github.com/corekraft/kore/commit/140fde9f318988c443f0dba4f40075c60dd6ed31))
* trust the v0.1.1 release subject, the first published image ([ff3497e](https://github.com/corekraft/kore/commit/ff3497e75568a750991e87153f47ece21349edb6))
* trust the v0.1.1 release subject, the first published image ([4694bb2](https://github.com/corekraft/kore/commit/4694bb262fc4bd703b09cd2d826454ac6a704b0d))


### Documentation

* point the step 7 handoff at publishing the release image ([c42d45d](https://github.com/corekraft/kore/commit/c42d45d5a4217725b70342ba5c206c3e2545aed8))
* point the step 7 handoff at publishing the release image ([c09f371](https://github.com/corekraft/kore/commit/c09f371881a01ab07e697872cc9376bfe511ebe3))
* record live image admission enforce-mode evidence ([e50afe6](https://github.com/corekraft/kore/commit/e50afe6027ceb1576d238782f53c3f0f611b06db))
* record live image admission warn-mode evidence ([95c5d63](https://github.com/corekraft/kore/commit/95c5d633b88273c2c5a00b394111010bebf28c17))

## [0.1.1](https://github.com/corekraft/kore/compare/v0.1.0...v0.1.1) (2026-11-08)


### Bug fixes

* label the reference image with its source repository ([7a67f66](https://github.com/corekraft/kore/commit/7a67f66c567955449d981c02efab7c575d7c08ac))
* label the reference image with its source repository ([67ea0f0](https://github.com/corekraft/kore/commit/67ea0f0933fe411f60bfb0f15959c19325dd32b1))

## 0.1.0 (2026-11-08)


### Features

* add a digest-pinned seed manifest and reject unrecorded seeds ([f8c4603](https://github.com/corekraft/kore/commit/f8c4603914de6a2a4a5d3fa6f772900e82eceae7))
* add a digest-pinned seed manifest and reject unrecorded seeds ([43ffc43](https://github.com/corekraft/kore/commit/43ffc43107e217d3a7fe93c3f0d5b5f0a46c8338))
* add a validated image trust authority and render clusterimagepolicy from it ([6c1fa73](https://github.com/corekraft/kore/commit/6c1fa73299d090475005cc2416321af70fd8604c))
* add agent primitives: operations journal, append-only guard, turn deltas ([792ac05](https://github.com/corekraft/kore/commit/792ac0512f038f7d4039a49665b9ad0752bdf290))
* add authorizers and add opa to istio ([06ac949](https://github.com/corekraft/kore/commit/06ac949df81f9c8e38fb241b1683f616d242af17))
* add context hygiene to the agent harness ([c8d7666](https://github.com/corekraft/kore/commit/c8d7666377e654a58950a3eaee42ab70ea204f14))
* add deterministic retrospective scan with prune and promote signals ([eafd408](https://github.com/corekraft/kore/commit/eafd4080f73703cbd47660d2d1208b26d35ed3e5))
* add encrypted local export and restore of retained data ([081aaf0](https://github.com/corekraft/kore/commit/081aaf0d3d7368d4af3c29f0425969e1c5270610))
* add kb-check for links, index, frontmatter, and docs headers ([3d68f06](https://github.com/corekraft/kore/commit/3d68f0607f165ec91d13621bd181dc2622feaef5))
* add keyless signing release workflow ([5e044ac](https://github.com/corekraft/kore/commit/5e044acf94691d72180ab912b9ed39286e475fd8))
* add local toolset ([26b5b40](https://github.com/corekraft/kore/commit/26b5b40304091f69d94ad2e6c4e37bab12683815))
* add lock ([2ff34f0](https://github.com/corekraft/kore/commit/2ff34f0af212b87815fa22c51b4fb1bc0fc0aa5e))
* add mesh, retention, rbac, and secret gatekeeper policies in audit mode ([5359ee2](https://github.com/corekraft/kore/commit/5359ee2f76708901218cd7fe548ff7511f9fab69))
* add operations journal for mutating commands ([44eae1e](https://github.com/corekraft/kore/commit/44eae1e3a094953bea9542503e5ec56f2121b958))
* add pinned security and quality scans ([69303f3](https://github.com/corekraft/kore/commit/69303f36f9c6169beb63adca61b2a1761da0131d))
* add pinned security and quality scans ([ec7d3bc](https://github.com/corekraft/kore/commit/ec7d3bce91a5edf294a26f655af1b4b144b74a55))
* add sigstore policy controller as a bootstrap component ([3773e3c](https://github.com/corekraft/kore/commit/3773e3c0fabb1f4f3ba5e89dc11bb5512ba2f32e))
* add zero trust plan ([b692d0b](https://github.com/corekraft/kore/commit/b692d0bfdffbdb09090b6dce44b972bcdc16d31a))
* authenticate reference app database access and add migration job ([0348796](https://github.com/corekraft/kore/commit/03487961959f157fe7f50a5179ddd09a608f9fb8))
* brief every active plan with upcoming steps and link domains to docs ([098a344](https://github.com/corekraft/kore/commit/098a3440fdb83925618db5449d82b3688b4a7e4d))
* close agent harness exit criteria and apply first retrospective ([bdf1e87](https://github.com/corekraft/kore/commit/bdf1e87ab51370247b40b80cb551ce89ce210730))
* close offline open items in the implementation plan ([5209f31](https://github.com/corekraft/kore/commit/5209f3162d2b03ad3f5c4a914c312602af163191))
* close second batch of offline plan items ([0eec244](https://github.com/corekraft/kore/commit/0eec244a8f0e741a911da2fb0a7608b1587596ba))
* deploy the tested opa bundle with masked decision logs ([a2ffc3a](https://github.com/corekraft/kore/commit/a2ffc3a622051dca5ae0b6a396b2c41ee4e6ce8f))
* derive every registry consumer from one per-environment registry.address ([75e6f9b](https://github.com/corekraft/kore/commit/75e6f9b49f7866ed5ad9f11159129aa3ef97c5d6))
* derive every registry consumer from one per-environment registry.address ([b661de2](https://github.com/corekraft/kore/commit/b661de2f34d0857a08a893e283f462c4fdaf1613))
* encrypt local sops secrets to the local age recipient ([fb514cb](https://github.com/corekraft/kore/commit/fb514cb96ce9352927f9dfa2d6e4bb9a4889aede))
* enroll application namespaces in the ambient mesh from app up ([9952822](https://github.com/corekraft/kore/commit/995282280669afac224931ee9be8c6b520b7ec76))
* evaluate readiness in status and wait on full gateway and trust conditions ([952d3b5](https://github.com/corekraft/kore/commit/952d3b5032a91c1408657041562fa42fee820a16))
* force helm conflicts per component for self-managing controllers ([6d7cbd3](https://github.com/corekraft/kore/commit/6d7cbd3214bdac7c22963e29803bf90ab03424dd))
* grafana loki ([419ece9](https://github.com/corekraft/kore/commit/419ece977564638a7ca8c13bae5f7a3437b5b40a))
* initial run ([f39afd9](https://github.com/corekraft/kore/commit/f39afd9c87b40b4e347f6cbefe85990057e07b97))
* initialize repo with a plan ([81da1ba](https://github.com/corekraft/kore/commit/81da1baa22bb2796229132a001fa5d157312fe81))
* install crossplane functions as their own release with readiness checks ([56cc074](https://github.com/corekraft/kore/commit/56cc074ac7a1142b92066cabe696d10147a322be))
* make plans, decisions, and skills reachable for agents ([1fd06ee](https://github.com/corekraft/kore/commit/1fd06ee95b6e2847217ba0568edd37ab15797c2d))
* make the harness check and maintain itself ([2588a74](https://github.com/corekraft/kore/commit/2588a748d87cea3f62f1a1098ac9b87b983542f6))
* modify platform ([6662c8d](https://github.com/corekraft/kore/commit/6662c8d94a81e0021d5a2db469541e29cfed0c87))
* pick the model per role when spawning herdr sessions ([a3c697a](https://github.com/corekraft/kore/commit/a3c697ad1b82f533cd18193944680a46dc1b124d))
* pick the model per role when spawning herdr sessions ([670c595](https://github.com/corekraft/kore/commit/670c595ce1c9fc6f073b669fd603299f1bbfb95a))
* pin registry and policy controller images by digest ([f2e5171](https://github.com/corekraft/kore/commit/f2e5171bc6cbff2aaf16bb3a47f30c34fc26fd60))
* record eval history and warn on stale documents ([502c488](https://github.com/corekraft/kore/commit/502c488e4b70455ecfb277bfef8fe9d32a09597d))
* redact secret values from rendered platform output ([9309724](https://github.com/corekraft/kore/commit/930972423f612cbf4f82a8ade37971c740af861c))
* reduce operator load in the agent harness ([cd4f741](https://github.com/corekraft/kore/commit/cd4f741572092962f1222f5757d7e31a4afbf159))
* reduce operator load in the agent harness ([70aeb81](https://github.com/corekraft/kore/commit/70aeb816b6a61a788e6c65d24af6214bd6976b95))
* render application charts with common values in portability validation ([f04a84c](https://github.com/corekraft/kore/commit/f04a84c5e1e83b0f6da2eb2b07ec499857d9c996))
* reorganize packages into domains ([f9e6742](https://github.com/corekraft/kore/commit/f9e674211a75e1d3a5734d1d61c3c51924b589f0))
* report changes between turns and journal state in the session brief ([ab9296b](https://github.com/corekraft/kore/commit/ab9296ba934d4524d7161b255c1a9286f0b3fb6f))
* require a readiness check on every catalog component ([6027839](https://github.com/corekraft/kore/commit/6027839e1c5ee36b8f92837b6008fbc07486675b))
* rewire the local registry address from a declared service range ([db8ac43](https://github.com/corekraft/kore/commit/db8ac436ec1be9e4e726265dc21f50cbb1bcaec5))
* running infra ([4f76b27](https://github.com/corekraft/kore/commit/4f76b27f573d6f2ca0bc055b8a36ed63734a16d4))
* scope postgresql api rbac, project database status, label retained pvcs ([0c91526](https://github.com/corekraft/kore/commit/0c91526c2d612d587863a0f174f913d40571993e))
* self-healing registry address and a live-proven export and restore ([f0acf5b](https://github.com/corekraft/kore/commit/f0acf5b9f1c4ee84c6c9df6f0c1fe8e11d3d0fd4))
* sign release images by digest with keyless cosign on version tags ([13604b3](https://github.com/corekraft/kore/commit/13604b34067f875fae94d62d0f438a778191788a))
* split plan into two ([4555d03](https://github.com/corekraft/kore/commit/4555d0346f2eec92bf347b64ce87c5f8828cb1f3))
* tag releases automatically with release-please ([e459ff3](https://github.com/corekraft/kore/commit/e459ff37afba10a1f9c1a7330339205988e14454))
* tag releases with release-please and sign at the tag ([85ba8b6](https://github.com/corekraft/kore/commit/85ba8b615fd0e0c89a19e9543291e1fdd81c76cb))
* update tools to latest versions ([ff8b4f5](https://github.com/corekraft/kore/commit/ff8b4f54b2b500f628582f2e0f12f30b59e06312))
* upgrade observability charts to latest stable releases ([e7409e9](https://github.com/corekraft/kore/commit/e7409e9daf0d5d62f56433f0304f2381df7c908d))
* upgrade platform controllers to latest stable releases ([942cdd2](https://github.com/corekraft/kore/commit/942cdd2c8861b7dc9bf3b4d18fa42e65dd3f75f9))
* upgrade registry, opa-envoy, and reference base images ([f8d1fae](https://github.com/corekraft/kore/commit/f8d1fae79cadc40b85add4cbcbee73bc24f980be))
* warn on hand edits to append-only history and journals ([d890555](https://github.com/corekraft/kore/commit/d890555322178cc1b05d6cd8627d7dddb68a03cc))
* wire collector metrics, rules, dashboards, node agent, and istio tracing ([8ee8dab](https://github.com/corekraft/kore/commit/8ee8dab167c053b9f4ba4bc45e0845e024df66cd))


### Bug fixes

* align retro scan boundary, merge corrections, and detail command failures ([e52fa26](https://github.com/corekraft/kore/commit/e52fa26c2e33d82006373250c68f09abfcfe7a8d))
* allow intended secret sources and controller-owned secrets in the secrets audit ([0c452ca](https://github.com/corekraft/kore/commit/0c452cab9a7d2155a44c62dacba2edeaaa8014c4))
* allow policy controller webhook serving certs in secrets audit ([501c6a8](https://github.com/corekraft/kore/commit/501c6a80913b4e4b8a65f6257993cf3586832ddf))
* allow policy controller's own webhook serving certificate in the secrets audit ([c46533a](https://github.com/corekraft/kore/commit/c46533addd416932508cc14c6e826f0824630076))
* always print the retained report for app down --json ([5377eb7](https://github.com/corekraft/kore/commit/5377eb75b7aa2fa76e02f9ad9139e1c4fd252fad))
* check release history after any failed helm upgrade ([d46040c](https://github.com/corekraft/kore/commit/d46040ce8a3da3f80e2ee88d7b6df64b9360d1d0))
* converge the local bootstrap on a fresh profile ([3ace080](https://github.com/corekraft/kore/commit/3ace080ab2589645f34d4233509cfd11d8e22035))
* count a repeated prompt as a correction only with a correction word or a prior failure ([3019dc4](https://github.com/corekraft/kore/commit/3019dc4e7478e8356a8d17bb6b7d93e2013a43e6))
* define real snapshot pruning deps in delta hook ([6469404](https://github.com/corekraft/kore/commit/6469404a1aa9d243459877f087d5ee33f3464507))
* install the postgresql api and opa authorizer after bootstrap ([d28787e](https://github.com/corekraft/kore/commit/d28787e177d0c408b779c1749eb7e7360228e8a5))
* keep cosign.pub out of the cwd and skip mkcert -install when the CA is trusted ([623c39a](https://github.com/corekraft/kore/commit/623c39a466d59179a2e96b4d4f71c39dff28d360))
* keep database pods out of the mesh and limit database env to the api ([8da3927](https://github.com/corekraft/kore/commit/8da3927d8e4a766ce397c685b4866bfa8e94aa57))
* keep docs and the kb-check cli test in step with the refactor ([3778437](https://github.com/corekraft/kore/commit/37784378bdb87c057e265563124d2807a53e5d70))
* keep eval fixtures out of principles-review findings ([9a48f1c](https://github.com/corekraft/kore/commit/9a48f1ccdcaab952a8b337c84fa18a625bd5e3f1))
* keep the local signing key in a cluster secret instead of on disk ([f03a30f](https://github.com/corekraft/kore/commit/f03a30f54d1b1be00ee298f445b03b5c1e8d206e))
* keep the oci-registry claim on kore-standard and never wait on mounted claims during purge ([1a17fa2](https://github.com/corekraft/kore/commit/1a17fa25393f7b8dcc8992612d2fddcda0e9df87))
* label observability claims and apply the 2026-11-08 retrospective ([3c507f6](https://github.com/corekraft/kore/commit/3c507f605a3377fbff9087bddabd4d336abcb3fa))
* label observability claims retention delete ([b9aba72](https://github.com/corekraft/kore/commit/b9aba72c9dd6840713cfd4cd037f6f6b0227f424))
* label the oci-registry claim as retained data and spec the storage classes ([b659faa](https://github.com/corekraft/kore/commit/b659faa765d41dfc616f628392bd374c9a0dc9f3))
* let helm take back controller co-owned fields on upgrade, per component ([bb5fb01](https://github.com/corekraft/kore/commit/bb5fb013782dfefb7d63cb534b867d2b549ee10f))
* make app down idempotent and warn on a failed retained query ([fd07ffc](https://github.com/corekraft/kore/commit/fd07ffc4cba774ee32fc20cd58fc9854b88a704c))
* match failure keywords as whole words and skip Markdown or code lines ([8875392](https://github.com/corekraft/kore/commit/8875392b2406ba3d2823fa7a7a99d20219a4886b))
* pin policy controller images for every environment and narrow trust error handling ([5e4b63b](https://github.com/corekraft/kore/commit/5e4b63b371ac3059e6690cdb32358ff7aa56c7f2))
* point otlp endpoints at the otel-collector service ([80530ee](https://github.com/corekraft/kore/commit/80530eef7f7d44bfd8830426e58be2fad9273079))
* prove observability config readiness by its configmaps ([852bf51](https://github.com/corekraft/kore/commit/852bf51dd7c1a9b93fe714c2f639675be231f2da))
* prove policy releases by the objects they apply ([09b5111](https://github.com/corekraft/kore/commit/09b5111fdb005aabf9f278aa20f029ed56664e5f))
* prune delta snapshots older than two weeks ([b972c94](https://github.com/corekraft/kore/commit/b972c948affe531e27d5b4ceea12912608a95109))
* publish a public-key-only secret for the local image policy ([c8f4f91](https://github.com/corekraft/kore/commit/c8f4f91db8794e121d6a95a842f49e8196f618a4))
* recover environment locks left by dead owners ([15cca00](https://github.com/corekraft/kore/commit/15cca002a3d5240f356a1dfaa169ea4b360a7d32))
* recreate the public schema with postgresql defaults on overwrite restore ([1b368d7](https://github.com/corekraft/kore/commit/1b368d7f6a6041f7284672dc5743392c3681b2e8))
* redact secret-looking key=value arguments in the journal ([faccc6f](https://github.com/corekraft/kore/commit/faccc6f66d0d0023b3ea87a626af2427f3d16995))
* refuse cluster destroy when retained data cannot be queried ([f41975a](https://github.com/corekraft/kore/commit/f41975abfd6c2f219c5e9b0f1eebee77a972c6be))
* registry ([1a83d33](https://github.com/corekraft/kore/commit/1a83d33c69ac274cc699964e0c6aca82a498de95))
* reject unknown actions before taking the lock or journaling ([79df752](https://github.com/corekraft/kore/commit/79df752b6f679a1bf447ec552d6170905832d903))
* require --purge-data to purge retained data on local down ([29f7c23](https://github.com/corekraft/kore/commit/29f7c23998ecf9d46dd82fba330c65dac088396f))
* require only the clusterrole for postgresql rbac readiness ([ff87b42](https://github.com/corekraft/kore/commit/ff87b427dff987c334ff8c8bdca10b305df9e8ad))
* resume a helm release whose first install was interrupted ([07d33f1](https://github.com/corekraft/kore/commit/07d33f18f4c134637efbcc0d442b7a0d2975576b))
* retry only not-yet-there errors while polling readiness ([e99bb0e](https://github.com/corekraft/kore/commit/e99bb0eaea9ea35066b8c296a299a235b8df0aa3))
* skip unreadable journal files in the session brief ([a126c57](https://github.com/corekraft/kore/commit/a126c57e3ac275c9c97bfc9bef0d33daf5261c87))
* start releases at 0.1.0 instead of release-please's 1.0.0 default ([d71c3e5](https://github.com/corekraft/kore/commit/d71c3e59904f25cdf0627e8a3731f659311a884d))
* start releases at 0.1.0 instead of release-please's 1.0.0 default ([e8f504f](https://github.com/corekraft/kore/commit/e8f504f7f62205f5311b8425bf3c71e752c1a15d))
* stop bare-glob flagging special parameters like $? ([d5a86fb](https://github.com/corekraft/kore/commit/d5a86fb456f99bdb473d1e6c30205fd652e99557))
* stop the secrets audit flagging intended source and controller secrets ([5c22c50](https://github.com/corekraft/kore/commit/5c22c507f99c8c01f42f2e78a201463c130ced05))
* summarize command failures by their first error-looking line ([83f49bc](https://github.com/corekraft/kore/commit/83f49bcc090af19b3bca766b0bbf81fd30deb13c))
* surface unreadable seed component values instead of ignoring them ([b634c21](https://github.com/corekraft/kore/commit/b634c21a6404f3f035084de30acfe2d48de7f944))
* upgrade deployed releases whose desired state changed ([b8f57ce](https://github.com/corekraft/kore/commit/b8f57ced85d6c95d1fb2060d0d0d2a9238a723fb))
* upgrade deployed releases whose desired state drifted on resume ([2769568](https://github.com/corekraft/kore/commit/2769568a6f485f7d18c1d9cbf5fa2f66876718d1))
* use renamed collector component names and bound operator resources ([f96c9e5](https://github.com/corekraft/kore/commit/f96c9e5f845693613745ba860279cba1de0d2809))
* wait for a clusterimagepolicy to report ready instead of a rollout ([c781ae0](https://github.com/corekraft/kore/commit/c781ae0ffce394cdd50c65c0cea5db2171a98b14))
* wait on the otel-agent-agent daemonset the chart creates ([dc3b2af](https://github.com/corekraft/kore/commit/dc3b2af64a7172f6f0eca9253f390960995bfd94))
* warn on removing or moving the journal directory and its parents ([f5013b7](https://github.com/corekraft/kore/commit/f5013b7889dd08cc03cbdb56c866efcde8df20a7))
* write prometheus extra scrape configs as block-sequence yaml ([c6cfcbb](https://github.com/corekraft/kore/commit/c6cfcbb3e5965a2dfa7272363fa90e68ae5a7051))


### Refactoring

* dispatch cli commands through a table of small handlers ([fc3512a](https://github.com/corekraft/kore/commit/fc3512ae2235b9ba8cd9f9772c0f6d4db931f4be))
* split app up into verify, stage, install and readiness steps ([6056002](https://github.com/corekraft/kore/commit/6056002317b17162ed43f1f967653c4e944d3be7))
* split config validation into table-driven checks ([45e9b5b](https://github.com/corekraft/kore/commit/45e9b5bbbc8a7617392a196a94833ed1be98a248))
* split doctor into one function per check ([00ffedc](https://github.com/corekraft/kore/commit/00ffedcb338e23da755ca94fc723cfafa0188eed))
* split local signing, secret sync and trust install into named steps ([3c7f7ec](https://github.com/corekraft/kore/commit/3c7f7ec4361ea7a4d5ede6331fa3c36dfdedd66a))
* split lock recovery, retained-data checks and oversized specs ([475b029](https://github.com/corekraft/kore/commit/475b0290dfe6c5545dbb9886454b5b425a3b291f))
* split oversized config, cli, and tunnel specs by behavior ([de38657](https://github.com/corekraft/kore/commit/de3865751dd29517e932341d3170aefae1919b9e))
* split platform into focused modules and specs ([8f30682](https://github.com/corekraft/kore/commit/8f3068286c237f4ada040543d4ea053811a23677))


### Documentation

* add agent primitives plan ([53ddc4d](https://github.com/corekraft/kore/commit/53ddc4da4e480b6490979da03b7c93edc481db4d))
* add knowledge index, plan frontmatter, and knowledge plan ([636edd4](https://github.com/corekraft/kore/commit/636edd46729d8836550782e0c831e939a0c7c61f))
* add self-maintenance plan ([4e27695](https://github.com/corekraft/kore/commit/4e276951eea7bff32450e4234385d3cdf3b6551e))
* anchor spawn-session wait patterns to their own line ([db6b50f](https://github.com/corekraft/kore/commit/db6b50f7ae3c7099ff3175dccd6f54a8a76a5148))
* audit the implementation plan against the code ([cf34201](https://github.com/corekraft/kore/commit/cf342011b92ac7b81a345ba5f9637f598788c0ea))
* close the self-maintenance plan ([31ae8db](https://github.com/corekraft/kore/commit/31ae8db849ec505bb08ff405252db471176de658))
* describe the herdr pane layout and prompt pitfalls in spawn-session ([4ebfc24](https://github.com/corekraft/kore/commit/4ebfc24493d0794cb9025b6811fbe6f9bf1c7ae9))
* extract plan decisions into adrs 0002-0015 ([a17220c](https://github.com/corekraft/kore/commit/a17220c56f4896acacf9d49e4b5d64e891c49de1))
* format plans with prettier ([ec25776](https://github.com/corekraft/kore/commit/ec257769db1592ec58305a3d2536ced0044d49c1))
* give judging to opus and implementation to sonnet or haiku in spawn-session ([e171104](https://github.com/corekraft/kore/commit/e1711048797eca7695697c8a7fa3510c413bfe95))
* keep opus in the main session and default spawned sessions to sonnet or haiku ([e220ee0](https://github.com/corekraft/kore/commit/e220ee08bd40494e7a1f95a1d6c023ea13fa75f5))
* name herdr sessions after their subject ([96e4691](https://github.com/corekraft/kore/commit/96e46915b5f0fd27f3654b3a0fca99e83c79aade))
* note ci checks use the runner's git ([d9c4b7c](https://github.com/corekraft/kore/commit/d9c4b7c073000d6f50721cd2487cef72b3602eb4))
* note the 32-character herdr agent name limit ([12e52d8](https://github.com/corekraft/kore/commit/12e52d86f8738222664393b60e7e2e8f34a61b7e))
* plan cohesive domain classes ([6442af6](https://github.com/corekraft/kore/commit/6442af6a6d70062e2ad2a6a4d46388706981e595))
* plan the audit follow-up work ([2381bf1](https://github.com/corekraft/kore/commit/2381bf1077a030011bdcf06a4abf63045d43421b))
* point the next step at clusterimagepolicy enforcement ([60a695a](https://github.com/corekraft/kore/commit/60a695a8032d0ab7682b06770ebd2d5b97f99da8))
* point the step 7 handoff at the live admission check and v0.1.0 ([f4832f0](https://github.com/corekraft/kore/commit/f4832f060ddb0b53fa057b61260395e1eaf83a94))
* point the step 7 handoff at the live admission check and v0.1.0 ([906b680](https://github.com/corekraft/kore/commit/906b6809e1f22499d6acdb0f22f61aefed08d97f))
* re-verify adrs 0003 and 0008 to 0011 against the refining decisions ([0723d82](https://github.com/corekraft/kore/commit/0723d8269477f7acab654fffa1f566138eeae785))
* re-verify adrs 0005 to 0007 and plan 1, noting the local signing key exception ([e0bd42c](https://github.com/corekraft/kore/commit/e0bd42ceebf76b3527479f5a0b7027460a2a392a))
* re-verify stale decisions and plans against the 2026-11-08 changes ([e756e9c](https://github.com/corekraft/kore/commit/e756e9c4c476d00142cf1d6f1dfb9fd09d4c0bc8))
* record agent primitives results and close the plan ([d94d43f](https://github.com/corekraft/kore/commit/d94d43fa94313db1db196601cdc66b4f7a57979b))
* record exact release tag identities for the signing authority ([5e35126](https://github.com/corekraft/kore/commit/5e35126966be70793c33d70d2c1ecbcfb0d2174f))
* record portability rendering and render redaction decision ([de1548f](https://github.com/corekraft/kore/commit/de1548f5ffdd451109ac20efafff841a169d0d88))
* record the bootstrap, signing, sops, and export decisions ([8e71825](https://github.com/corekraft/kore/commit/8e71825a3d78bc3c184675155f790597d842824d))
* record the ci failing-branch probe ([1f254cd](https://github.com/corekraft/kore/commit/1f254cd479c49751e6572f902380f999be2be22e))
* record the destroy guard and lock recovery fixes ([04f4633](https://github.com/corekraft/kore/commit/04f463327fae95cfaf0a9cd1a0dfceced6affe2b))
* record the first ci run on the pull request ([77bbd5f](https://github.com/corekraft/kore/commit/77bbd5f22a928a4ccd03de13298acb0950e4a991))
* record the fresh-profile live bootstrap evidence ([db6f726](https://github.com/corekraft/kore/commit/db6f726fa0221ac18a7a97ad6cb37d07f08477af))
* record the journal test pollution fix ([5a272da](https://github.com/corekraft/kore/commit/5a272dab7cb87c5b54da31a5ac1bba84dc317066))
* record the live export, purge, and restore round trip ([5a075bd](https://github.com/corekraft/kore/commit/5a075bde80df03cb240fea4f49b38dde03319226))
* record the local signing key fix ([3b5a3e1](https://github.com/corekraft/kore/commit/3b5a3e18a2707143e8a72065d7dd66bf940cfa7c))
* record the parallel offline implementation in the plan ([fbb7ddf](https://github.com/corekraft/kore/commit/fbb7ddfe8217dafe2e6e115e3e06a5cecfd4a752))
* record the plan 6 review fixes ([ebed771](https://github.com/corekraft/kore/commit/ebed771aac4bae67a02fd67b83f6e23c265bb097))
* record the platform upgrades and sigstore policy controller ([1c9acd7](https://github.com/corekraft/kore/commit/1c9acd731c206d3419a6db69911785beeeebccfa))
* record the restore schema defect and the converged rerun ([fd4fde3](https://github.com/corekraft/kore/commit/fd4fde3a47f29ea52b32b82e89f44401ae1e6613))
* record the review fixes and the next live check ([a087ebb](https://github.com/corekraft/kore/commit/a087ebb1dc35a6ee5443ca192c627f0efe762923))
* record the second fresh-profile live bootstrap and stop/resume evidence ([b551574](https://github.com/corekraft/kore/commit/b55157454e33ee42768a3fc5a63a9e973f17c000))
* record the second parallel offline implementation ([4e48e86](https://github.com/corekraft/kore/commit/4e48e8625e295bc0559031d42eb0d668319d2060))
* record the second retrospective ([f62e67a](https://github.com/corekraft/kore/commit/f62e67a2a579180b78b8d3fab2e3bea2fab7f10f))
* record the third fresh-profile live bootstrap evidence ([4cb4955](https://github.com/corekraft/kore/commit/4cb4955ff8dfdb147426b20471d63dcd1cb728d8))
* record the toolchain upgrade ([1d34fbc](https://github.com/corekraft/kore/commit/1d34fbc38294d2a8c017f76188c900a5483cb78e))
* record third skill eval and close harness exit criteria ([8564e32](https://github.com/corekraft/kore/commit/8564e3201e824359def276a84f8d7fe839b07ec5))
* renumber the parallel adrs and run promtool in ci ([c7f75ca](https://github.com/corekraft/kore/commit/c7f75ca95a645576dca037e2bbc8a5ceab62cafc))
