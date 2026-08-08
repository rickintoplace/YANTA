// ============================================================
// YANTA — Rechtstexte, Deutsch
//
// Deutsche Fassung der Dokumente mit echter Verbraucherrelevanz: Impressum,
// AGB, Datenschutz sowie Widerruf und Erstattungen. Die Widerrufsbelehrung
// und das Muster-Widerrufsformular folgen dem gesetzlichen Muster aus
// Anlage 1 bzw. 2 zu Art. 246a EGBGB — der Wortlaut ist bewusst nicht
// "schöner" formuliert, weil Abweichungen die Schutzwirkung kosten.
//
// Barrierefreiheit und Lizenzen bleiben englisch; dafür setzt der Loader den
// Hinweis oben auf die Seite.
// ============================================================

import {
  CONTACT_EMAIL,
  escapeHtml,
  licenceRows,
  mailLink,
  processorRows,
  providerBlock,
  providerInline,
  SOURCE_URL,
  table,
  UPDATED,
  YANTA_LEGAL,
} from './shared.js';

const PROCESSOR_PURPOSES = {
  cloudflare: 'Workers, D1, R2 — API und verschlüsselter Objektspeicher',
  vercel: 'Hosting der Web-App',
  paddle: 'Merchant of Record: Zahlungen, Steuern, Rechnungen',
  resend: 'Login- und Benachrichtigungs-E-Mails',
  openrouter: 'KI-Verarbeitung für „Included AI“',
  brave: 'Websuche',
  google: 'Video-Quellen; optionale Drive-Synchronisierung',
  weather: 'Wetter',
  geo: 'Manuelle Ortssuche',
  citations: 'Metadaten für Zitationen',
  matrix: 'Ende-zu-Ende-verschlüsselter Chat',
};

function updatedLine() {
  return `<p><strong>Stand:</strong> ${escapeHtml(UPDATED)}</p>`;
}

// ------------------------------------------------------------
// Impressum
// ------------------------------------------------------------

function imprintDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Impressum</h1>

      <p><strong>Angaben gemäß § 5 DDG</strong></p>

      <p>
        <strong>Anbieter:</strong><br>
        ${providerBlock()}
      </p>

      <p>
        <strong>Kontakt:</strong><br>
        ${mailLink()}
      </p>

      <p>
        <strong>Verantwortlich für den Inhalt:</strong><br>
        ${escapeHtml(YANTA_LEGAL.providerName)}, Anschrift wie oben.
      </p>

      ${YANTA_LEGAL.vatId ? `
        <p>
          <strong>Umsatzsteuer-Identifikationsnummer (§ 27a UStG):</strong><br>
          ${escapeHtml(YANTA_LEGAL.vatId)}
        </p>
      ` : ''}

      <h2>Kontaktstelle (Art. 11 und 12 DSA)</h2>
      <p>
        Zentrale Kontaktstelle für Nutzerinnen und Nutzer sowie für Behörden
        nach der Verordnung (EU) 2022/2065: ${mailLink()}. Die Kommunikation
        ist auf <strong>Deutsch</strong> und <strong>Englisch</strong> möglich.
        Für Meldungen rechtswidriger Inhalte nutzen Sie bitte
        <a href="/report">Inhalt melden</a> — dieser Weg wird überwacht und
        liefert Ihnen eine Vorgangsnummer.
      </p>

      <h2>Verbraucherstreitbeilegung</h2>
      <p>
        Wir sind weder verpflichtet noch bereit, an Streitbeilegungsverfahren
        vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).
        Schreiben Sie uns bitte direkt an ${mailLink()} — das meiste lässt sich
        so schneller klären.
      </p>

      <h2>Quelltext</h2>
      <p>
        YANTA ist freie Software unter der GNU Affero General Public License
        v3.0. Der vollständige Quelltext der hier laufenden Fassung ist
        abrufbar unter
        <a href="${escapeHtml(SOURCE_URL)}" target="_blank" rel="noopener">${escapeHtml(SOURCE_URL)}</a>
        — siehe <a href="/licenses">Lizenzen</a>.
      </p>

      <h2>Projektportfolio</h2>
      <p>
        <a href="${escapeHtml(YANTA_LEGAL.portfolioUrl)}" target="_blank" rel="noopener">${escapeHtml(YANTA_LEGAL.portfolioUrl)}</a>
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// AGB
// ------------------------------------------------------------

function termsDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Allgemeine Geschäftsbedingungen</h1>
      ${updatedLine()}

      <h2>1. Anbieter und Vertragspartner</h2>
      <p>
        YANTA wird betrieben von <strong>${escapeHtml(YANTA_LEGAL.providerName)}</strong>,
        ${escapeHtml(YANTA_LEGAL.street)}, ${escapeHtml(YANTA_LEGAL.city)},
        ${escapeHtml(YANTA_LEGAL.country)}. Kontakt: ${mailLink()}.
      </p>
      <p>
        Es können zwei Verträge nebeneinander bestehen, und die Unterscheidung
        ist wichtig:
      </p>
      <ul>
        <li>
          <strong>Die Nutzung von YANTA</strong> — auch im kostenlosen Tarif —
          erfolgt im Verhältnis zu uns nach diesen AGB.
        </li>
        <li>
          <strong>Kostenpflichtige Abonnements</strong> werden von
          <strong>Paddle.com Market Ltd.</strong> als Merchant of Record
          verkauft. Paddle ist insoweit Ihr Verkäufer und Vertragspartner,
          stellt die Rechnung aus und schuldet die anfallenden Steuern. Für den
          Kauf gelten zusätzlich die Käuferbedingungen von Paddle.
        </li>
      </ul>

      <h2>2. Leistung</h2>
      <p>
        YANTA ist ein local-first-Arbeitsbereich für Notizen, Zeichnungen,
        Aufgaben, Quellen, Kalendereinträge, verschlüsselte Synchronisierung,
        Freigaben und KI-gestützte Abläufe. Das Angebot richtet sich an
        Verbraucher wie an Unternehmen. YANTA ist kein Backup-Dienst und kein
        Filehosting-Dienst.
      </p>

      <h2>3. Nutzungsvoraussetzungen</h2>
      <p>
        Sie müssen mindestens <strong>16 Jahre</strong> alt sein. Wenn Sie
        unter 18 sind, dürfen Sie ein kostenpflichtiges Abonnement nur mit
        Einwilligung eines Erziehungsberechtigten abschließen.
      </p>

      <h2>4. Konten</h2>
      <p>
        Konten für YANTA Cloud werden per E-Mail-Login geführt. Sie sind dafür
        verantwortlich, den Zugang zu Ihrem E-Mail-Konto zu sichern, und für
        Aktivitäten unter Ihrem Konto. Melden Sie einen Missbrauchsverdacht
        bitte an ${mailLink()}.
      </p>

      <h2>5. Verschlüsselung und Wiederherstellungsschlüssel</h2>
      <p>
        Notizinhalte und Sync-Objekte werden auf Ihrem Gerät verschlüsselt,
        bevor sie hochgeladen werden. Zum Entschlüsseln Ihres Tresors wird Ihr
        Wiederherstellungsschlüssel benötigt, den wir zu keiner Zeit erhalten.
        Daraus folgt etwas, das Sie bewusst akzeptieren sollten:
        <strong>Wenn Sie Ihren Wiederherstellungsschlüssel verlieren, können
        wir Ihre Inhalte technisch nicht wiederherstellen</strong> — nicht
        „wollen nicht“, sondern „können nicht“. Bewahren Sie das Recovery Kit
        sicher auf.
      </p>

      <h2>6. Abonnements, Preise und Verlängerung</h2>
      <p>
        YANTA Plus erhöht Nutzungsgrenzen (verschlüsseltes Cloud-Speicherbudget,
        Geräte, Cloud-Tresore, Included-AI-Guthaben, Quellen-Limits). Die auf
        unserer Preisseite angegebenen Preise sind
        <strong>Gesamtpreise einschließlich etwaiger Umsatzsteuer</strong>; die
        genaue Steuer richtet sich nach Ihrem Land und wird von Paddle im
        Checkout ermittelt, wo der Endbetrag vor dem Bezahlen angezeigt wird.
      </p>
      <p>
        Ein Abonnement verlängert sich automatisch um denselben Zeitraum, bis
        es gekündigt wird — Monatstarife monatlich, Jahrestarife jährlich.
        Maßgeblich sind die Angaben, die Ihnen im Paddle-Checkout vor Abschluss
        des Kaufs angezeigt werden.
      </p>

      <h2>7. Widerrufsrecht</h2>
      <p>
        Als Verbraucher steht Ihnen ein gesetzliches Widerrufsrecht von 14
        Tagen zu. Die vollständige Belehrung und das Muster-Widerrufsformular
        finden Sie unter <a href="/withdrawal">Widerrufsrecht</a>. Es besteht
        unabhängig von unserer freiwilligen
        <a href="/refund">Erstattungsregelung</a> und wird durch sie nicht
        eingeschränkt.
      </p>

      <h2>8. Kündigung</h2>
      <p>
        Sie können jederzeit über <a href="/cancel">Verträge hier kündigen</a>
        — ohne Anmeldung — oder unter Einstellungen → Sync → Abrechnung
        verwalten kündigen. Soweit nichts anderes angegeben ist, bleibt Plus
        bis zum Ende des bereits bezahlten Zeitraums verfügbar; danach gelten
        die Grenzen des kostenlosen Tarifs. Übersteigt Ihre Nutzung diese
        Grenzen, können neue Uploads und einzelne Cloud-Funktionen gesperrt
        werden, bis Sie Ihre Nutzung verringern oder erneut abonnieren.
        <strong>Vorhandene Daten werden wegen einer Herabstufung nicht
        gelöscht.</strong>
      </p>

      <h2>9. Included AI und eigener Schlüssel (BYOK)</h2>
      <p>
        Included AI ist ein Fair-Use-Guthaben und unterliegt Tages- und
        Monatsgrenzen, Kontext- und Ausgabelimits, der Verfügbarkeit der
        Modelle, den Kosten der Anbieter und dem Missbrauchsschutz — es ist
        keine feste Zahl von Anfragen. KI-Ausgaben können falsch sein; Sie sind
        dafür verantwortlich, sie zu prüfen, bevor Sie sich darauf verlassen.
        Im BYOK-Modus nutzen Sie Ihren eigenen OpenRouter-Schlüssel zu den
        Bedingungen von OpenRouter.
      </p>

      <h2>10. Quellen, Websuche und externe Inhalte</h2>
      <p>
        YANTA kann RSS-Feeds, YouTube-Metadaten, Webseiten, Suchergebnisse,
        Zitationsdaten und Wetterdaten von Dritten abrufen. Diese Inhalte
        stammen nicht von uns, können falsch, nicht verfügbar oder schädlich
        sein und eigenen Bedingungen unterliegen.
      </p>

      <h2>11. Öffentliche Freigaben und geteilte Bereiche</h2>
      <p>
        Eine öffentliche Freigabe veröffentlicht verschlüsselte Daten hinter
        einem Link. Wer den Link samt Schlüssel hat, kann sie lesen, und Links
        lassen sich weitergeben. Sie entscheiden, was Sie freigeben, und sind
        dafür verantwortlich, dass Sie die Rechte dazu haben. Widerrufen Sie
        eine Freigabe, sobald sie nicht mehr lesbar sein soll.
      </p>

      <h2>12. Zulässige Nutzung</h2>
      <p>Sie dürfen YANTA nicht nutzen, um:</p>
      <ul>
        <li>Gesetze zu brechen oder Rechte Dritter zu verletzen, einschließlich Urheberrechten;</li>
        <li>Schadsoftware oder Darstellungen sexuellen Kindesmissbrauchs zu speichern oder zu verbreiten;</li>
        <li>Spam oder Phishing zu versenden oder sich als andere Personen auszugeben;</li>
        <li>sich unbefugt Zugang zu Systemen oder Daten anderer zu verschaffen;</li>
        <li>den Dienst zu stören, zu überlasten oder Limits zu umgehen.</li>
      </ul>

      <h2>13. Moderation von Inhalten, Meldungen und Maßnahmen</h2>
      <p>
        Jede Person kann rechtswidrige Inhalte in einer öffentlichen Freigabe
        über <a href="/report">Inhalt melden</a> anzeigen. Meldungen werden
        zeitnah, sorgfältig, frei von Willkür und objektiv geprüft.
      </p>
      <p>
        Wie begrenzt unser Einblick ist, sollten Sie kennen: Freigaben sind
        Ende-zu-Ende-verschlüsselt, wir <strong>können sie nicht lesen</strong>.
        Wir durchsuchen, filtern und profilieren keine Inhalte und setzen keine
        automatisierte Moderation ein. Ist eine Meldung begründet und können
        wir den Inhalt nicht selbst prüfen, besteht die uns mögliche Maßnahme
        darin, die Freigabe insgesamt zu deaktivieren; in schweren Fällen
        können wir zusätzlich das Konto sperren.
      </p>
      <p>
        Ergreifen wir eine Maßnahme gegen von Ihnen bereitgestellte Inhalte,
        teilen wir Ihnen die Gründe, die zugrunde gelegten Tatsachen und die
        Möglichkeiten zur Anfechtung mit — durch Antwort auf diese Mitteilung,
        in jedem Fall an ${mailLink()}. Ihnen steht außerdem der Rechtsweg
        offen sowie eine nach Art. 21 DSA zertifizierte außergerichtliche
        Streitbeilegungsstelle.
      </p>

      <h2>14. Verfügbarkeit und Änderungen der Leistung</h2>
      <p>
        YANTA wird „wie besehen“ und „wie verfügbar“ bereitgestellt; wir sagen
        keine unterbrechungsfreie Verfügbarkeit zu und auch nicht, dass eine
        bestimmte Funktion oder ein bestimmtes KI-Modell verfügbar bleibt. Wir
        können Funktionen ändern oder einstellen, wenn dafür ein triftiger
        Grund besteht — etwa Sicherheit, rechtliche Vorgaben oder Änderungen
        bei einem Anbieter, von dem wir abhängen — und die Änderung für Sie
        unter Berücksichtigung Ihrer Interessen zumutbar ist. Wesentliche
        Änderungen kündigen wir vorher an, soweit uns das zumutbar möglich ist.
        Benachteiligt Sie eine Änderung erheblich, können Sie kündigen; wir
        erstatten dann den nicht genutzten Teil eines im Voraus gezahlten
        Zeitraums.
      </p>

      <h2>15. Haftung</h2>
      <p>
        Wir haften unbeschränkt für Schäden aus Vorsatz und grober
        Fahrlässigkeit, für Schäden aus der Verletzung des Lebens, des Körpers
        oder der Gesundheit, nach dem Produkthaftungsgesetz sowie im Umfang
        einer von uns übernommenen Garantie.
      </p>
      <p>
        Bei einfacher Fahrlässigkeit haften wir nur bei der Verletzung einer
        wesentlichen Vertragspflicht — einer Pflicht, deren Erfüllung die
        ordnungsgemäße Durchführung des Vertrages überhaupt erst ermöglicht und
        auf deren Einhaltung Sie regelmäßig vertrauen dürfen. In diesem Fall
        ist die Haftung auf den vertragstypischen, vorhersehbaren Schaden
        begrenzt.
      </p>
      <p>
        Eine weitergehende Haftung ist ausgeschlossen. Eine Änderung der
        Beweislast zu Ihrem Nachteil ist damit nicht verbunden; zwingende
        gesetzliche Haftung bleibt unberührt.
      </p>
      <p>
        Da Ihre Daten mit einem Schlüssel verschlüsselt sind, den wir nicht
        besitzen, sichern Sie Ihre Inhalte bitte zusätzlich selbst — der Export
        ist eingebaut.
      </p>

      <h2>16. Sperrung und Kündigung durch uns</h2>
      <p>
        Wir können den Zugang sperren oder kündigen, wenn Sie erheblich oder
        wiederholt gegen diese AGB verstoßen, wenn Ihre Nutzung ein
        Sicherheitsrisiko schafft oder wenn das Gesetz es verlangt. Wir kündigen
        dies an und geben, soweit der Verstoß behebbar ist, Gelegenheit zur
        Abhilfe, sofern nicht sofortiges Handeln erforderlich ist. Kündigen wir
        ohne Verschulden Ihrerseits, erstatten wir den nicht genutzten Teil
        eines im Voraus gezahlten Zeitraums.
      </p>

      <h2>17. Änderungen dieser AGB</h2>
      <p>
        Wir können diese AGB ändern, wenn dafür ein triftiger Grund besteht,
        etwa Gesetzesänderungen, Rechtsprechung oder Änderungen der Leistung.
        Wir informieren Sie mindestens 30 Tage vorher per E-Mail und heben
        hervor, was sich ändert. Widersprechen Sie vor Wirksamwerden, gilt der
        Vertrag zu den bisherigen Bedingungen fort und beide Seiten können zum
        nächstmöglichen Zeitpunkt kündigen. Schweigen Sie 30 Tage nach einer
        solchen Mitteilung, gilt dies als Zustimmung; darauf weisen wir in der
        Mitteilung ausdrücklich hin.
      </p>

      <h2>18. Anwendbares Recht und Gerichtsstand</h2>
      <p>
        Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Sind Sie
        Verbraucher mit Wohnsitz in der EU, entzieht Ihnen das nicht den Schutz
        zwingender Vorschriften des Rechts Ihres Wohnsitzstaates, und Sie können
        Klage bei den Gerichten Ihres Wohnsitzes erheben. Gegenüber Kaufleuten,
        juristischen Personen des öffentlichen Rechts und
        öffentlich-rechtlichen Sondervermögen ist Gerichtsstand unser Sitz.
      </p>

      <h2>19. Vertragssprache und Vertragstext</h2>
      <p>
        Vertragssprache ist Deutsch, hilfsweise Englisch. Wir speichern den
        Vertragstext nicht in einer für Sie später abrufbaren Form — bitte
        sichern oder drucken Sie diese AGB und Ihre Bestellbestätigung von
        Paddle.
      </p>

      <h2>20. Salvatorische Klausel</h2>
      <p>
        Sollte eine Bestimmung dieser AGB unwirksam sein oder werden, bleiben
        die übrigen Bestimmungen wirksam.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Datenschutzerklärung
