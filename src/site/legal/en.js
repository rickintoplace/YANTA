// ============================================================
// YANTA — legal documents, English (the source of record)
//
// Other locales translate these; where a translation is missing the loader
// falls back to this file and prefixes a notice in the reader's language.
// ============================================================

import {
  CONTACT_EMAIL,
  escapeHtml,
  licenceRows,
  mailLink,
  processorRows,
  providerBlock,
  SOURCE_URL,
  table,
  UPDATED,
  YANTA_LEGAL,
} from './shared.js';

const PROCESSOR_PURPOSES = {
  cloudflare: 'Workers, D1, R2 — API and encrypted object storage',
  vercel: 'Hosting of the web app',
  paddle: 'Merchant of Record: payments, tax, invoices',
  resend: 'Login and notification emails',
  openrouter: 'AI processing for Included AI',
  brave: 'Web search',
  google: 'Video sources; optional Drive sync',
  weather: 'Weather',
  geo: 'Manual location lookup',
  citations: 'Citation metadata',
  matrix: 'End-to-end encrypted chat',
};

function updatedLine() {
  return `<p><strong>Last updated:</strong> ${escapeHtml(UPDATED)}</p>`;
}

// ------------------------------------------------------------
// Imprint
// ------------------------------------------------------------

function imprintDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Imprint</h1>

      <p>
        <strong>Information under § 5 DDG</strong>
      </p>

      <p>
        <strong>Provider:</strong><br>
        ${providerBlock()}
      </p>

      <p>
        <strong>Contact:</strong><br>
        ${mailLink()}
      </p>

      <p>
        <strong>Responsible for content:</strong><br>
        ${escapeHtml(YANTA_LEGAL.providerName)}, address as above.
      </p>

      ${YANTA_LEGAL.vatId ? `
        <p>
          <strong>VAT identification number (§ 27a UStG):</strong><br>
          ${escapeHtml(YANTA_LEGAL.vatId)}
        </p>
      ` : ''}

      <h2>Contact point (DSA Art. 11 and 12)</h2>
      <p>
        Single point of contact for users and for authorities under Regulation
        (EU) 2022/2065: ${mailLink()}. Communication is possible in
        <strong>German</strong> and <strong>English</strong>.
        To report unlawful content, please use
        <a href="/report">Report content</a> — that route is monitored and
        gives you a reference number.
      </p>

      <h2>Consumer dispute resolution</h2>
      <p>
        We are neither obliged nor willing to take part in dispute resolution
        proceedings before a consumer arbitration board (§ 36 VSBG). Please
        contact us directly at ${mailLink()} — most things are quicker to
        settle that way.
      </p>

      <h2>Source code</h2>
      <p>
        YANTA is free software under the GNU Affero General Public License
        v3.0. The complete source of the version running here is available at
        <a href="${escapeHtml(SOURCE_URL)}" target="_blank" rel="noopener">${escapeHtml(SOURCE_URL)}</a>
        — see <a href="/licenses">Licences</a>.
      </p>

      <h2>Project portfolio</h2>
      <p>
        <a href="${escapeHtml(YANTA_LEGAL.portfolioUrl)}" target="_blank" rel="noopener">${escapeHtml(YANTA_LEGAL.portfolioUrl)}</a>
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Terms of Service
// ------------------------------------------------------------

function termsDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Terms of Service</h1>
      ${updatedLine()}

      <h2>1. Provider and who your contract is with</h2>
      <p>
        YANTA is operated by <strong>${escapeHtml(YANTA_LEGAL.providerName)}</strong>,
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)}. Contact: ${mailLink()}.
      </p>
      <p>
        Two contracts can exist side by side, and it matters which is which:
      </p>
      <ul>
        <li>
          <strong>Use of YANTA</strong> — including the Free plan — is with us
          under these Terms.
        </li>
        <li>
          <strong>Paid subscriptions</strong> are sold by
          <strong>Paddle.com Market Ltd.</strong> as Merchant of Record. Paddle
          is your seller and contractual counterparty for the purchase, issues
          the invoice, and owes the applicable taxes. Paddle's buyer terms
          apply to the purchase in addition to these Terms.
        </li>
      </ul>

      <h2>2. The service</h2>
      <p>
        YANTA is a local-first workspace for notes, drawings, tasks, sources,
        calendar items, encrypted sync, sharing and AI-assisted workflows. It
        is offered to consumers and businesses alike; it is not a backup
        service and not a file hosting service.
      </p>

      <h2>3. Eligibility</h2>
      <p>
        You must be at least <strong>16 years old</strong> to use YANTA. If you
        are under 18, you may only take out a paid subscription with the
        consent of a parent or guardian.
      </p>

      <h2>4. Accounts</h2>
      <p>
        YANTA Cloud accounts use email-based login. You are responsible for
        keeping access to your email account secure and for activity under your
        account. Tell us at ${mailLink()} if you suspect misuse.
      </p>

      <h2>5. Encryption and Recovery Key</h2>
      <p>
        Note contents and sync objects are encrypted on your device before
        upload. Your Recovery Key is required to decrypt your vault, and we
        never receive it. This has a consequence you should be sure you accept:
        <strong>if you lose your Recovery Key, we are technically unable to
        restore your content</strong> — not unwilling, unable. Keep the Recovery
        Kit somewhere safe.
      </p>

      <h2>6. Subscriptions, prices and renewal</h2>
      <p>
        YANTA Plus raises usage limits (encrypted cloud storage budget,
        devices, cloud vaults, Included AI credits, Sources limits). Prices
        shown on our pricing page are <strong>total prices including any
        applicable VAT</strong>; the exact tax depends on your country and is
        determined by Paddle at checkout, where the final amount is shown
        before you pay.
      </p>
      <p>
        A subscription renews automatically for the same period until it is
        cancelled — monthly plans monthly, yearly plans yearly. The binding
        details of your subscription are the ones shown in Paddle Checkout
        before you complete the purchase.
      </p>

      <h2>7. Right of withdrawal</h2>
      <p>
        As a consumer you have a statutory right to withdraw from the contract
        within 14 days. The full notice and the model withdrawal form are on
        the <a href="/withdrawal">Right of withdrawal</a> page. It is separate
        from, and unaffected by, our voluntary
        <a href="/refund">refund policy</a>.
      </p>

      <h2>8. Cancellation</h2>
      <p>
        You can cancel at any time through
        <a href="/cancel">Cancel contract</a> — no login required — or in
        Settings → Sync → Manage billing. Unless stated otherwise, Plus stays
        available until the end of the period you have paid for; afterwards
        Free limits apply. If your usage then exceeds the Free limits, new
        uploads and some cloud features may be blocked until you reduce usage
        or subscribe again. <strong>Existing data is not deleted because of a
        downgrade.</strong>
      </p>

      <h2>9. Included AI and BYOK</h2>
      <p>
        Included AI is a fair-use credit budget subject to daily and monthly
        limits, context and output limits, model availability, provider cost
        and abuse protection — not a fixed number of prompts. AI output can be
        wrong, and you are responsible for checking it before you rely on it.
        In BYOK mode you use your own OpenRouter key on OpenRouter's terms.
      </p>

      <h2>10. Sources, web search and external content</h2>
      <p>
        YANTA can fetch RSS feeds, YouTube metadata, web pages, search results,
        citation data and weather from third parties. That content is theirs,
        can be wrong, unavailable or harmful, and may carry its own terms.
      </p>

      <h2>11. Public shares and shared spaces</h2>
      <p>
        A public share publishes an encrypted payload behind a link. Anyone
        holding the link and its key can read it, and links can be forwarded.
        You decide what to share and are responsible for having the right to
        share it; revoke a share when it should no longer be readable.
      </p>

      <h2>12. Acceptable use</h2>
      <p>You must not use YANTA to:</p>
      <ul>
        <li>break the law or infringe anyone's rights, including copyright;</li>
        <li>store or distribute malware, or content depicting child sexual abuse;</li>
        <li>send spam, phish, or impersonate other people;</li>
        <li>gain unauthorised access to systems or other users' data;</li>
        <li>disrupt, overload or circumvent limits of the service.</li>
      </ul>

      <h2>13. Content moderation, notices and measures</h2>
      <p>
        Anyone can report unlawful content in a public share through
        <a href="/report">Report content</a>. Notices are assessed in a timely,
        diligent, non-arbitrary and objective way.
      </p>
      <p>
        You should know how limited our view is: shares are end-to-end
        encrypted, so we <strong>cannot read them</strong>. We do not scan,
        filter or profile content, and we use no automated moderation. Where a
        notice is substantiated and we cannot verify the content ourselves, the
        measure available to us is to disable the share as a whole; in serious
        cases we may also suspend the account.
      </p>
      <p>
        If we take a measure against content you provided, we tell you the
        reasons, the facts relied on, and how to contest it — by replying to
        that message, and in any case to ${mailLink()}. You can also go to
        court, or to an out-of-court dispute settlement body certified under
        DSA Art. 21.
      </p>

      <h2>14. Availability and changes to the service</h2>
      <p>
        YANTA is provided "as is" and "as available"; we do not promise
        uninterrupted availability or that any particular feature or AI model
        stays available. We may change or discontinue features where there is
        a valid reason — for example security, legal requirements, or a
        provider we depend on changing — and where the change is reasonable for
        you, taking your interests into account. We announce significant
        changes in advance where we reasonably can. If a change materially
        disadvantages you, you may cancel and we refund the unused part of any
        prepaid period.
      </p>

      <h2>15. Liability</h2>
      <p>
        We are liable without limitation for damage caused intentionally or by
        gross negligence, for injury to life, body or health, under the
        Produkthaftungsgesetz, and to the extent we gave a guarantee.
      </p>
      <p>
        For slight negligence we are liable only where a material contractual
        obligation is breached — an obligation whose fulfilment makes proper
        performance of the contract possible in the first place and on whose
        observance you may regularly rely. In that case liability is limited to
        the foreseeable damage typical for this kind of contract.
      </p>
      <p>
        Any further liability is excluded. This does not shift the burden of
        proof to your disadvantage, and does not affect mandatory statutory
        liability.
      </p>
      <p>
        Because your data is encrypted with a key we do not hold, please keep
        your own backups — export is built in.
      </p>

      <h2>16. Suspension and termination by us</h2>
      <p>
        We may suspend or terminate access if you seriously or repeatedly
        breach these Terms, if your use creates a security risk, or where the
        law requires it. We give notice and, where the breach can be cured,
        the opportunity to cure it, unless immediate action is necessary. If we
        terminate without you being at fault, we refund the unused part of any
        prepaid period.
      </p>

      <h2>17. Changes to these Terms</h2>
      <p>
        We may amend these Terms where there is a valid reason, such as changes
        in the law, court decisions, or changes to the service. We will tell
        you at least 30 days in advance by email and highlight what changes. If
        you object before the change takes effect, the contract continues on
        the previous Terms and either side may cancel to the next possible
        date. Your silence for 30 days after such a notice counts as agreement,
        and we will say so in the notice.
      </p>

      <h2>18. Governing law and jurisdiction</h2>
      <p>
        German law applies, excluding the UN Convention on Contracts for the
        International Sale of Goods. If you are a consumer resident in the EU,
        this does not deprive you of the protection of mandatory provisions of
        the law of your country of residence, and you may bring proceedings in
        the courts of your place of residence. For merchants, legal persons
        under public law and special funds under public law, the place of
        jurisdiction is our registered office.
      </p>

      <h2>19. Contract language and contract text</h2>
      <p>
        The contract language is English. We do not store the contract text in
        a way you can retrieve later — please save or print these Terms and
        your Paddle order confirmation.
      </p>

      <h2>20. Severability</h2>
      <p>
        If a provision of these Terms is or becomes invalid, the rest remains
        in force.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Privacy policy
