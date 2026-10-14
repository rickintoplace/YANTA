# YANTA on Google Play

Everything needed to publish the Android app, and what to answer in the
Play Console. The app is a native shell around the web app at
https://yanta.page (WebView + `window.YantaAndroid` bridge), so most
updates ship with a web deploy; an app update is only needed for native
changes.

## 1. Signing

Google Play signs what users install (**Play App Signing**). We only sign
uploads, with the **upload key**:

- Keystore: `~/.yanta-release/yanta-upload.jks`
- Passwords: `~/.yanta-release/keystore.properties` (read by
  `app/build.gradle.kts`; a copy at `android/keystore.properties` also works
  and is git-ignored)
- Upload key SHA-256:
  `52:01:A6:68:DA:9A:E2:28:80:6D:63:35:B5:2D:97:C3:94:7C:2D:C1:84:DF:49:2D:75:56:D6:1A:38:EA:95:28`

**Back up both files now** (password manager or an encrypted backup). If
the upload key is lost, Google can reset it after a support request — that
takes days, so a backup saves a release.

Without the keystore, release builds are produced unsigned and debug builds
keep working.

## 2. Build

```bash
cd android
./gradlew bundleRelease          # app/build/outputs/bundle/release/app-release.aab  → Play Console
./gradlew assembleRelease        # app/build/outputs/apk/release/app-release.apk     → testing
```

Release builds are minified with R8 (`proguard-rules.pro` keeps the
`@JavascriptInterface` bridge methods). Bump `versionCode` in
`app/build.gradle.kts` for every upload.

Target SDK is 36 (Play requires API 36 for new apps and updates since
2026-08-31).

## 3. Digital Asset Links

`public/.well-known/assetlinks.json` links yanta.page to the app (App
Links and passkeys from the password manager inside the app). It lists:

- the debug key (APKs built on this machine),
- the upload key (locally built release APKs).

**After the first upload**, copy the *app signing key* SHA-256 from Play
Console → Test and release → App integrity → App signing, add it to
`sha256_cert_fingerprints`, and deploy the web app. Until then, the Play
version opens yanta.page links in the browser and cannot use passkeys.

## 4. Account and testing

- **Personal developer account** (created after 2023-11-13): production
  access only after a **closed test with at least 12 testers opted in for
  14 days in a row**. Start the closed test as early as possible.
- **Organization account**: no tester requirement, but needs a D-U-N-S
  number (free, also for sole proprietors; takes a few days to weeks).

## 5. Store listing

Text and graphics in fastlane layout (`fastlane supply` can upload them; the
Play Console accepts the same files by hand):

```
fastlane/metadata/android/<en-US|de-DE>/
  title.txt                 ≤ 30 characters
  short_description.txt     ≤ 80
  full_description.txt      ≤ 4000
  changelogs/<versionCode>.txt
  images/icon.png           512 × 512
  images/featureGraphic.png 1024 × 500
  images/phoneScreenshots/  1080 × 2106 (ratio ≤ 2:1)
```

Screenshots are made from the web app with demo content (Playwright, light
theme, nudge hidden); regenerate them after visible UI changes.

- Category: **Productivity**
- Contact email: rick@yanta.page · Website: https://yanta.page
- Privacy policy: https://yanta.page/privacy

## 6. App content (Play Console → Policy → App content)

| Question | Answer |
|---|---|
| Privacy policy | https://yanta.page/privacy |
| App access | All functionality available without login. Optional YANTA Cloud account (email code). |
| Ads | No ads |
| Content rating (IARC) | Productivity. No violence, sex, drugs, gambling. **Users can share content** (public share links, shared spaces) — yes. **Generative AI** — yes (assistant). |
| Target audience | 16+ (terms require 16; keeps the app out of the Families programme) — choose "18 and over" if Play pushes AI apps there |
| News app | No |
| Government app | No |
| Financial features | No |
| Health | No |
| Data safety | see below |
| Account deletion | In app: Settings → About → Delete account; web: https://yanta.page/delete-account |
| Generative AI policy | In-app reporting: flag button under each AI answer (`/api/ai/report`) |
| UGC policy | Public shares can be reported: https://yanta.page/report |

### Data safety

Data **collected** (only when the user signs in to YANTA Cloud or uses the
features named):

| Data type | Collected | Shared | Optional | Purpose | Notes |
|---|---|---|---|---|---|
| Email address | Yes | No | Yes (only for a cloud account) | Account management | Login codes via Resend (service provider) |
| Other user-generated content (AI prompts) | Yes, **processed ephemerally** | No (OpenRouter is a service provider) | Yes | App functionality | Included AI only; not stored |
| Other user-generated content (reported AI answers) | Yes | No | Yes | App functionality / safety | Only what the user chooses to report |
| Device or other IDs | Yes | No | Yes | App functionality | Sync device id; FCM token for push |
| Files and docs / other user-generated content (synced notes, drawings, calendar) | Yes | No | Yes (only with YANTA Cloud sync) | App functionality | End-to-end encrypted: the server stores ciphertext it cannot read |

Not collected: location, contacts, financial info (no purchases in the app), health,
messages, web history, crash logs, diagnostics, analytics.

Synced content is declared even though it is end-to-end encrypted: Play's
guidance does not clearly exempt encrypted data from "collected", and
declaring more is the safe side. Answer "Data is encrypted in transit: Yes" and "Users
can request deletion: Yes".

### Permissions

| Permission | Why | Declaration |
|---|---|---|
| POST_NOTIFICATIONS | Calendar reminders | none |
| SCHEDULE_EXACT_ALARM | Reminders at the exact minute (calendar is a core feature) | none (only USE_EXACT_ALARM needs one) |
| CAMERA | Scanning pairing QR codes, photos for notes | none |
| RECEIVE_BOOT_COMPLETED | Re-arming reminders after a restart | none |
| USE_BIOMETRIC (via androidx.biometric) | Unlock with fingerprint or face | none |

Microphone permissions were removed while chat is paused; add them back
(and to the data safety form) when chat returns.

## 7. Payments policy

The Android app does not sell or advertise YANTA Plus: no upgrade, pricing
or billing buttons (`inStoreApp()` in `src/billing/billing-ui.js`, hidden by
`html[data-store-app]` in `styles.css`). A plan bought on the web works in
the app. Cancelling stays reachable through the legal footer, as German law
requires.

## 8. Users of the sideloaded APK

APKs built here are signed with the debug key; the Play version is signed by
Google. Android cannot update one with the other: switching to the Play
version means uninstalling the APK first, which deletes the app's local
data. With sync (YANTA Cloud, Drive or a folder) everything comes back after
signing in; without sync, export a backup first (Settings → Sync & Backup).