// ------------------------------------------------------------

function privacyDocument() {
  const recipients = processorRows(PROCESSOR_PURPOSES);

  return `
    <article class="yanta-legal-doc">
      <h1>Datenschutzerklärung</h1>
      ${updatedLine()}

      <p>
        Kurzfassung: YANTA ist local-first, und Ihre Notizen werden auf Ihrem
        Gerät verschlüsselt, bevor sie irgendwohin gehen. Die wichtigsten
        Abschnitte betreffen deshalb das Wenige, das wir tatsächlich sehen:
        Ihre E-Mail-Adresse, Zähler und Zahlungsunterlagen. Es gibt kein
        Tracking, keine Werbung, kein Profiling und kein Cookie-Banner, weil es
        nichts einzuwilligen gibt.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        ${providerBlock()}<br>
        ${mailLink()}
      </p>
      <p>
        Wir haben keinen Datenschutzbeauftragten bestellt; wir liegen unter der
        Schwelle des § 38 BDSG. Datenschutzanfragen an die obige Adresse
        erreichen die zuständige Person.
      </p>

      <h2>2. Welche Daten wir verarbeiten, wozu und auf welcher Grundlage</h2>
      ${table(
        ['Daten', 'Zweck', 'Rechtsgrundlage'],
        [
          ['E-Mail-Adresse', 'Konto, Anmeldung, Servicenachrichten', 'Art. 6 Abs. 1 lit. b — Vertragserfüllung'],
          ['Sitzungs-Cookie, Geräteeinträge', 'Angemeldet bleiben, Geräteübersicht', 'Art. 6 Abs. 1 lit. b'],
          ['Verschlüsselte Sync-Objekte, Objektpfade, Größen, Zeitstempel', 'Bereitstellung der Synchronisierung', 'Art. 6 Abs. 1 lit. b'],
          ['Nutzungszähler (Speicher, Objekte, Datenvolumen, Schreibvorgänge, KI-Guthaben)', 'Durchsetzung der Tarifgrenzen, Kapazitätsplanung', 'Art. 6 Abs. 1 lit. b und lit. f — zuverlässiger Betrieb'],
          ['Gehashte IP-Adresse, Ereignistyp, Zeitstempel', 'Sicherheit, Missbrauchs- und Betrugsabwehr, Rate-Limits', 'Art. 6 Abs. 1 lit. f — Absicherung des Dienstes'],
          ['Kundennummer, Transaktions- und Abonnement-IDs', 'Zahlungen, Rechnungsstellung, Buchhaltung', 'Art. 6 Abs. 1 lit. b und lit. c — gesetzliche Aufbewahrungspflichten'],
          ['Metadaten und verschlüsselte Inhalte öffentlicher Freigaben', 'Auslieferung Ihrer Freigaben', 'Art. 6 Abs. 1 lit. b'],
          ['Feed-URLs und Abrufe (Quellen)', 'Abruf der von Ihnen abonnierten Inhalte', 'Art. 6 Abs. 1 lit. b'],
          ['KI-Eingaben und der von Ihnen gewählte Kontext', 'Beantwortung Ihrer Anfrage', 'Art. 6 Abs. 1 lit. b'],
          ['Kündigungserklärungen, Inhaltsmeldungen', 'Gesetzliche Pflichten nach § 312k BGB und DSA', 'Art. 6 Abs. 1 lit. c'],
        ]
      )}
      <p>
        Die Angabe Ihrer E-Mail-Adresse ist für ein Cloud-Konto erforderlich —
        ohne sie können wir keine Synchronisierung anbieten. Alles Weitere ist
        freiwillig: YANTA läuft vollständig offline und ganz ohne Konto.
      </p>

      <h2>3. Daten auf Ihrem eigenen Gerät</h2>
      <p>
        Der größte Teil von YANTA liegt in IndexedDB und localStorage Ihres
        Browsers. Genau dieser Speicher macht eine Offline-First-App möglich
        und ist deshalb nach § 25 Abs. 2 TDDDG unbedingt erforderlich, um einen
        von Ihnen ausdrücklich gewünschten Dienst zu erbringen; eine
        Einwilligung ist dafür nicht nötig. Löschen Sie Browserdaten, sind
        lokale YANTA-Daten weg, sofern Sie keine Synchronisierung oder
        Sicherung haben.
      </p>
      <p>
        Darüber hinaus legen wir nichts auf Ihrem Gerät ab: nichts für Werbung,
        nichts zur Messung, nichts, womit man Sie erkennen oder verfolgen
        könnte. Unsere Startseite gibt es in zwei Fassungen, damit wir sehen,
        welche YANTA besser erklärt — welche Sie sehen, wird bei jedem Aufruf
        neu entschieden und nirgends vermerkt. Es bleibt also keine Markierung
        auf Ihrem Gerät zurück, und es gibt nichts einzuwilligen.
      </p>

      <h2>4. Verschlüsselung und was wir tatsächlich sehen</h2>
      <p>
        Sync-Inhalte werden clientseitig mit AES-256-GCM verschlüsselt;
        Objektnamen auf dem Server sind HMAC-abgeleitet. Wir sehen die Form
        Ihrer Nutzung — wie viele Objekte, wie groß, wann — aber weder Titel
        noch Ordnerstruktur noch Inhalte. Freigabelinks tragen ihren Schlüssel
        im URL-Fragment, das Browser nie an einen Server senden.
      </p>

      <h2>5. Empfänger und Auftragsverarbeiter</h2>
      <p>Je nachdem, welche Funktionen Sie nutzen, erreichen Daten:</p>
      ${table(['Empfänger', 'Zweck', 'Ort'], recipients)}
      <p style="font-size:13px">
        <sup>*</sup> Die Verarbeitung findet in einem Land außerhalb der EU/des
        EWR statt oder kann dorthin gelangen — siehe nächster Abschnitt.
      </p>

      <h2>6. Übermittlung in Drittländer</h2>
      <p>
        Soweit ein oben markierter Empfänger Daten außerhalb der EU/des EWR
        verarbeitet, ist die Übermittlung entweder durch dessen Zertifizierung
        unter dem <strong>EU-US Data Privacy Framework</strong> oder durch die
        <strong>Standardvertragsklauseln</strong> der Europäischen Kommission
        nach Art. 46 Abs. 2 lit. c DSGVO abgesichert, ergänzt um technische
        Maßnahmen — vor allem dadurch, dass Inhalte diese Anbieter bereits
        verschlüsselt erreichen und der Schlüssel dort nicht vorliegt. Eine
        Kopie der Garantien erhalten Sie über ${mailLink()}.
      </p>
      <p>
        US-Behörden können grundsätzlich Zugriff auf Daten bei US-Anbietern
        verlangen. Für YANTA bedeutet das: Metadaten und Chiffrat. Ihre
        Notizinhalte bleiben ohne Ihren Wiederherstellungsschlüssel unlesbar.
      </p>

      <h2>7. KI-Verarbeitung</h2>
      <p>
        Im Modus „Included AI“ werden die von Ihnen ausgewählten Nachrichten
        und Kontexte an YANTA Cloud gesendet und an OpenRouter weitergeleitet.
        Wir speichern Eingaben und Antworten nicht serverseitig und fordern
        Zero-Data-Retention-Routing an, soweit der Modellanbieter das
        unterstützt. Eine automatisierte Entscheidung im Einzelfall mit
        rechtlicher Wirkung nach Art. 22 DSGVO findet nicht statt, und wir
        verwenden Ihre Inhalte niemals zum Training von Modellen. Geben Sie
        bitte keine Geheimnisse oder sensiblen Daten Dritter in Eingaben ein.
      </p>

      <h2>8. Cookies und wie wir zählen</h2>
      <p>
        Ein unbedingt erforderliches, HTTP-only gesetztes Sitzungs-Cookie für
        die Anmeldung. Paddle setzt im Checkout und im Abrechnungsportal eigene
        Cookies — siehe die Datenschutzhinweise von Paddle. In YANTA steckt kein
        Analyse-Produkt, keine Werbung und kein Tracking durch Dritte; deshalb
        sehen Sie hier auch kein Einwilligungsbanner.
      </p>
      <p>
        Zwei Dinge zählen wir auf unserer Startseite doch: dass die Seite
        geöffnet wurde, und dass jemand auf „Start“ geklickt hat. Ohne diese
        zwei Zahlen können wir nicht erkennen, ob die Seite überhaupt
        funktioniert. Gespeichert wird das als Tagessumme — ein Zähler pro Tag,
        pro Ereignis, pro Seitenfassung, dazu der Hostname der Seite, von der
        Sie kamen (nie eine vollständige Adresse, nie eine Suchanfrage). Zu
        einzelnen Besuchen entsteht kein Eintrag: keine Kennung, keine Sitzung,
        keine IP-Adresse, kein User-Agent, keine Zeitangabe genauer als der Tag.
        Da sich aus diesen Summen keine Person ermitteln lässt, sind es keine
        personenbezogenen Daten; es gibt hier also nichts einzuwilligen,
        auszukunften oder zu löschen.
      </p>

      <h2>9. Speicherdauer</h2>
      ${table(
        ['Daten', 'Aufbewahrung'],
        [
          ['Konto- und verschlüsselte Sync-Daten', 'Bis Sie das Konto oder die Daten löschen'],
          ['Sitzungen', 'Bis zum Ablauf oder zur Abmeldung'],
          ['Sicherheits- und Protokolldaten (gehashte IP)', 'Bis zu 12 Monate'],
          ['Nutzungszähler', 'Rollierend, bis zu 14 Monate'],
          ['Tages-Seitensummen (ohne Personenbezug)', 'Bleiben als aggregierte Summen'],
          ['Rechnungen, Zahlungs- und Buchhaltungsunterlagen', '10 Jahre (§ 147 AO, § 257 HGB)'],
          ['Kündigungserklärungen', '3 Jahre (Verjährungsfrist)'],
          ['Inhaltsmeldungen nach dem DSA', 'Bis zu 3 Jahre'],
          ['Öffentliche Freigaben', 'Bis zum Widerruf oder zur Kontolöschung'],
        ]
      )}

      <h2>10. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
        Datenübertragbarkeit (Art. 20) sowie das Recht, eine Einwilligung
        jederzeit mit Wirkung für die Zukunft zu widerrufen (Art. 7 Abs. 3).
        Schreiben Sie an ${mailLink()}; wir antworten innerhalb eines Monats.
        Ihr Konto können Sie unter
        <a href="/delete-account">Konto löschen</a> selbst entfernen, und Ihre
        Notizen jederzeit als Markdown oder verschlüsselte Sicherung
        exportieren.
      </p>
      <p>
        <strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Soweit wir uns auf
        berechtigte Interessen stützen — die oben genannte Verarbeitung zu
        Sicherheit und Missbrauchsabwehr — haben Sie das Recht, aus Gründen,
        die sich aus Ihrer besonderen Situation ergeben, jederzeit Widerspruch
        einzulegen. Wir stellen die Verarbeitung dann ein, es sei denn, wir
        können zwingende schutzwürdige Gründe nachweisen, die Ihre Interessen
        überwiegen.
      </p>

      <h2>11. Beschwerderecht bei einer Aufsichtsbehörde</h2>
      <p>
        Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren,
        insbesondere im Mitgliedstaat Ihres Aufenthaltsorts, Ihres
        Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes. Für uns
        zuständig ist:
      </p>
      <p>
        <strong>Die Landesbeauftragte für den Datenschutz Niedersachsen</strong><br>
        Prinzenstraße 5, 30159 Hannover, Deutschland<br>
        <a href="https://www.lfd.niedersachsen.de" target="_blank" rel="noopener">www.lfd.niedersachsen.de</a>
      </p>

      <h2>12. Kinder</h2>
      <p>
        YANTA richtet sich nicht an Kinder unter 16 Jahren. Wenn Sie glauben,
        dass ein Kind uns personenbezogene Daten übermittelt hat, wenden Sie
        sich an ${mailLink()}; wir löschen sie dann.
      </p>

      <h2>13. Änderungen dieser Erklärung</h2>
      <p>
        Wir aktualisieren diese Erklärung, wenn sich YANTA ändert. Das Datum
        oben zeigt den letzten Stand; über Änderungen, die Sie wesentlich
        betreffen, informieren wir per E-Mail.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Widerruf und Erstattungen
// ------------------------------------------------------------

function withdrawalDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Widerrufsrecht &amp; Erstattungen</h1>
      ${updatedLine()}

      <p>
        Auf dieser Seite stehen zwei verschiedene Dinge. Das erste ist Ihr
        <strong>gesetzliches Widerrufsrecht</strong>, das Ihnen das Gesetz gibt
        und das weder wir noch sonst jemand Ihnen nehmen kann. Das zweite ist
        unsere eigene <strong>Erstattungsregelung</strong>, die freiwillig ist
        und stellenweise über das Gesetz hinausgeht. Bei Widersprüchen gilt das
        gesetzliche Recht.
      </p>

      <h2 id="withdrawal">Widerrufsbelehrung</h2>

      <h3>Widerrufsrecht</h3>
      <p>
        Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen
        diesen Vertrag zu widerrufen.
      </p>
      <p>
        Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des
        Vertragsabschlusses.
      </p>
      <p>
        Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${providerInline()},
        ${escapeHtml(CONTACT_EMAIL)}) mittels einer eindeutigen Erklärung (z. B.
        ein mit der Post versandter Brief oder eine E-Mail) über Ihren
        Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür
        das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht
        vorgeschrieben ist.
      </p>
      <p>
        Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung
        über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist
        absenden.
      </p>

      <h3>Folgen des Widerrufs</h3>
      <p>
        Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die
        wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit
        Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine
        andere Art der Lieferung als die von uns angebotene, günstigste
        Standardlieferung gewählt haben), unverzüglich und spätestens binnen
        vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über
        Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese
        Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der
        ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen
        wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen
        wegen dieser Rückzahlung Entgelte berechnet.
      </p>
      <p>
        Haben Sie verlangt, dass die Dienstleistung während der Widerrufsfrist
        beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen,
        der dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung
        des Widerrufsrechts hinsichtlich dieses Vertrags unterrichten, bereits
        erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag
        vorgesehenen Dienstleistungen entspricht.
      </p>

      <h3>Vorzeitiges Erlöschen des Widerrufsrechts</h3>
      <p>
        Bei einem Vertrag über die Lieferung von nicht auf einem körperlichen
        Datenträger befindlichen digitalen Inhalten erlischt Ihr Widerrufsrecht
        vorzeitig, wenn wir mit der Ausführung begonnen haben, nachdem Sie
        ausdrücklich zugestimmt haben, dass wir vor Ablauf der Widerrufsfrist
        mit der Ausführung beginnen, und Sie Ihre Kenntnis davon bestätigt
        haben, dass Sie durch Ihre Zustimmung Ihr Widerrufsrecht verlieren. Wir
        holen beides vor dem Checkout ausdrücklich ein und bestätigen es Ihnen
        anschließend in Textform.
      </p>

      <h2>Muster-Widerrufsformular</h2>
      <p>
        (Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses
        Formular aus und senden Sie es zurück.)
      </p>
      <blockquote class="yanta-legal-quote">
        <p>
          An ${providerInline()}, ${escapeHtml(CONTACT_EMAIL)}:
        </p>
        <p>
          Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen
          Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der
          folgenden Dienstleistung (*)
        </p>
        <p>
          Bestellt am (*)/erhalten am (*),<br>
          Name des/der Verbraucher(s),<br>
          Anschrift des/der Verbraucher(s),<br>
          Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier),<br>
          Datum
        </p>
        <p>(*) Unzutreffendes streichen.</p>
      </blockquote>
      <p>
        Es genügt, dieses Formular an ${mailLink()} zu senden. Sie können uns
        auch einfach einen Satz schreiben — eine bestimmte Formulierung ist
        nicht vorgeschrieben.
      </p>

      <h2>Unsere Erstattungsregelung</h2>
      <p>
        Über das gesetzliche Widerrufsrecht hinaus handhaben wir Erstattungen
        wie folgt. Paddle ist Merchant of Record und wickelt sie ab.
      </p>

      <h3>1. Erstkauf</h3>
      <p>
        Sie sind mit YANTA Plus nicht zufrieden? Melden Sie sich innerhalb von
        14 Tagen nach Ihrem Erstkauf, und wir erstatten in aller Regel, sofern
        das Anliegen ernst gemeint ist und der Dienst nicht missbraucht wurde.
      </p>

      <h3>2. Verlängerungen</h3>
      <p>
        Zahlungen für Verlängerungen erstatten wir grundsätzlich nicht mehr,
        sobald der neue Zeitraum begonnen hat. Hat Sie eine Verlängerung
        überrascht und haben Sie den Zeitraum kaum genutzt, schreiben Sie uns
        trotzdem — uns ist eine Erstattung lieber als ein unzufriedener Kunde.
        Gesetzliche Rechte bleiben davon unberührt.
      </p>

      <h3>3. Missbrauch</h3>
      <p>
        Bei Betrug, wiederholten Erstattungsanfragen oder einer Nutzung, die
        erkennbar darauf zielt, die Zahlung zu umgehen, können wir eine
        Erstattung ablehnen.
      </p>

      <h3>4. So beantragen Sie eine Erstattung</h3>
      <p>
        Eine E-Mail an ${mailLink()} mit Ihrer Konto-E-Mail-Adresse und dem
        Paddle-Beleg genügt. Bewilligte Erstattungen laufen über Paddle; wie
        lange das Geld unterwegs ist, hängt von Paddle und Ihrem
        Zahlungsdienstleister ab.
      </p>

      <h3>5. Ihre gesetzlichen Rechte</h3>
      <p>
        Nichts auf dieser Seite schränkt zwingende Verbraucherrechte ein,
        einschließlich des obigen Widerrufsrechts und der gesetzlichen
        Mängelrechte.
      </p>
    </article>
  `;
}