// ------------------------------------------------------------

function privacyDocument() {
  const recipients = processorRows(PROCESSOR_PURPOSES);

  return `
    <article class="yanta-legal-doc">
      <h1>Privacy Policy</h1>
      ${updatedLine()}

      <p>
        The short version: YANTA is local-first and your notes are encrypted
        on your device before they go anywhere, so the parts of this policy
        that matter most are about the little we do see — your email address,
        counters, and payment records. There is no tracking, no advertising,
        no profiling, and no cookie banner because there is nothing to consent
        to.
      </p>

      <h2>1. Controller</h2>
      <p>
        ${providerBlock()}<br>
        ${mailLink()}
      </p>
      <p>
        We have not appointed a data protection officer; we are below the
        threshold in § 38 BDSG. Send data protection requests to the address
        above and they reach the right person.
      </p>

      <h2>2. What we process, why, and on what legal basis</h2>
      ${table(
        ['Data', 'Purpose', 'Legal basis'],
        [
          ['Email address', 'Account, login, service messages', 'Art. 6(1)(b) — performance of the contract'],
          ['Session cookie, device records', 'Keeping you signed in, showing your devices', 'Art. 6(1)(b)'],
          ['Encrypted sync objects, object paths, sizes, timestamps', 'Providing sync', 'Art. 6(1)(b)'],
          ['Usage counters (storage, objects, bandwidth, writes, AI credits)', 'Enforcing plan limits, capacity planning', 'Art. 6(1)(b) and (f) — running the service reliably'],
          ['Hashed IP address, event type, timestamp', 'Security, abuse and fraud prevention, rate limits', 'Art. 6(1)(f) — securing the service'],
          ['Billing customer, transaction and subscription identifiers', 'Payments, invoicing, accounting', 'Art. 6(1)(b) and (c) — legal accounting duties'],
          ['Public share metadata and encrypted payloads', 'Delivering shares you create', 'Art. 6(1)(b)'],
          ['Feed URLs and lookup requests (Sources)', 'Fetching what you subscribed to', 'Art. 6(1)(b)'],
          ['AI prompts and the context you select', 'Answering your request', 'Art. 6(1)(b)'],
          ['Cancellation declarations, content notices', 'Legal duties under § 312k BGB and the DSA', 'Art. 6(1)(c)'],
        ]
      )}
      <p>
        Providing your email address is necessary for a cloud account — without
        it we cannot offer sync. Everything else is optional: YANTA runs fully
        offline with no account at all.
      </p>

      <h2>3. Data on your own device</h2>
      <p>
        Most of YANTA lives in your browser's IndexedDB and localStorage. That
        storage is what makes an offline-first app work, so under § 25(2)
        TDDDG it is strictly necessary for a service you explicitly requested
        and needs no consent. Clearing browser data deletes local YANTA data
        unless you have sync or a backup.
      </p>
      <p>
        Nothing else is put on your device: nothing for advertising, nothing for
        measurement, nothing that could identify or follow you. Our start page
        exists in two versions so we can tell which one explains YANTA better,
        but which one you see is decided fresh each time and never written down
        — so there is no marker on your device and nothing to consent to.
      </p>

      <h2>4. Encryption and what we can actually see</h2>
      <p>
        Sync payloads are encrypted client-side with AES-256-GCM; remote object
        names are HMAC-derived. We see the shape of your usage — how many
        objects, how large, when — but not titles, folder structure or
        contents. Share links carry their key in the URL fragment, which
        browsers never send to a server.
      </p>

      <h2>5. Recipients and processors</h2>
      <p>Depending on which features you use, data reaches:</p>
      ${table(['Recipient', 'Purpose', 'Location'], recipients)}
      <p style="font-size:13px">
        <sup>*</sup> Processing takes place in, or can reach, a country outside
        the EU/EEA — see the next section.
      </p>

      <h2>6. Transfers to third countries</h2>
      <p>
        Where a recipient marked above processes data outside the EU/EEA, the
        transfer is safeguarded either by the recipient's certification under
        the <strong>EU-US Data Privacy Framework</strong> or by the European
        Commission's <strong>Standard Contractual Clauses</strong> under
        Art. 46(2)(c) GDPR, together with additional technical measures — most
        importantly that content reaches these providers already encrypted with
        a key they do not have. You can request a copy of the safeguards from
        ${mailLink()}.
      </p>
      <p>
        US authorities may in principle be able to demand access to data held
        by US providers. For YANTA that means metadata and ciphertext; your
        note contents stay unreadable without your Recovery Key.
      </p>

      <h2>7. AI processing</h2>
      <p>
        In Included AI mode the messages and context you select are sent to
        YANTA Cloud and forwarded to OpenRouter. We do not store prompts or
        completions server-side, and we request Zero Data Retention routing
        where the model provider supports it. There is no automated
        decision-making with legal effect under Art. 22 GDPR, and we never use
        your content to train models. Please do not put secrets or other
        people's sensitive data into prompts.
      </p>

      <h2>8. Cookies and how we count</h2>
      <p>
        One strictly necessary, HTTP-only session cookie for login. Paddle sets
        its own cookies during checkout and in the billing portal — see
        Paddle's privacy notice. There is no analytics product in YANTA, no
        advertising and no third-party tracking, which is why you never see a
        consent banner here.
      </p>
      <p>
        We do count two things on our start page: that the page was opened, and
        that someone clicked “Start”. Without those two numbers we cannot tell
        whether the page works at all. They are stored as daily totals — a
        counter per day, per event, per page version, plus the hostname of the
        site you came from (never a full address, never a search query). There
        is no record of individual visits: no identifier, no session, no IP
        address, no user agent, no time more precise than the day. Because
        nothing in these totals can be traced back to a person, they are not
        personal data, and there is nothing here to consent to, request or
        delete.
      </p>

      <h2>9. How long we keep things</h2>
      ${table(
        ['Data', 'Retention'],
        [
          ['Account and encrypted sync data', 'Until you delete the account or the data'],
          ['Sessions', 'Until expiry or logout'],
          ['Security and audit records (hashed IP)', 'Up to 12 months'],
          ['Usage counters', 'Rolling, up to 14 months'],
          ['Daily page totals (no personal data)', 'Kept as aggregate totals'],
          ['Invoices, payment and accounting records', '10 years (§ 147 AO, § 257 HGB)'],
          ['Cancellation declarations', '3 years (limitation period)'],
          ['Content notices under the DSA', 'Up to 3 years'],
          ['Public shares', 'Until revoked or the account is deleted'],
        ]
      )}

      <h2>10. Your rights</h2>
      <p>
        You have the right to access (Art. 15), rectification (Art. 16),
        erasure (Art. 17), restriction (Art. 18), data portability (Art. 20)
        and to withdraw consent at any time with effect for the future
        (Art. 7(3)). Write to ${mailLink()}; we answer within one month.
        You can delete your account yourself at
        <a href="/delete-account">Delete account</a>, and export your notes as
        Markdown or an encrypted backup at any time.
      </p>
      <p>
        <strong>Right to object (Art. 21 GDPR):</strong> where we rely on our
        legitimate interests — the security and abuse-prevention processing in
        the table above — you have the right to object at any time on grounds
        relating to your particular situation. We then stop that processing
        unless we can show compelling legitimate grounds that override your
        interests.
      </p>

      <h2>11. Right to complain to a supervisory authority</h2>
      <p>
        You can lodge a complaint with a data protection supervisory authority,
        in particular in the Member State of your residence, place of work or
        the place of the alleged infringement. The authority responsible for us
        is:
      </p>
      <p>
        <strong>Die Landesbeauftragte für den Datenschutz Niedersachsen</strong><br>
        Prinzenstraße 5, 30159 Hannover, Germany<br>
        <a href="https://www.lfd.niedersachsen.de" target="_blank" rel="noopener">www.lfd.niedersachsen.de</a>
      </p>

      <h2>12. Children</h2>
      <p>
        YANTA is not directed at children under 16. If you believe a child has
        given us personal data, contact ${mailLink()} and we will delete it.
      </p>

      <h2>13. Changes to this policy</h2>
      <p>
        We update this policy as YANTA changes. The date at the top tells you
        when it last moved; we notify you by email about changes that
        materially affect you.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Withdrawal and refunds
// ------------------------------------------------------------

function withdrawalDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Right of withdrawal &amp; refunds</h1>
      ${updatedLine()}

      <p>
        Two different things live on this page. The first is your
        <strong>statutory right of withdrawal</strong>, which the law gives you
        and neither we nor anyone else can take away. The second is our own
        <strong>refund policy</strong>, which is voluntary and goes further than
        the law in some places. If they ever conflict, the statutory right wins.
      </p>

      <h2 id="withdrawal">Withdrawal notice</h2>

      <h3>Right of withdrawal</h3>
      <p>
        You have the right to withdraw from this contract within 14 days
        without giving any reason.
      </p>
      <p>
        The withdrawal period is 14 days from the day of the conclusion of the
        contract.
      </p>
      <p>
        To exercise the right of withdrawal, you must inform us
        (${escapeHtml(YANTA_LEGAL.providerName)},
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)}, ${mailLink()}) of your decision to
        withdraw from this contract by an unequivocal statement (for example a
        letter sent by post or an email). You may use the model withdrawal form
        below, but it is not obligatory.
      </p>
      <p>
        To meet the withdrawal deadline, it is sufficient for you to send your
        communication concerning your exercise of the right of withdrawal
        before the withdrawal period has expired.
      </p>

      <h3>Effects of withdrawal</h3>
      <p>
        If you withdraw from this contract, we shall reimburse to you all
        payments received from you, including the costs of delivery (with the
        exception of the supplementary costs resulting from your choice of a
        type of delivery other than the least expensive type of standard
        delivery offered by us), without undue delay and in any event not later
        than 14 days from the day on which we are informed about your decision
        to withdraw from this contract. We will carry out such reimbursement
        using the same means of payment as you used for the initial
        transaction, unless you have expressly agreed otherwise; in any event,
        you will not incur any fees as a result of such reimbursement.
      </p>
      <p>
        If you requested that the performance of services should begin during
        the withdrawal period, you shall pay us an amount which is in
        proportion to what has been provided until you have communicated to us
        your withdrawal from this contract, in comparison with the full
        coverage of the contract.
      </p>

      <h3>Early expiry of the right of withdrawal</h3>
      <p>
        Your right of withdrawal expires early in the case of a contract for
        the supply of digital content not supplied on a tangible medium if we
        have begun performance after you have expressly consented to us
        beginning performance before the end of the withdrawal period and you
        have acknowledged that you thereby lose your right of withdrawal. We
        ask for both explicitly before checkout, and we confirm them to you in
        writing.
      </p>

      <h2>Model withdrawal form</h2>
      <p>
        (Complete and return this form only if you wish to withdraw from the
        contract.)
      </p>
      <blockquote class="yanta-legal-quote">
        <p>
          To ${escapeHtml(YANTA_LEGAL.providerName)},
          ${escapeHtml(YANTA_LEGAL.street)},
          ${escapeHtml(YANTA_LEGAL.city)},
          ${escapeHtml(YANTA_LEGAL.country)},
          ${escapeHtml(CONTACT_EMAIL)}:
        </p>
        <p>
          I/We (*) hereby give notice that I/We (*) withdraw from my/our (*)
          contract of sale of the following goods (*)/for the provision of the
          following service (*),
        </p>
        <p>
          Ordered on (*)/received on (*),<br>
          Name of consumer(s),<br>
          Address of consumer(s),<br>
          Signature of consumer(s) (only if this form is notified on paper),<br>
          Date
        </p>
        <p>(*) Delete as appropriate.</p>
      </blockquote>
      <p>
        Sending this form to ${mailLink()} is enough. You can also simply
        write us a sentence — no particular wording is required.
      </p>

      <h2>Our refund policy</h2>
      <p>
        Beyond the statutory right above, we handle refunds as follows. Paddle
        acts as Merchant of Record and processes them.
      </p>

      <h3>1. First purchase</h3>
      <p>
        Unhappy with YANTA Plus? Contact us within 14 days of your first
        purchase and we will normally refund it, provided the request is
        genuine and the service has not been abused.
      </p>

      <h3>2. Renewals</h3>
      <p>
        Renewal payments are generally not refunded once the new period has
        started. If a renewal took you by surprise and you have barely used the
        period, write to us anyway — we would rather refund than have an
        unhappy customer. This does not limit any statutory right you have.
      </p>

      <h3>3. Abuse</h3>
      <p>
        We may refuse a refund in cases of fraud, repeated refund requests, or
        use clearly intended to avoid payment.
      </p>

      <h3>4. How to request one</h3>
      <p>
        Email ${mailLink()} with your account email and the Paddle receipt.
        Approved refunds are processed through Paddle; the time until the money
        arrives depends on Paddle and your payment provider.
      </p>

      <h3>5. Your statutory rights</h3>
      <p>
        Nothing on this page limits mandatory consumer rights, including the
        right of withdrawal above and the statutory rights in case of defects.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Licences
// ------------------------------------------------------------

function licensesDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Licences &amp; source code</h1>
      ${updatedLine()}

      <h2>YANTA itself</h2>
      <p>
        YANTA is free software licensed under the
        <strong>GNU Affero General Public License, version 3</strong>.
      </p>
      <p>
        Section 13 of that licence requires that users interacting with the
        software over a network are offered its complete corresponding source.
        Here it is:
      </p>
      <p>
        <a class="yanta-site-btn primary" href="${escapeHtml(SOURCE_URL)}" target="_blank" rel="noopener">
          Get the source code
        </a>
      </p>
      <p>
        That repository contains the web app, the Cloudflare Worker behind
        YANTA Cloud, the signalling server and the sync broker — everything
        needed to build and run your own instance. If you cannot access it,
        write to ${mailLink()} and we will send you an archive.
      </p>

      <h2>Third-party components</h2>
      <p>
        YANTA stands on a lot of other people's work. Each of these keeps its
        own licence, and the full texts ship with the packages in the
        repository.
      </p>
      ${table(['Component', 'Licence', 'Project'], licenceRows())}

      <h2>Fonts and assets</h2>
      <p>
        The handwriting and drawing fonts bundled with the drawing canvas
        (Excalifont, Virgil, Comic Shanns, Nunito, Lilita One, Assistant,
        Liberation Sans, Cascadia Code, Xiaolai) are distributed under the
        SIL Open Font License or comparable open licences by their respective
        authors.
      </p>
    </article>
  `;
}

