# Disposable production-browser evidence

- Fixture: disposable real-Git Store `3f0191e5-4199-470f-a364-6165da157b20`, Issue `browser-proof`; production bundle `index-B18PWETx.js`.
- Navigation: Issues → Detail → Operations → Unlinked Changes each rendered exactly one owning page and the matching active navigation item. All captured Rasen-management requests were GET-only.
- Board: five fixed phase lanes and one Issue card. Its main link targets Detail; phase, health, and progress links target stable Detail provenance fragments.
- Detail: 6 provenance families (`issue-record`, `plan-projection`, `acceptance-review`, `runtime`, `delivery`, `attention`) use only the closed `git|runtime` kinds. All five state fragments resolved exactly once, and every HTTP-backed locator/fingerprint check passed.
- Storage rebuild: localStorage, sessionStorage, Cache Storage, IndexedDB database inventory, and service-worker registrations were all available and cleared to zero. A full token-authenticated remount issued fresh projection and attention GETs; DOM digest `d85d1a174e9f88508c5293f51e36baa832e354c5d764c165e79f7b14de3bc6cf` and response digest `7500e0e5c8de40744f7c93921f0722b61ca156b64f307250a88bf3af8b6a308c` were identical after clearing.
- Freshness: the disposable control published acceptance revision `0002` at commit `0995c6802289b49f91bff59c78b1ecf9878c8a52`. The rebuilt DOM digest changed to `e9470b41efbc54a26e3caea389c59cee5d03af3e25e9c3f2402e08098476b302` and response digest to `f2689a0add801026e0b580ef2310742ab45f4ac1efa8061f4b204273579e7de6`, with no invalidation call.
- Redaction: auth tokens, URL fragments, headers, and raw network events are intentionally absent. Extension-origin requests observed during full Chrome navigation are excluded by exact management-origin matching and retained only as aggregate method counts in the JSON receipt.

## Persistent issue-registry read-only dogfood

- Store `issue-registry` (`f76edc31-229a-42bc-a5c7-848021eeb2da`) stayed at HEAD `f295abce308297dd09eb34a81287c614a8c489c5` with a clean porcelain status.
- The deterministic tracked-byte manifest contains 311 entries and SHA-256 `333900dfb4dfd6740907b93c91054ed963c5a9375044409d5b48abcd67e9fba6`; HEAD, status digest, every path/byte hash, and the aggregate digest are exactly equal before/after.
- The production UI rendered Issues → `issue-level-review-delivery` Detail → Operations → Unlinked Changes. Detail exposed six `git|runtime` provenance families and every state fragment resolved exactly once.
- Every captured request to the Rasen management origin was GET; no create, attach, accept, close, update, Run, or Session mutation was issued.