// ------------------------------------------------------------
// Lizenzen
// ------------------------------------------------------------

function licensesDocument() {
  return `
    <article class="yanta-legal-doc">
      <h1>Lizenzen &amp; Quelltext</h1>
      ${updatedLine()}

      <h2>YANTA selbst</h2>
      <p>
        YANTA ist freie Software unter der
        <strong>GNU Affero General Public License, Version 3</strong>.
      </p>
      <p>
        Abschnitt 13 dieser Lizenz verlangt, dass Nutzerinnen und Nutzern, die
        über ein Netzwerk mit der Software interagieren, der vollständige
        zugehörige Quelltext angeboten wird. Hier ist er:
      </p>
      <p>
        <a class="yanta-site-btn primary" href="${escapeHtml(SOURCE_URL)}" target="_blank" rel="noopener">
          Quelltext abrufen
        </a>
      </p>
      <p>
        Das Repository enthält die Web-App, den Cloudflare Worker hinter YANTA
        Cloud, den Signalling-Server und den Sync-Broker — alles, was zum Bauen
        und Betreiben einer eigenen Instanz nötig ist. Falls Sie keinen Zugriff
        haben, schreiben Sie an ${mailLink()}; wir senden Ihnen ein Archiv.
      </p>

      <h2>Komponenten Dritter</h2>
      <p>
        YANTA steht auf der Arbeit vieler anderer. Jede dieser Komponenten
        behält ihre eigene Lizenz; die vollständigen Lizenztexte liegen den
        Paketen im Repository bei.
      </p>
      ${table(['Komponente', 'Lizenz', 'Projekt'], licenceRows())}

      <h2>Schriften und Assets</h2>
      <p>
        Die mit der Zeichenfläche ausgelieferten Handschrift- und
        Zeichenschriften (Excalifont, Virgil, Comic Shanns, Nunito, Lilita One,
        Assistant, Liberation Sans, Cascadia Code, Xiaolai) stehen unter der
        SIL Open Font License oder vergleichbaren freien Lizenzen ihrer
        jeweiligen Urheber.
      </p>
    </article>
  `;
}