/*
  Strings for the three pages that are a legal instrument with a form in it.
  The markup lives in src/site/*-content.js so the fields stay in one place;
  only the wording varies by locale.
*/
export const forms = {
  cancel: {
    heading: 'Cancel contract',
    statute: 'Verträge hier kündigen (§ 312k BGB)',
    intro: 'Cancel your YANTA Plus subscription here. You do not need to sign in. We confirm every cancellation by email, including the time we received it and the date your contract ends — keep that email, it is your proof.',
    keepsData: 'Cancelling ends the paid plan only. <strong>Nothing is deleted.</strong> You keep YANTA Plus until the end of the period you already paid for, and the account then continues on the Free plan. To remove the account itself, use <a href="/delete-account">Delete account</a>.',
    typeLegend: 'Type of termination',
    ordinary: 'Ordinary termination',
    ordinaryHint: 'Ends at the end of your current billing period. This is the usual choice.',
    extraordinary: 'Extraordinary termination',
    extraordinaryHint: 'For good cause, with immediate effect. Please state the reason below.',
    emailLabel: 'Email address of your YANTA account',
    emailHint: 'We send the confirmation here. Use the address your subscription runs on.',
    nameLabel: 'Name',
    refLabel: 'Contract or invoice reference',
    refHint: 'Helps us find the right contract if you have more than one.',
    reasonLabel: 'Reason for the extraordinary termination',
    declaration: 'By submitting this form I declare that I terminate my YANTA Plus contract at the earliest possible date.',
    submit: 'Cancel now',
    busy: 'Submitting your cancellation…',
    needEmail: 'Please enter the email address of your YANTA account.',
    otherHeading: 'Other ways to cancel',
    otherBody: 'A cancellation is valid in any clear form. You can also email {mail} or write to {address}. Signed-in customers can also cancel under <strong>Settings → Sync → Manage billing</strong>.',
    notWithdrawal: 'Cancelling is not the same as withdrawing. Within 14 days of your first purchase you may also have a statutory right of withdrawal — see <a href="/withdrawal">Right of withdrawal</a>.',
    receiptHeading: 'Cancellation received',
    receiptRef: 'Your reference is {ref}.',
    receiptBody: 'We have sent the confirmation to the address you gave, with the exact time we received your declaration and the date your contract ends. If it has not arrived in a few minutes, check your spam folder and then contact {mail}.',
    errRate: 'Too many attempts from this device. Please email {mail} instead — that is equally valid.',
    errGeneric: 'We could not record your cancellation. Please email {mail}: a cancellation by email is equally valid and takes effect when it reaches us.',
  },

  report: {
    heading: 'Report content',
    intro: 'If a YANTA share link points at content you believe is unlawful, tell us here. Anyone can file a notice — no account needed. This is the notice-and-action mechanism required by Article 16 of the Digital Services Act.',
    encryptedNote: '<strong>What we can and cannot see.</strong> Shared content is end-to-end encrypted and we hold no key, so we cannot open a share to check it. We assess your description, and where a notice is substantiated the measure available to us is to disable the share as a whole. That is why a precise explanation and a working link matter so much here.',
    urlLabel: 'Exact address of the content',
    urlHint: 'Paste the full share link, for example https://yanta.page/share/abc123…',
    categoryLabel: 'What is the problem?',
    categories: {
      copyright: 'Copyright or trademark infringement',
      personal_data: 'My personal data / privacy violation',
      illegal_content: 'Other illegal content',
      csam: 'Child sexual abuse material',
      malware: 'Malware or phishing',
      impersonation: 'Impersonation',
      other: 'Something else',
    },
    explanationLabel: 'Why is this content unlawful?',
    explanationHint: 'Please be specific: what exactly is there, which right it infringes, and — if you hold that right — how we can tell.',
    nameLabel: 'Your name',
    emailLabel: 'Your email address',
    emailHint: 'Needed for the confirmation of receipt and our decision. Reports about child sexual abuse material may be filed anonymously.',
    goodFaith: 'I confirm this notice is accurate and complete',
    goodFaithHint: 'A bona fide belief that the information is correct, as Art. 16(2)(d) DSA requires.',
    submit: 'Submit report',
    busy: 'Submitting your report…',
    needUrl: 'Please give the address of the content.',
    needExplanation: 'Please explain why the content is unlawful — a sentence at least.',
    needGoodFaith: 'Please confirm that your notice is accurate and complete.',
    nextHeading: 'What happens next',
    next1: 'We confirm receipt without undue delay, if you gave us an address.',
    next2: 'We assess the notice in a timely, diligent, non-arbitrary and objective way. We do not use automated moderation, so a human reads every report.',
    next3: 'We tell you the outcome and the reasons for it, along with the redress available to you.',
    next4: 'If we act against content, the person who provided it receives a statement of reasons under Art. 17 DSA and can contest the decision.',
    otherHeading: 'Other routes',
    otherBody: 'You can also write to {mail}, which is our point of contact under Art. 11 and 12 DSA for users and authorities alike, in German or English. Postal address: {address}.',
    badFaith: 'Reporting in bad faith — knowingly false notices — can have legal consequences and may lead us to ignore further reports from you.',
    receiptHeading: 'Report received',
    receiptRef: 'Your reference is {ref}.',
    receiptBody: 'A human will look at it. If you gave us an email address, you will get a confirmation now and our decision once we have assessed the notice.',
    errRate: 'Too many reports from this device. Please email {mail}.',
    errGeneric: 'We could not record your report. Please email {mail}.',
  },

  del: {
    heading: 'Delete account',
    intro: 'Deleting your YANTA Cloud account removes your data from our servers. <strong>It cannot be undone</strong>, and because your content is encrypted with a key we never see, we could not restore it even if you asked us to.',
    cancelInstead: '<strong>Only want to stop paying?</strong> That is <a href="/cancel">Cancel contract</a> — it ends the subscription and keeps your data.',
    exportHeading: 'Export first',
    exportBody: 'Open YANTA and use <strong>Settings → Backup</strong> to export your notes as readable Markdown or as an encrypted <code>.yanta</code> archive. Once the account is gone, so is the copy on our side.',
    goesHeading: 'What is deleted',
    goes: [
      'Your encrypted vaults and every synced object',
      'Notes, drawings and assets stored in YANTA Cloud',
      'Devices, sessions and push subscriptions',
      'Public shares and presentation sessions you created',
      'Shared spaces you own, and your membership in others',
      'Your YANTA Chat account on the Matrix homeserver',
    ],
    staysHeading: 'What we have to keep, and why',
    staysCols: ['Data', 'Reason'],
    stays: [
      ['Invoices and payment records', 'German commercial and tax law requires up to 10 years (§ 147 AO, § 257 HGB). They are kept for that and nothing else.'],
      ['Cancellation declarations and content notices', 'Legal records; the link to your person is removed.'],
      ['Anything stored only on your devices', 'We never had it. Clear it in the app or in your browser settings.'],
    ],
    doItHeading: 'Delete it',
    checking: 'Checking whether you are signed in…',
    signedOut: 'You are not signed in on this device. Sign in to YANTA Cloud first — then this page turns into the delete button.',
    signIn: 'Open YANTA and sign in',
    signedIn: 'Signed in as <strong>{email}</strong>. Deleting also cancels any active subscription immediately.',
    confirmLabel: 'Type DELETE to confirm',
    submit: 'Delete my account permanently',
    busy: 'Deleting your account…',
    needConfirm: 'Please type DELETE to confirm.',
    noSignInHeading: 'If you cannot sign in',
    noSignInBody: 'Email {mail} from the address the account uses, with "Delete my account" as the subject. We verify that the request comes from the account holder and delete within 30 days, usually much sooner. Postal requests to {address} work too.',
    receiptHeading: 'Your account is deleted',
    receiptBody: 'Your cloud data is gone and you have been signed out. We have sent a confirmation by email.',
    receiptLocal: 'Data stored only on this device is still here — clear it in the app or in your browser settings.',
    errExpired: 'Your session expired. Please sign in again.',
    errGeneric: 'Deletion failed. Please email {mail}.',
  },
};

export default {
  imprint: imprintDocument,
  terms: termsDocument,
  privacy: privacyDocument,
  withdrawal: withdrawalDocument,
  licenses: licensesDocument,
};