export const forms = {
  cancel: {
    heading: 'Vertrag kündigen',
    statute: 'Verträge hier kündigen (§ 312k BGB)',
    intro: 'Kündigen Sie hier Ihr YANTA-Plus-Abonnement. Eine Anmeldung ist nicht nötig. Wir bestätigen jede Kündigung per E-Mail, mit Eingangszeitpunkt und dem Datum, zu dem Ihr Vertrag endet — bewahren Sie diese E-Mail auf, sie ist Ihr Nachweis.',
    keepsData: 'Die Kündigung beendet nur den kostenpflichtigen Tarif. <strong>Es wird nichts gelöscht.</strong> YANTA Plus bleibt bis zum Ende des bereits bezahlten Zeitraums verfügbar, danach läuft das Konto im kostenlosen Tarif weiter. Um das Konto selbst zu entfernen, nutzen Sie <a href="/delete-account">Konto löschen</a>.',
    typeLegend: 'Art der Kündigung',
    ordinary: 'Ordentliche Kündigung',
    ordinaryHint: 'Wirkt zum Ende Ihres laufenden Abrechnungszeitraums. Das ist der Regelfall.',
    extraordinary: 'Außerordentliche Kündigung',
    extraordinaryHint: 'Aus wichtigem Grund, mit sofortiger Wirkung. Bitte nennen Sie den Grund unten.',
    emailLabel: 'E-Mail-Adresse Ihres YANTA-Kontos',
    emailHint: 'Hierhin senden wir die Bestätigung. Bitte die Adresse verwenden, auf die das Abonnement läuft.',
    nameLabel: 'Name',
    refLabel: 'Vertrags- oder Rechnungsnummer',
    refHint: 'Hilft uns, den richtigen Vertrag zu finden, wenn Sie mehrere haben.',
    reasonLabel: 'Grund für die außerordentliche Kündigung',
    declaration: 'Mit dem Absenden dieses Formulars erkläre ich, dass ich meinen YANTA-Plus-Vertrag zum nächstmöglichen Zeitpunkt kündige.',
    submit: 'Jetzt kündigen',
    busy: 'Kündigung wird übermittelt…',
    needEmail: 'Bitte geben Sie die E-Mail-Adresse Ihres YANTA-Kontos an.',
    otherHeading: 'Andere Wege zu kündigen',
    otherBody: 'Eine Kündigung ist in jeder eindeutigen Form wirksam. Sie können auch an {mail} schreiben oder per Post an {address}. Angemeldete Kundinnen und Kunden können außerdem unter <strong>Einstellungen → Sync → Abrechnung verwalten</strong> kündigen.',
    notWithdrawal: 'Kündigung und Widerruf sind nicht dasselbe. Innerhalb von 14 Tagen nach Ihrem Erstkauf steht Ihnen zusätzlich ein gesetzliches Widerrufsrecht zu — siehe <a href="/withdrawal">Widerrufsrecht</a>.',
    receiptHeading: 'Kündigung eingegangen',
    receiptRef: 'Ihre Vorgangsnummer lautet {ref}.',
    receiptBody: 'Wir haben die Bestätigung an die angegebene Adresse gesendet, mit dem genauen Eingangszeitpunkt Ihrer Erklärung und dem Datum, zu dem Ihr Vertrag endet. Sollte sie nicht in wenigen Minuten ankommen, prüfen Sie bitte den Spam-Ordner und wenden Sie sich dann an {mail}.',
    errRate: 'Zu viele Versuche von diesem Gerät. Bitte schreiben Sie stattdessen an {mail} — das ist genauso wirksam.',
    errGeneric: 'Wir konnten Ihre Kündigung nicht erfassen. Bitte schreiben Sie an {mail}: Eine Kündigung per E-Mail ist genauso wirksam und wird mit Zugang bei uns wirksam.',
  },

  report: {
    heading: 'Inhalt melden',
    intro: 'Wenn ein YANTA-Freigabelink auf Inhalte verweist, die Sie für rechtswidrig halten, teilen Sie uns das hier mit. Jede Person kann eine Meldung abgeben — ein Konto ist nicht nötig. Dies ist das Melde- und Abhilfeverfahren nach Artikel 16 des Digital Services Act.',
    encryptedNote: '<strong>Was wir sehen können und was nicht.</strong> Freigegebene Inhalte sind Ende-zu-Ende-verschlüsselt und wir besitzen keinen Schlüssel; wir können eine Freigabe also nicht öffnen, um sie zu prüfen. Wir bewerten Ihre Beschreibung, und wenn eine Meldung begründet ist, besteht die uns mögliche Maßnahme darin, die Freigabe insgesamt zu deaktivieren. Deshalb sind eine genaue Begründung und ein funktionierender Link hier besonders wichtig.',
    urlLabel: 'Genaue Adresse des Inhalts',
    urlHint: 'Fügen Sie den vollständigen Freigabelink ein, z. B. https://yanta.page/share/abc123…',
    categoryLabel: 'Worum geht es?',
    categories: {
      copyright: 'Urheberrechts- oder Markenrechtsverletzung',
      personal_data: 'Meine personenbezogenen Daten / Persönlichkeitsrechtsverletzung',
      illegal_content: 'Sonstige rechtswidrige Inhalte',
      csam: 'Darstellung sexuellen Kindesmissbrauchs',
      malware: 'Schadsoftware oder Phishing',
      impersonation: 'Identitätsvortäuschung',
      other: 'Etwas anderes',
    },
    explanationLabel: 'Warum ist dieser Inhalt rechtswidrig?',
    explanationHint: 'Bitte werden Sie konkret: was genau dort zu finden ist, welches Recht verletzt wird und — falls Sie Rechteinhaber sind — woran wir das erkennen können.',
    nameLabel: 'Ihr Name',
    emailLabel: 'Ihre E-Mail-Adresse',
    emailHint: 'Nötig für die Eingangsbestätigung und unsere Entscheidung. Meldungen zu Darstellungen sexuellen Kindesmissbrauchs können anonym erfolgen.',
    goodFaith: 'Ich bestätige, dass diese Meldung richtig und vollständig ist',
    goodFaithHint: 'Gutgläubige Überzeugung von der Richtigkeit der Angaben, wie es Art. 16 Abs. 2 lit. d DSA verlangt.',
    submit: 'Meldung absenden',
    busy: 'Meldung wird übermittelt…',
    needUrl: 'Bitte geben Sie die Adresse des Inhalts an.',
    needExplanation: 'Bitte erläutern Sie, warum der Inhalt rechtswidrig ist — mindestens ein Satz.',
    needGoodFaith: 'Bitte bestätigen Sie, dass Ihre Meldung richtig und vollständig ist.',
    nextHeading: 'Wie es weitergeht',
    next1: 'Wir bestätigen den Eingang unverzüglich, sofern Sie uns eine Adresse genannt haben.',
    next2: 'Wir prüfen die Meldung zeitnah, sorgfältig, frei von Willkür und objektiv. Wir setzen keine automatisierte Moderation ein — jede Meldung liest ein Mensch.',
    next3: 'Wir teilen Ihnen das Ergebnis und die Gründe dafür mit, zusammen mit den Ihnen offenstehenden Rechtsbehelfen.',
    next4: 'Gehen wir gegen Inhalte vor, erhält die Person, die sie bereitgestellt hat, eine Begründung nach Art. 17 DSA und kann die Entscheidung anfechten.',
    otherHeading: 'Andere Wege',
    otherBody: 'Sie können auch an {mail} schreiben; das ist unsere Kontaktstelle nach Art. 11 und 12 DSA für Nutzerinnen, Nutzer und Behörden, auf Deutsch oder Englisch. Postanschrift: {address}.',
    badFaith: 'Meldungen wider besseres Wissen — bewusst falsche Angaben — können rechtliche Folgen haben und dazu führen, dass wir weitere Meldungen von Ihnen nicht mehr berücksichtigen.',
    receiptHeading: 'Meldung eingegangen',
    receiptRef: 'Ihre Vorgangsnummer lautet {ref}.',
    receiptBody: 'Ein Mensch wird sie prüfen. Wenn Sie eine E-Mail-Adresse angegeben haben, erhalten Sie jetzt eine Bestätigung und nach der Prüfung unsere Entscheidung.',
    errRate: 'Zu viele Meldungen von diesem Gerät. Bitte schreiben Sie an {mail}.',
    errGeneric: 'Wir konnten Ihre Meldung nicht erfassen. Bitte schreiben Sie an {mail}.',
  },

  del: {
    heading: 'Konto löschen',
    intro: 'Das Löschen Ihres YANTA-Cloud-Kontos entfernt Ihre Daten von unseren Servern. <strong>Das lässt sich nicht rückgängig machen</strong>, und da Ihre Inhalte mit einem Schlüssel verschlüsselt sind, den wir nie sehen, könnten wir sie auch auf Wunsch nicht wiederherstellen.',
    cancelInstead: '<strong>Sie möchten nur nicht mehr zahlen?</strong> Dafür gibt es <a href="/cancel">Vertrag kündigen</a> — das beendet das Abonnement und erhält Ihre Daten.',
    exportHeading: 'Vorher exportieren',
    exportBody: 'Öffnen Sie YANTA und exportieren Sie unter <strong>Einstellungen → Backup</strong> Ihre Notizen als lesbares Markdown oder als verschlüsseltes <code>.yanta</code>-Archiv. Ist das Konto weg, ist auch unsere Kopie weg.',
    goesHeading: 'Was gelöscht wird',
    goes: [
      'Ihre verschlüsselten Tresore und alle synchronisierten Objekte',
      'In YANTA Cloud gespeicherte Notizen, Zeichnungen und Dateien',
      'Geräte, Sitzungen und Push-Abonnements',
      'Von Ihnen erstellte öffentliche Freigaben und Präsentationssitzungen',
      'Geteilte Bereiche, die Ihnen gehören, sowie Ihre Mitgliedschaften',
      'Ihr YANTA-Chat-Konto auf dem Matrix-Homeserver',
    ],
    staysHeading: 'Was wir behalten müssen — und warum',
    staysCols: ['Daten', 'Grund'],
    stays: [
      ['Rechnungen und Zahlungsunterlagen', 'Handels- und Steuerrecht verlangen bis zu 10 Jahre (§ 147 AO, § 257 HGB). Sie werden nur dafür aufbewahrt.'],
      ['Kündigungserklärungen und Inhaltsmeldungen', 'Rechtsdokumente; der Bezug zu Ihrer Person wird entfernt.'],
      ['Alles, was nur auf Ihren Geräten liegt', 'Das hatten wir nie. Löschen Sie es in der App oder in den Browsereinstellungen.'],
    ],
    doItHeading: 'Jetzt löschen',
    checking: 'Anmeldung wird geprüft…',
    signedOut: 'Sie sind auf diesem Gerät nicht angemeldet. Melden Sie sich zuerst bei YANTA Cloud an — dann wird aus dieser Seite die Löschschaltfläche.',
    signIn: 'YANTA öffnen und anmelden',
    signedIn: 'Angemeldet als <strong>{email}</strong>. Mit der Löschung wird ein laufendes Abonnement sofort gekündigt.',
    confirmLabel: 'Tippen Sie DELETE zur Bestätigung',
    submit: 'Mein Konto endgültig löschen',
    busy: 'Konto wird gelöscht…',
    needConfirm: 'Bitte tippen Sie DELETE zur Bestätigung.',
    noSignInHeading: 'Wenn Sie sich nicht anmelden können',
    noSignInBody: 'Schreiben Sie von der Adresse des Kontos an {mail}, mit „Konto löschen“ im Betreff. Wir prüfen, ob die Anfrage vom Kontoinhaber stammt, und löschen innerhalb von 30 Tagen, meist deutlich schneller. Auch eine Anfrage per Post an {address} ist möglich.',
    receiptHeading: 'Ihr Konto ist gelöscht',
    receiptBody: 'Ihre Cloud-Daten sind entfernt und Sie wurden abgemeldet. Eine Bestätigung haben wir per E-Mail gesendet.',
    receiptLocal: 'Daten, die nur auf diesem Gerät liegen, sind weiterhin vorhanden — löschen Sie sie in der App oder in den Browsereinstellungen.',
    errExpired: 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
    errGeneric: 'Die Löschung ist fehlgeschlagen. Bitte schreiben Sie an {mail}.',
  },
};

export default {
  imprint: imprintDocument,
  terms: termsDocument,
  privacy: privacyDocument,
  withdrawal: withdrawalDocument,
  licenses: licensesDocument,
};
